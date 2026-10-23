import {
  type AskedField,
  type FieldReply,
  fieldKind,
  type InboxAskAnswer,
  isEqualOpportunity,
  isRemembered,
  type OfferedFile,
  type RememberedKind,
} from '@factwright/core';
import { askComputer } from './computer.ts';
import { ext } from './ext.ts';
import {
  type FieldAnswer,
  type FieldFilled,
  type FieldValue,
  type FormAnswer,
  type FormTask,
  formPage,
  type PageField,
  type PageForm,
} from './page/form.ts';

/**
 * Filling an application form, as the side panel does it: it reads the form in the tab you asked
 * it to fill, asks Factwright on this computer for an answer to each field, fetches the job's
 * resume and cover letter to upload, fills the form, and later reads the answers you sent. The
 * page's own function does the reading and filling (page/form.ts), sent into the page each time,
 * only while the browser lets the extension reach that tab.
 */

/**
 * Sites whose terms forbid filling their own application forms: LinkedIn's Easy Apply and
 * Indeed's Easily apply. There, the panel gives each answer to copy, and fills nothing.
 */
const COPY_ONLY = /(^|\.)(linkedin\.com|indeed\.com)$/i;

/**
 * Whether a page's form looks like an application, so the popup offers to fill it: a few fields,
 * one of them a file or an email address.
 */
export function looksLikeApplication(form: PageForm | null): boolean {
  if (!form || form.fields.length < 3) return false;
  return form.fields.some((field) => field.control === 'file' || fieldKind(field) === 'email');
}

