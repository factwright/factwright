import type { FieldReply } from './fill.ts';
import { FIELD_CONTROLS, type FieldControl, type FieldKind } from './forms.ts';
import { JOB_LIMITS } from './new-job.ts';

/**
 * Saving on this computer. Save to Factwright, the browser extension, can hand a job to Factwright
 * on the same computer through the browser's native messaging, with no account and no sync. A small
 * helper the app installs drops each job, as the extension sent it, into a small inbox in the app's
 * data folder, for the profile open last, and the app adds it from there when it's open, or at its
 * next start. This is what the extension, the helper and the app agree on. The helper, in C
 * (apps/desktop/helper), keeps to the same names and limits.
 */

/** The helper's name, as the browsers know it: what the extension asks for, and the app registers. */
export const SAVE_HELPER = 'com.factwright.save';

/** The inbox, in each profile's data folder: beside the workspace, not in it, so it never syncs. */
export const INBOX_FOLDER = 'inbox';

/**
 * A job waiting in the inbox, by its file's name: when it came, in milliseconds, then a random
 * part, so the names sort in the order the jobs came.
 */
export const INBOX_JOB = /^(\d{13})-[0-9a-f]{16}\.json$/;

/** The most jobs that wait in an inbox at once, so a computer's disk can't fill up with them. */
export const INBOX_LIMIT = 200;

/** The longest posting the app takes from the inbox, as long as the extension reads one. */
export const SAVED_POSTING_LIMIT = 100_000;

/** A job as Save to Factwright hands it over: only the job's own data, and nothing else. */
export interface SavedJob {
  /** The job's own address, http or https. */
  url: string;
  /** The site it was saved from, such as "linkedin.com". */
  site: string;
  company: string;
  /** The job's title. */
  role: string;
  pay: string;
  /** The posting's text, or nothing when only the link is saved. */
  posting: string;
}

const FIELDS = ['url', 'site', 'company', 'role', 'pay', 'posting'] as const;

/** The longest each field may be once it's read, as Add job and Save to Factwright cut them. */
const LIMITS: Record<(typeof FIELDS)[number], number> = {
  url: JOB_LIMITS.link,
  site: 200,
  company: JOB_LIMITS.company,
  role: JOB_LIMITS.role,
  pay: JOB_LIMITS.pay,
  posting: SAVED_POSTING_LIMIT,
};

/**
 * A job from the inbox, or null when it isn't one. It must be a job and nothing else, as the helper
 * checks before writing it: an object whose type is "save", with the six fields, each a string, and
 * no other key. Each field is trimmed and cut to the length Add job takes, and the link must be an
 * http or https address.
 */
export function readSavedJob(text: string): SavedJob | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (fields.type !== 'save' || keys.length !== FIELDS.length + 1) return null;
  if (!FIELDS.every((field) => typeof fields[field] === 'string')) return null;
  const job = Object.fromEntries(
    FIELDS.map((field) => [field, (fields[field] as string).trim().slice(0, LIMITS[field])]),
  ) as unknown as SavedJob;
  let url: URL;
  try {
    url = new URL(job.url);
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? job : null;
}

/**
 * What became of a saved job's posting: saved now, kept as an earlier save left it, none to save,
 * or not saved, when the job got in but its posting didn't. Saving the job again adds it.
 */
export type PostingSaved = 'saved' | 'kept' | 'none' | 'failed';

/**
 * What the app answers for a job from the inbox, which the helper hands back to the extension: the
 * job's ID, whether it was in the job hunt already, and what became of its posting. Or why it
 * couldn't be added.
 */
export type InboxAnswer =
  | { ok: true; id: string; already: boolean; posting: PostingSaved }
  | { ok: false; reason: 'bad-message' | 'failed'; message: string };

