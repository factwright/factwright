import type { AskedJob } from '@factwright/core';
import type { Tab } from './ext.ts';
import type { JobToSave, SaveResult } from './save.ts';
import { type PageAsked, readSavedFor, type SavedFor } from './saved.ts';

/**
 * What the extension's own pages ask its background to do: save a job, look up whether the job on
 * a page is in your job hunt, through sync, fill the form in a tab in its page, as the popup's Fill
 * does, mark a job applied, as its Mark as applied does, or take that back, by its note.
 */
export type Message =
  | { type: 'save'; job: JobToSave }
  | { type: 'job'; page: PageAsked }
  | { type: 'fill'; tab: Tab & { id: number } }
  | { type: 'applied'; tabId: number; job: AskedJob; via: 'computer' | 'sync'; url: string }
  | { type: 'undo'; tabId: number; token: string };

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether something is a fill the popup asked for, of a tab by its number. */
export function isFill(message: unknown): message is Extract<Message, { type: 'fill' }> {
  if (!isObject(message) || message.type !== 'fill' || !isObject(message.tab)) return false;
  const { id, windowId, url, title } = message.tab;
  return (
    Number.isInteger(id) &&
    (windowId === undefined || Number.isInteger(windowId)) &&
    (url === undefined || typeof url === 'string') &&
    (title === undefined || typeof title === 'string')
  );
}

/** Whether something is Mark as applied, as the popup asks it, for a job it found. */
export function isApplied(message: unknown): message is Extract<Message, { type: 'applied' }> {
  if (!isObject(message) || message.type !== 'applied' || !isObject(message.job)) return false;
  const { id, company, role, status, appliedOn } = message.job;
  return (
    Number.isInteger(message.tabId) &&
    (message.via === 'computer' || message.via === 'sync') &&
    typeof message.url === 'string' &&
    [id, company, role, status].every((each) => typeof each === 'string') &&
    (appliedOn === null || typeof appliedOn === 'string')
  );
}

/** Whether something is Undo, as the popup asks it, by a note's token. */
export function isUndo(message: unknown): message is Extract<Message, { type: 'undo' }> {
  return (
    isObject(message) &&
    message.type === 'undo' &&
    Number.isInteger(message.tabId) &&
    typeof message.token === 'string'
  );
}
