import type { JobToSave, SaveResult } from './save.ts';
import { type PageAsked, readSavedFor, type SavedFor } from './saved.ts';

/**
 * What the extension's own pages ask its background to do: save a job, or look up whether the job
 * on a page is in your job hunt, through sync.
 */
export type Message = { type: 'save'; job: JobToSave } | { type: 'job'; page: PageAsked };

/** Whether something is a save the popup asked for, with every field a string. */
export function isSave(message: unknown): message is Extract<Message, { type: 'save' }> {
  if (!message || typeof message !== 'object') return false;
  const { type, job } = message as { type?: unknown; job?: unknown };
  if (type !== 'save' || !job || typeof job !== 'object') return false;
  const fields = job as Record<string, unknown>;
  return ['url', 'site', 'company', 'role', 'pay', 'posting'].every(
    (field) => typeof fields[field] === 'string',
  );
}

/** Whether something is a look-up the popup asked for, with the page's address, company and title. */
export function isLookUp(message: unknown): message is Extract<Message, { type: 'job' }> {
  if (!message || typeof message !== 'object') return false;
  const { type, page } = message as { type?: unknown; page?: unknown };
  if (type !== 'job' || !page || typeof page !== 'object') return false;
  const fields = page as Record<string, unknown>;
  return ['url', 'company', 'role'].every((field) => typeof fields[field] === 'string');
}

const NO_ANSWER: SaveResult = {
  ok: false,
  reason: 'failed',
  message: 'The extension didn’t answer. Try again.',
};

/** Asks the background to save a job, and waits for how it went. */
export async function askToSave(
  send: (message: unknown) => Promise<unknown>,
  job: JobToSave,
): Promise<SaveResult> {
  try {
    const answer = (await send({ type: 'save', job } satisfies Message)) as SaveResult | undefined;
    return answer ?? NO_ANSWER;
  } catch {
    return NO_ANSWER;
  }
}

/** Asks the background whether the job on a page is in your job hunt: null for no, or can't tell. */
export async function askForJob(
  send: (message: unknown) => Promise<unknown>,
  page: PageAsked,
): Promise<SavedFor | null> {
  try {
    return readSavedFor(await send({ type: 'job', page } satisfies Message));
  } catch {
    return null;
  }
}