/**
 * Filling an application form, on this computer. Save to Factwright asks Factwright through the
 * same helper, which passes each ask on as it came, as `{"type":"ask","request":"…"}`, with the
 * ask itself as JSON inside, and hands back the app's answer. The helper passes an ask only to an
 * app that's open, and the app checks each one here. An ask never waits for a later start: the
 * app that answers it is the one that's open.
 */

/** An ask waiting in the inbox, by its file's name, as a job's but ending in .ask. */
export const INBOX_ASK = /^(\d{13})-[0-9a-f]{16}\.ask$/;

/** The most fields an ask may carry: a long application has a hundred or so. */
export const ASK_FIELDS = 300;

/** The most of a file one answer carries: an answer the helper passes on holds under 1 MB. */
export const FILE_PART_BYTES = 512 * 1024;

/** The longest file Factwright hands over: a resume or a cover letter is far less. */
export const FILE_LIMIT = 10 * 1024 * 1024;

/** The longest question, hint or option an ask's field may have. */
const FIELD_TEXT = 500;

/** The longest answer an ask may record or save. */
const ANSWER_TEXT = 10_000;

/** A field of a form, as an ask carries it: never what's in it. */
export interface AskedField {
  question: string;
  hint: string;
  control: FieldControl;
  type: string;
  autocomplete: string;
  name: string;
  options: string[];
  required: boolean;
  limit: number | null;
}

/** What the extension asks the app, on this computer. */
export type InboxAsk =
  /** Factwright's answers for a form's fields, with the job it's for. */
  | { ask: 'fill'; url: string; title: string; fields: AskedField[] }
  /** A part of one of a job's files, to upload. */
  | { ask: 'file'; job: string; file: 'resume' | 'cover-letter'; part: number }
  /** What you sent, once you've applied: the answers to the form's own questions. */
  | { ask: 'sent'; job: string; url: string; answers: { question: string; text: string }[] }
  /** New answers to keep in Profile, each one you chose to save. */
  | { ask: 'remember'; answers: { kind: FieldKind; text: string }[] };

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

/** A field's keys, in order: what it asks and how, and never what's in it. */
const FIELD_KEYS = 'autocomplete control hint limit name options question required type';

/** A field as an ask carries it, or null when it isn't one. */
function askedField(value: unknown): AskedField | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const field = value as Record<string, unknown>;
  const { options, limit } = field;
  if (
    Object.keys(field).sort().join(' ') !== FIELD_KEYS ||
    !isText(field.question, FIELD_TEXT) ||
    !isText(field.hint, FIELD_TEXT) ||
    !FIELD_CONTROLS.includes(field.control as FieldControl) ||
    !isText(field.type, 40) ||
    !isText(field.autocomplete, 200) ||
    !isText(field.name, FIELD_TEXT) ||
    !Array.isArray(options) ||
    options.length > ASK_FIELDS ||
    !options.every((option) => isText(option, FIELD_TEXT)) ||
    typeof field.required !== 'boolean' ||
    !(limit === null || (Number.isInteger(limit) && (limit as number) > 0))
  ) {
    return null;
  }
  return {
    question: field.question,
    hint: field.hint,
    control: field.control as FieldControl,
    type: field.type,
    autocomplete: field.autocomplete,
    name: field.name,
    options: options as string[],
    required: field.required,
    limit: limit as number | null,
  };
}

