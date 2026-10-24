import {
  ASK_FIELDS,
  type AskedField,
  DRAFT_QUESTIONS,
  type FieldReply,
  fieldPart,
  type InboxAskAnswer,
  isEqualOpportunity,
  isRemembered,
  JOB_LIMITS,
  type OfferedFile,
  type RememberedKind,
  US_STATES,
} from '@factwright/core';
import { looksLikeApplication } from './application-form.ts';
import { framesOnAllowedSites, isAllowedPage } from './application-sites.ts';
import { askComputer } from './computer.ts';

export { looksLikeApplication } from './application-form.ts';

import { ext } from './ext.ts';
import {
  type FieldAnswer,
  type FieldFilled,
  type FieldRef,
  type FieldValue,
  type FormAnswer,
  type FormTask,
  formPage,
  type PageAdder,
  type PageField,
  type PageForm,
} from './page/form.ts';

/**
 * Filling an application form, as the side panel does it: it reads the form in the tab you asked
 * it to fill, asks Factwright on this computer for an answer to each field, fetches the job's
 * resume and cover letter to upload, fills the form, and later reads the answers you sent. The
 * page's own function does the reading and filling (page/form.ts), sent into the page each time,
 * only while the browser lets the extension reach that tab. The form may be in a frame of the
 * tab's page, as a company's careers page shows an applicant system's form, but only a frame from
 * a job site you allowed (src/application-sites.ts): the page's own function runs there, and what
 * it reads goes to the extension, never to the page around it.
 */

/** Where a form is: a tab, and the frame in it, its top frame being 0. */
export interface FormPlace {
  tabId: number;
  frameId: number;
}

/** A tab's top frame, the place a form is unless it's in a frame of a job site you allowed. */
export const topOf = (tabId: number): FormPlace => ({ tabId, frameId: 0 });

/**
 * Sites whose terms forbid filling their own application forms: LinkedIn's Easy Apply and
 * Indeed's Easily apply. There, the panel gives each answer to copy, and fills nothing.
 */
const COPY_ONLY = /(^|\.)(linkedin\.com|indeed\.com)$/i;