/** Whether a page is one where the panel only gives answers to copy. */
export function isCopyOnly(url: string): boolean {
  try {
    return COPY_ONLY.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Runs the form's function in a tab, or null when the browser doesn't let it reach the tab. */
async function inPage(tabId: number, task: FormTask): Promise<FormAnswer | null> {
  try {
    const [first] = await ext.scripting.executeScript({
      target: { tabId },
      func: formPage,
      args: [task],
    });
    return (first?.result as FormAnswer | undefined) ?? null;
  } catch {
    // A page the browser keeps extensions out of, or one you've left since clicking Fill.
    return null;
  }
}

/** The form in a tab, or null when it can't be read. */
export async function readForm(tabId: number): Promise<PageForm | null> {
  const answer = await inPage(tabId, { do: 'read' });
  return answer?.did === 'read' ? answer.form : null;
}

/** Fills a form's fields, and says how each went, or null when the tab can't be reached. */
export async function fillForm(
  tabId: number,
  answers: FieldAnswer[],
): Promise<FieldFilled[] | null> {
  const answer = await inPage(tabId, { do: 'fill', answers });
  return answer?.did === 'fill' ? answer.filled : null;
}

/** What's in a form's fields now, and the page's address, or null when it can't be read. */
export async function formValues(
  tabId: number,
): Promise<{ url: string; values: FieldValue[] } | null> {
  const answer = await inPage(tabId, { do: 'values' });
  return answer?.did === 'values' ? { url: answer.url, values: answer.values } : null;
}

/** Outlines fields in orange on the page, as left for you. */
export async function outlineFields(tabId: number, fields: PageField[]): Promise<void> {
  await inPage(tabId, { do: 'outline', fields: fields.map(({ ref, key }) => ({ ref, key })) });
}

/** Scrolls to a field on the page, and puts the cursor in it. */
export async function showField(tabId: number, field: PageField): Promise<boolean> {
  const answer = await inPage(tabId, { do: 'show', ref: field.ref, key: field.key });
  return answer?.did === 'show' && answer.found;
}

/** A form's fields as an ask carries them: what each asks and how, never what's in it. */
export const askedFields = (form: PageForm): AskedField[] =>
  form.fields.map(({ ref: _, key: __, ...field }) => field);

/** What Factwright answered for a form: the job, a reply for each field, and files to upload. */
export type FillPlan = Extract<InboxAskAnswer, { did: 'fill' }>;

/** Asks Factwright on this computer how to fill a form. */
export function planFill(
  form: PageForm,
  job: { company: string; role: string },
): ReturnType<typeof askComputer> {
  return askComputer({
    ask: 'fill',
    url: form.url,
    title: form.title,
    company: job.company,
    role: job.role,
    fields: askedFields(form),
  });
}

/** One of a job's files, fetched from Factwright on this computer in its parts, as base64. */
export async function fetchFile(
  jobId: string,
  kind: 'resume' | 'cover-letter',
  offered: OfferedFile,
): Promise<string | null> {
  let base64 = '';
  for (let part = 0; part < offered.parts; part++) {
    const answer = await askComputer({ ask: 'file', job: jobId, file: kind, part });
    if (!answer.ok || answer.did !== 'file' || answer.part !== part) return null;
    base64 += answer.base64;
  }
  return base64;
}

/** What to put in each field Factwright answered, with the files it fetched. */
export function fillAnswers(
  form: PageForm,
  replies: readonly FieldReply[],
  files: Partial<Record<'resume' | 'cover-letter', { name: string; base64: string }>>,
): FieldAnswer[] {
  return form.fields.flatMap((field, at): FieldAnswer[] => {
    const reply = replies[at];
    if (!reply || reply.source === 'you') return [];
    const { ref, key } = field;
    if (reply.file) {
      const file = files[reply.file];
      return file ? [{ ref, key, file: { ...file, type: 'application/pdf' } }] : [];
    }
    if (reply.pick) return [{ ref, key, pick: reply.pick, ...(reply.exact && { exact: true }) }];
    return reply.text ? [{ ref, key, text: reply.text }] : [];
  });
}

/** The words Factwright put in a field, as the panel shows them and you can copy them. */
export function replyText(reply: FieldReply): string {
  if (reply.file) return reply.from ?? '';
  return reply.text ?? reply.pick?.[0] ?? '';
}

/**
 * What's in a field, as last read: the field at its place with its key, or else the one field
 * with its key, as a form can add and take away fields as you go.
 */
export function fieldValue(field: PageField, values: readonly FieldValue[]): string {
  const same = values.find((each) => each.ref === field.ref && each.key === field.key);
  if (same) return same.value;
  const keyed = values.filter((each) => each.key === field.key);
  return keyed.length === 1 ? (keyed[0]?.value ?? '') : '';
}

/**
 * The answers to send once you've applied: what's in each of the form's own questions, as typed
 * or picked. Never what Profile fills, a file, a checkbox or an equal-opportunity answer.
 */
export function sentAnswers(
  form: PageForm,
  replies: readonly FieldReply[],
  values: readonly FieldValue[],
): { question: string; text: string }[] {
  return form.fields.flatMap((field, at) => {
    const reply = replies[at];
    if (reply?.kind !== 'question') return [];
    if (field.control === 'file' || field.control === 'check' || !field.question) return [];
    const value = fieldValue(field, values);
    return value.trim() ? [{ question: field.question, text: value.trim() }] : [];
  });
}

/** An answer you typed that Factwright didn't have, which it offers to keep in Profile. */
export interface NewAnswer {
  field: PageField;
  kind: RememberedKind;
  text: string;
  /** Whether it's one Profile keeps on this computer alone. */
  private: boolean;
}

/**
 * What you typed or picked on a form that Factwright didn't have, for a field Profile answers:
 * each one offered on its own, to keep for next time, or not.
 */
export function newAnswers(
  form: PageForm,
  replies: readonly FieldReply[],
  values: readonly FieldValue[],
): NewAnswer[] {
  return form.fields.flatMap((field, at) => {
    const reply = replies[at];
    if (!reply || !isRemembered(reply.kind) || field.control === 'file') return [];
    const text = fieldValue(field, values).trim();
    if (!text || text.length > 200) return [];
    const had = replyText(reply).trim();
    if (had && plainly(had) === plainly(text)) return [];
    // A choice Factwright picked from its own words, as "Woman" for "Female", is what it had.
    if (reply.pick?.some((pick) => plainly(pick) === plainly(text))) return [];
    const kind = reply.kind;
    return [
      {
        field,
        kind,
        text,
        private: isEqualOpportunity(kind) || kind === 'street' || kind === 'postal-code',
      },
    ];
  });
}

const plainly = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
