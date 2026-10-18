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

/**
 * Save to Factwright's IDs, the only extensions the browsers let reach the helper: its Chrome Web
 * Store item, which Chrome, Edge, Brave, Arc and Vivaldi all install it from, and its Firefox ID.
 */
export const EXTENSION_IDS = {
  chrome: 'gjhjddlohoonikgdbfcfnljeffilblai',
  firefox: 'save@factwright.com',
} as const;

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