/** Whether a page is one where the panel only gives answers to copy. */
export function isCopyOnly(url: string): boolean {
  try {
    return COPY_ONLY.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Runs the form's function in a tab's frame, or null when the browser doesn't let it reach the
 * frame, or it's gone.
 */
async function inPage(place: FormPlace, task: FormTask): Promise<FormAnswer | null> {
  try {
    const [first] = await ext.scripting.executeScript({
      target: { tabId: place.tabId, frameIds: [place.frameId] },
      func: formPage,
      args: [task],
    });
    return (first?.result as FormAnswer | undefined) ?? null;
  } catch {
    // A page the browser keeps extensions out of, or one you've left since clicking Fill.
    return null;
  }
}

/** The form in a tab's frame, or null when it can't be read. */
export async function readForm(place: FormPlace): Promise<PageForm | null> {
  const answer = await inPage(place, { do: 'read' });
  return answer?.did === 'read' ? answer.form : null;
}

/** A form, and where it is. */
export interface FoundForm {
  place: FormPlace;
  form: PageForm;
}

/**
 * The application form in a tab, and where it is: the top page's, where it looks like one, or
 * else the one in a frame from a job site you allowed that does, the one with most fields, or else
 * the top page's, as it is. A frame counts only while it still shows a page on such a site, and
 * never in a page of LinkedIn's or Indeed's. Null when nothing can be read.
 */
export async function findForm(tabId: number): Promise<FoundForm | null> {
  const [top, frames] = await Promise.all([
    readForm(topOf(tabId)),
    framesOnAllowedSites(tabId).catch(() => []),
  ]);
  const atTop = top ? { place: topOf(tabId), form: top } : null;
  if (atTop && (looksLikeApplication(atTop.form) || isCopyOnly(atTop.form.url))) return atTop;
  const framed: FoundForm[] = [];
  for (const { frameId } of frames) {
    const place = { tabId, frameId };
    const form = await readForm(place);
    if (form && looksLikeApplication(form) && (await isAllowedPage(form.url))) {
      framed.push({ place, form });
    }
  }
  framed.sort((a, b) => b.form.fields.length - a.form.fields.length);
  return framed[0] ?? atTop;
}

/**
 * Fills a form's fields, as it was read at its address, and says how each went: or that the tab
 * has moved on to another address, or null when the tab can't be reached.
 */
export async function fillForm(
  place: FormPlace,
  url: string,
  answers: FieldAnswer[],
): Promise<FieldFilled[] | 'elsewhere' | null> {
  const answer = await inPage(place, { do: 'fill', url, answers });
  if (answer?.did === 'elsewhere') return 'elsewhere';
  return answer?.did === 'fill' ? answer.filled : null;
}

/** What some of a form's fields hold now, as the page reads them. */
export type FormValues = Extract<FormAnswer, { did: 'values' }>;

/**
 * What some of a form's fields hold now, the page's address, and the page of its application it's
 * on, or null when it can't be read.
 */
export async function formValues(place: FormPlace, fields: FieldRef[]): Promise<FormValues | null> {
  const answer = await inPage(place, { do: 'values', fields });
  return answer?.did === 'values' ? answer : null;
}

/**
 * Presses one of a form's buttons that add a part to it, as many times as you chose, and says how
 * many parts it added: or that the tab has moved on to another address, or null when the tab
 * can't be reached.
 */
export async function addParts(
  place: FormPlace,
  url: string,
  adder: PageAdder,
  times: number,
): Promise<number | 'elsewhere' | null> {
  const answer = await inPage(place, { do: 'add', url, adder, times });
  if (answer?.did === 'elsewhere') return 'elsewhere';
  return answer?.did === 'add' ? answer.added : null;
}

/** Outlines fields in orange on the page, as left for you. */
export async function outlineFields(place: FormPlace, fields: PageField[]): Promise<void> {
  await inPage(place, { do: 'outline', fields: fields.map(({ ref, key }) => ({ ref, key })) });
}

/** Scrolls to a field on the page, and puts the cursor in it. */
export async function showField(place: FormPlace, field: PageField): Promise<boolean> {
  const answer = await inPage(place, { do: 'show', ref: field.ref, key: field.key });
  return answer?.did === 'show' && answer.found;
}

/**
 * A form's fields as an ask carries them: what each asks and how, never what's in it, and within
 * what the app takes.
 */
export const askedFields = (form: PageForm): AskedField[] =>
  form.fields.map(({ ref: _, key: __, ...field }) => ({
    ...field,
    type: field.type.slice(0, 40),
    autocomplete: field.autocomplete.slice(0, 200),
    options: field.options.slice(0, ASK_FIELDS),
  }));

/** A page's address within what the app takes: one that long goes without what follows its ?. */
function asked(url: string): string {
  if (url.length <= JOB_LIMITS.link) return url;
  const [path = ''] = url.split(/[?#]/);
  return path.slice(0, JOB_LIMITS.link);
}

/** What Factwright answered for a form: the job, a reply for each field, and files to upload. */
export type FillPlan = Extract<InboxAskAnswer, { did: 'fill' }>;

/**
 * Asks Factwright on this computer how to fill a form. Factwright 0.13 takes a form's fields
 * without the part of the form each is in, so it's asked again without them, when it refuses.
 */
export async function planFill(
  form: PageForm,
  job: { company: string; role: string },
): ReturnType<typeof askComputer> {
  const ask = (fields: AskedField[]) =>
    askComputer({
      ask: 'fill',
      url: asked(form.url),
      title: form.title.slice(0, 1000),
      company: job.company.slice(0, JOB_LIMITS.company),
      role: job.role.slice(0, JOB_LIMITS.role),
      fields,
    });
  const fields = askedFields(form);
  const answer = await ask(fields);
  if (answer.ok || answer.reason !== 'bad-message') return answer;
  return ask(fields.map(({ section: _, ...field }) => field));
}

/**
 * A box for one part of a date, as "Date Month" or "From Year", which only you can say: a few
 * words that end in the part, in a box for a number.
 */
const DATE_PART = /^(\S+ ){0,2}(day|month|year)$/i;

/**
 * The form's own questions that nothing on file answers, which your Claude can draft: ones it
 * asks in words or with options, left for you and not filled. A file, a box to tick, a box for one
 * part of a date, as a self-identification form's date to sign it is, and a question your Claude
 * said is yours to answer, with why, aren't.
 */
export function draftable(
  form: PageForm,
  replies: readonly FieldReply[],
  filled: ReadonlyMap<string, FieldFilled>,
): PageField[] {
  return form.fields
    .filter((field, at) => {
      const reply = replies[at];
      return (
        reply?.kind === 'question' &&
        reply.source === 'you' &&
        reply.left === 'new' &&
        !reply.from &&
        field.question.trim() !== '' &&
        field.control !== 'file' &&
        field.control !== 'check' &&
        !(field.control === 'number' && DATE_PART.test(field.question.trim())) &&
        !filled.get(field.key)?.ok
      );
    })
    .slice(0, DRAFT_QUESTIONS);
}

/**
 * Asks Factwright on this computer to have your Claude draft answers to some of a form's own
 * questions, in its window, for the job the form is for.
 */
export const askForDrafts = (form: PageForm, jobId: string, fields: PageField[]) =>
  askComputer({
    ask: 'draft',
    job: jobId,
    url: asked(form.url),
    questions: askedFields({ ...form, fields }),
  });

/** How your Claude's drafts for a job are coming along, as Factwright on this computer says. */
export const draftsSoFar = (jobId: string) => askComputer({ ask: 'drafts', job: jobId });

/** One of a job's files, fetched from Factwright on this computer in its parts, as base64. */
export async function fetchFile(
  jobId: string,
  kind: 'resume' | 'cover-letter',
  offered: OfferedFile,
): Promise<string | null> {
  let base64 = '';
  for (let part = 0; part < offered.parts; part++) {
    const answer = await askComputer({
      ask: 'file',
      job: jobId,
      file: kind,
      version: offered.version,
      part,
    });
    if (!answer.ok || answer.did !== 'file' || answer.part !== part) return null;
    base64 += answer.base64;
  }
  return base64;
}

/** The kinds of field that ask for a place, which a site's own list may name in full. */
const PLACES = new Set<FieldReply['kind']>(['location', 'city', 'job-location']);

/**
 * A place's other names, as a site's own list of places may put it: "Denver, CO" is "Denver,
 * Colorado" too. Each name stays first, with its other name after it.
 */
export function placeNames(picks: readonly string[]): string[] {
  const names = picks.flatMap((pick) => {
    const [city = '', region = '', ...rest] = pick.split(',').map((part) => part.trim());
    const state = US_STATES[region.toUpperCase()];
    return state && city ? [pick, [city, state, ...rest].join(', ')] : [pick];
  });
  return [...new Set(names)];
}

/** Whether a reply is a place, which a site's own list of places offers as you type. */
export const isPlace = (kind: FieldReply['kind']) => PLACES.has(kind);

/** The options to pick for a reply: a place's in each of its names. */
export const picksOf = (reply: Pick<FieldReply, 'kind' | 'pick'>): string[] =>
  isPlace(reply.kind) ? placeNames(reply.pick ?? []) : [...(reply.pick ?? [])];

/** The kinds of field that name a part's job or school: what tells a part that holds another. */
const NAMES_PART = new Set<FieldReply['kind']>(['current-company', 'school']);

/**
 * What to put in each field Factwright answered, with the files it fetched. On a page of an
 * application that runs over several, which its site may have filled from your resume, as
 * Workday's does, or as asked (`onlyEmpty`), only in the fields that are empty, and none in a part
 * for a job or school the site filled with another one.
 */
export function fillAnswers(
  form: PageForm,
  replies: readonly FieldReply[],
  files: Partial<Record<'resume' | 'cover-letter', { name: string; base64: string }>>,
  onlyEmpty = false,
): FieldAnswer[] {
  const answers = form.fields.flatMap((field, at): FieldAnswer[] => {
    const reply = replies[at];
    if (!reply || reply.source === 'you') return [];
    const { ref, key } = field;
    if (reply.file) {
      const file = files[reply.file];
      return file ? [{ ref, key, file: { ...file, type: 'application/pdf' } }] : [];
    }
    if (reply.pick) {
      return [
        {
          ref,
          key,
          pick: picksOf(reply),
          ...(reply.exact && { exact: true }),
          ...(isPlace(reply.kind) && { place: true }),
        },
      ];
    }
    if (!reply.text) return [];
    // A place in a box that offers places as you type is one of its own to pick.
    if (isPlace(reply.kind) && field.control === 'combo') {
      return [{ ref, key, pick: placeNames([reply.text]), place: true }];
    }
    return [{ ref, key, text: reply.text }];
  });
  if (!onlyEmpty && !form.step) return answers;
  return answers.map((answer) => {
    const at = form.fields.findIndex((field) => field.ref === answer.ref);
    const field = form.fields[at];
    const part = field?.section && fieldPart(field) ? field.section : undefined;
    return {
      ...answer,
      ifEmpty: true,
      ...(part && { part, names: NAMES_PART.has(replies[at]?.kind ?? 'question') }),
    };
  });
}

/** The words Factwright put in a field, as the panel shows them and you can copy them. */
export function replyText(reply: FieldReply): string {
  if (reply.file) return reply.from ?? '';
  return reply.text ?? reply.pick?.[0] ?? '';
}

/** Where an answer Factwright has came from, in words, as the panel and the menus say it. */
export function answerSource(reply: FieldReply): string {
  if (
    reply.from &&
    (reply.source === 'sent' || reply.source === 'claude' || reply.source === 'resume')
  ) {
    return reply.from;
  }
  if (reply.file) return reply.file === 'resume' ? 'The job’s resume' : 'The job’s cover letter';
  if (reply.source === 'resume') return 'From the job’s resume';
  if (reply.source === 'job')
    return reply.kind === 'how-heard' ? 'Where you found the job' : 'From the job';
  return 'From Profile';
}

/**
 * How many times a form is filled: once, then again for fields a form shows only once others are
 * answered, as a question about race once you've said whether you're Hispanic or Latino.
 */
const PASSES = 3;

/** A form being filled, as filling it in passes goes along. */
export interface Passes {
  place: FormPlace;
  /** The form as read, which gains the fields the form shows as it's filled. */
  form: PageForm;
  /** Factwright's answers, which gain the replies for those fields. */
  plan: FillPlan;
  /** The company and job title the page shows, which the job the form is for is found by. */
  shows: { company: string; role: string };
  /** How filling each field went, by its key, as a form's fields can move as it changes. */
  filled: Map<string, FieldFilled>;
  /** Whether a later start of filling took over, which stops this one where it is. */
  stale: () => boolean;
  /** Whether it fills only the fields that are empty, as once parts were added to the form. */
  onlyEmpty?: boolean;
  /** What it's doing now, to say. */
  status?: (text: string) => void;
  /** The form showed more fields, which it's answered. */
  added?: () => void;
}

/**
 * Fills a form with Factwright's answers, as the panel and the Fill button on the job sites you
 * allowed do: it fetches the job's files to upload first, fills each field, then again for those
 * the form showed meanwhile, and outlines what's left for you, and needed, in orange. Or it says
 * why it stopped: the tab moved on from the form, the browser doesn't let it reach the tab, or a
 * later start took over.
 */
export async function fillInPasses(
  passes: Passes,
): Promise<true | 'elsewhere' | 'unreachable' | 'stale'> {
  const { place, form, plan, shows, filled, stale } = passes;
  const { job, files } = plan;
  const replies = plan.replies;
  const fetched: Partial<Record<'resume' | 'cover-letter', { name: string; base64: string }>> = {};
  if (job) {
    for (const kind of ['resume', 'cover-letter'] as const) {
      const offered = files[kind];
      if (!offered || !replies.some((reply) => reply.file === kind)) continue;
      passes.status?.(
        kind === 'resume' ? 'Getting the job’s resume…' : 'Getting the job’s cover letter…',
      );
      const base64 = await fetchFile(job.id, kind, offered);
      if (stale()) return 'stale';
      if (base64) fetched[kind] = { name: offered.name, base64 };
    }
  }
  passes.status?.('Filling the form…');
  let from = 0;
  for (let pass = 0; pass < PASSES; pass++) {
    const fields = form.fields.slice(from);
    const answers = fillAnswers(
      { ...form, fields },
      replies.slice(from),
      fetched,
      passes.onlyEmpty,
    );
    const done = await fillForm(place, form.url, answers);
    if (stale()) return 'stale';
    if (done === null) return 'unreachable';
    if (done === 'elsewhere') return 'elsewhere';
    for (const each of done) {
      const field = fields.find((one) => one.ref === each.ref);
      if (field) filled.set(field.key, each);
    }
    // Fields the form showed once others were answered, filled in the next pass.
    const again = await readForm(place);
    if (stale()) return 'stale';
    if (!again || again.url.split('#')[0] !== form.url.split('#')[0]) break;
    const known = new Set(form.fields.map((field) => field.key));
    const added = again.fields.filter((field) => !known.has(field.key));
    if (added.length === 0) break;
    const planned = await planFill({ ...again, fields: added }, shows);
    if (stale()) return 'stale';
    if (!planned.ok || planned.did !== 'fill') break;
    from = form.fields.length;
    form.fields.push(...added);
    replies.push(...planned.replies);
    passes.added?.();
  }
  // What's left for you, and needed, is outlined in orange on the page.
  const left = form.fields.filter((field) => field.required && !filled.get(field.key)?.ok);
  await outlineFields(place, left);
  return stale() ? 'stale' : true;
}

/**
 * How many fields were filled, how many that held an answer already were left as they were, and
 * how many are left for you, as the panel says it.
 */
export function filledSummary(form: PageForm, filled: ReadonlyMap<string, FieldFilled>): string {
  const total = form.fields.length;
  const took = [...filled.values()].filter((each) => each.ok);
  const kept = took.filter((each) => each.kept).length;
  const done = took.length - kept;
  const left = total - took.length;
  const keeping = kept > 0 ? `, and left ${kept} as ${kept === 1 ? 'it was' : 'they were'}` : '';
  if (left > 0) {
    return `Filled ${done} of ${total} fields${keeping}. ${left} ${left === 1 ? 'is' : 'are'} left for you.`;
  }
  return kept > 0
    ? `Filled ${done} of ${total} fields${keeping}. Check them, then submit it on the page.`
    : `Filled all ${total} fields. Check them, then submit it on the page.`;
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
 * The fields whose answers are read as you go, to have what you sent: the form's own questions,
 * and those Profile can keep your answer to. Never one that's never filled, or a personal one.
 */
export function fieldsToRead(form: PageForm, replies: readonly FieldReply[]): FieldRef[] {
  return form.fields.flatMap(({ ref, key }, at) => {
    const kind = replies[at]?.kind;
    return kind === 'question' || (kind && isRemembered(kind)) ? [{ ref, key }] : [];
  });
}

/**
 * The answers to send once you've applied: what's in each of the form's own questions, as typed
 * or picked. Never what Profile fills, a file, a checkbox, agreeing to something, or an
 * equal-opportunity or personal answer.
 */
export function sentAnswers(
  form: PageForm,
  replies: readonly FieldReply[],
  values: readonly FieldValue[],
): { question: string; text: string }[] {
  return form.fields
    .flatMap((field, at) => {
      const reply = replies[at];
      if (reply?.kind !== 'question') return [];
      if (field.control === 'file' || field.control === 'check' || !field.question) return [];
      const value = fieldValue(field, values);
      return value.trim() ? [{ question: field.question, text: value.trim() }] : [];
    })
    .slice(0, ASK_FIELDS);
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
 * each one offered on its own, to keep for next time, or not. What a site put in a field itself,
 * as from your resume, which Factwright left as it was (`filled`), isn't yours, unless you changed it.
 */
export function newAnswers(
  form: PageForm,
  replies: readonly FieldReply[],
  values: readonly FieldValue[],
  filled: ReadonlyMap<string, FieldFilled> = new Map(),
): NewAnswer[] {
  return form.fields.flatMap((field, at) => {
    const reply = replies[at];
    if (!reply || !isRemembered(reply.kind) || field.control === 'file') return [];
    const text = fieldValue(field, values).trim();
    if (!text || text.length > 200) return [];
    const had = replyText(reply).trim();
    if (had && plainly(had) === plainly(text)) return [];
    const kept = filled.get(field.key);
    if (kept?.kept && plainly(kept.shown) === plainly(text)) return [];
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