/** Whether something is a web page's address. */
const isPage = (value: unknown): value is string => {
  if (!isText(value, JOB_LIMITS.link)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

/** A job's ID, as the tracker makes them. */
const isJobId = (value: unknown): value is string =>
  isText(value, 200) && /^[a-z0-9][a-z0-9-]*$/.test(value);

/**
 * An ask from the inbox, or null when it isn't one: a message whose type is "ask", with the ask
 * itself as JSON in its request, and nothing else. Each kind of ask has its own fields, each
 * checked, and no others.
 */
export function readInboxAsk(text: string): InboxAsk | null {
  let message: unknown;
  let value: unknown;
  try {
    message = JSON.parse(text);
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return null;
    const { type, request, ...rest } = message as Record<string, unknown>;
    if (type !== 'ask' || typeof request !== 'string' || Object.keys(rest).length > 0) return null;
    value = JSON.parse(request);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const asked = value as Record<string, unknown>;
  const keys = Object.keys(asked).sort().join(' ');
  if (asked.ask === 'fill' && keys === 'ask fields title url') {
    if (!isPage(asked.url) || !isText(asked.title, 1000) || !Array.isArray(asked.fields))
      return null;
    if (asked.fields.length > ASK_FIELDS) return null;
    const fields = asked.fields.map(askedField);
    if (!fields.every((field): field is AskedField => field !== null)) return null;
    return { ask: 'fill', url: asked.url, title: asked.title, fields };
  }
  if (asked.ask === 'file' && keys === 'ask file job part') {
    const { job, file, part } = asked;
    if (!isJobId(job) || (file !== 'resume' && file !== 'cover-letter')) return null;
    if (
      !Number.isInteger(part) ||
      (part as number) < 0 ||
      (part as number) >= FILE_LIMIT / FILE_PART_BYTES
    ) {
      return null;
    }
    return { ask: 'file', job, file, part: part as number };
  }
  if (asked.ask === 'sent' && keys === 'answers ask job url') {
    const { job, url, answers } = asked;
    if (!isJobId(job) || !isPage(url) || !Array.isArray(answers) || answers.length > ASK_FIELDS) {
      return null;
    }
    const read = answers.map((each) => {
      if (typeof each !== 'object' || each === null) return null;
      const { question, text, ...more } = each as Record<string, unknown>;
      return Object.keys(more).length === 0 &&
        isText(question, FIELD_TEXT) &&
        isText(text, ANSWER_TEXT)
        ? { question, text }
        : null;
    });
    if (!read.every((each): each is { question: string; text: string } => each !== null))
      return null;
    return { ask: 'sent', job, url, answers: read };
  }
  if (asked.ask === 'remember' && keys === 'answers ask') {
    const { answers } = asked;
    if (!Array.isArray(answers) || answers.length > 50) return null;
    const read = answers.map((each) => {
      if (typeof each !== 'object' || each === null) return null;
      const { kind, text, ...more } = each as Record<string, unknown>;
      return Object.keys(more).length === 0 && typeof kind === 'string' && isText(text, ANSWER_TEXT)
        ? { kind: kind as FieldKind, text }
        : null;
    });
    if (!read.every((each): each is { kind: FieldKind; text: string } => each !== null))
      return null;
    return { ask: 'remember', answers: read };
  }
  return null;
}

/** A job, as the app tells the extension of it: enough to say which it is, and if you applied. */
export interface AskedJob {
  id: string;
  company: string;
  role: string;
  status: string;
  /** When you applied, as an ISO date, or null before then. */
  appliedOn: string | null;
}

/** One of a job's files, as the app offers it: its name, its size, and how many parts it's in. */
export interface OfferedFile {
  name: string;
  size: number;
  parts: number;
}

/** What the app answers an ask with, or why it couldn't. */
export type InboxAskAnswer =
  | {
      ok: true;
      did: 'fill';
      /** The job the form is for, or null when it isn't one you saved. */
      job: AskedJob | null;
      /** An answer for each field, in the ask's order. */
      replies: FieldReply[];
      files: { resume: OfferedFile | null; 'cover-letter': OfferedFile | null };
    }
  | { ok: true; did: 'file'; part: number; parts: number; base64: string }
  | { ok: true; did: 'sent'; job: AskedJob; recorded: number }
  | { ok: true; did: 'remember'; saved: number }
  | {
      ok: false;
      /**
       * Why: the app isn't open, it didn't answer in time, the ask wasn't one, it's for a job or
       * file that isn't there, or it couldn't be done.
       */
      reason: 'closed' | 'busy' | 'bad-message' | 'not-found' | 'failed';
      message?: string;
    };
