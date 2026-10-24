import {
  type InboxAsk,
  type InboxAskAnswer,
  SAVE_HELPER,
  SAVED_POSTING_LIMIT,
} from '@factwright/core';
import type { AccountKeys } from '@factwright/sync';
import { type Account, loadAccount } from './account.ts';
import { ext, type Permissions } from './ext.ts';
import type { JobToSave, PostingSaved, SaveResult } from './save.ts';
import { settings } from './settings.ts';

/**
 * Saving straight to Factwright on this computer, with no account and no sync. The browser hands
 * each job to a small helper Factwright installs and registers with each browser it finds, through
 * the browser's native messaging. The helper drops the job in Factwright's data folder, and
 * Factwright adds it when it's open, or the next time it opens. Each browser lets only the
 * extension's own ID reach the helper, and the extension asks the browser for native messaging
 * only when you choose this in setup.
 */

/** Native messaging, which the extension asks for only to save to Factwright on this computer. */
const NATIVE: Permissions = { permissions: ['nativeMessaging'] };

/** Whether the browser lets the extension talk to Factwright on this computer. */
export const canReachComputer = (): Promise<boolean> =>
  ext.permissions.contains(NATIVE).catch(() => false);

/**
 * Asks the browser to let the extension talk to Factwright on this computer. Only a click can ask,
 * and Firefox takes it only before the click has waited on anything, so it comes first: the
 * request is made before this waits on anything itself.
 */
export async function allowComputer(): Promise<boolean> {
  try {
    return await ext.permissions.request(NATIVE);
  } catch {
    return false;
  }
}

/** Gives native messaging back, once the extension saves through sync instead. */
export const giveBackComputer = (): Promise<unknown> =>
  ext.permissions.remove(NATIVE).catch(() => false);

/**
 * Where the extension saves now: through sync, once it's signed in and linked, or else to
 * Factwright on this computer, if you chose that in setup, or nowhere until it's set up. A sign-in
 * that's under way doesn't change where saves go until it's linked.
 */
export type Destination =
  | { to: 'sync'; account: Account & { keys: AccountKeys } }
  | { to: 'computer' }
  | null;

export async function destination(
  load: () => Promise<Account | null> = loadAccount,
): Promise<Destination> {
  const account = await load();
  if (account?.keys) return { to: 'sync', account: { ...account, keys: account.keys } };
  return (await settings()).where === 'computer' ? { to: 'computer' } : null;
}

/** What to say when Factwright on this computer can't be reached, by what the browser said. */
function unreachable(error: unknown): { missing: boolean; message: string } {
  const said = error instanceof Error ? error.message : String(error);
  // Chrome's words for a helper that isn't registered, isn't for this extension, or isn't where
  // its registration says, as when Factwright was moved to the trash, and Firefox's for one that
  // isn't registered or isn't for this extension. For one that isn't where its registration says,
  // Firefox says only that something unexpected went wrong, as it does for a helper that stops
  // without answering, which Factwright's never does unless it's broken: getting Factwright again
  // is the way out of both.
  if (
    /not found|forbidden|failed to start|no such native application|^an unexpected error occurred$/i.test(
      said,
    )
  ) {
    return {
      missing: true,
      message:
        'The extension couldn’t find Factwright on this computer. Install it from factwright.com, or update it, and open it. On a Mac, then choose Browser extension in its sidebar, and set up this browser.',
    };
  }
  return { missing: false, message: 'Factwright on this computer didn’t answer. Try again.' };
}

/**
 * Whether this page, or the background, can send to Factwright on this computer now. Chrome makes
 * each one's chrome.runtime once, with only what it may do then, and keeps it, so one that used
 * chrome.runtime before the browser allowed native messaging can't send until it starts again.
 * The background always has, until it next restarts, while a page opened since, such as the popup,
 * can send. Firefox adds it to each as soon as it's allowed.
 */
export const canSendNow = (): boolean => typeof ext.runtime.sendNativeMessage === 'function';

/** Sends the helper a message, and waits for its answer. */
async function send(message: Record<string, string>): Promise<unknown> {
  if (!ext.runtime.sendNativeMessage) throw new Error('native messaging not allowed');
  return ext.runtime.sendNativeMessage(SAVE_HELPER, message);
}

/** What looking for Factwright on this computer found: its version, or why it can't be reached. */
export type Found =
  | { ok: true; version: string }
  | { ok: false; missing: boolean; message: string };

/** Looks for Factwright on this computer, as setup does before saving there. */
export async function findComputer(): Promise<Found> {
  let answer: unknown;
  try {
    answer = await send({ type: 'hello' });
  } catch (error) {
    return { ok: false, ...unreachable(error) };
  }
  const { ok, version } = (answer ?? {}) as { ok?: unknown; version?: unknown };
  return ok === true && typeof version === 'string'
    ? { ok: true, version }
    : {
        ok: false,
        missing: false,
        message: 'Factwright on this computer didn’t answer. Try again.',
      };
}

const POSTINGS: readonly PostingSaved[] = ['saved', 'kept', 'none', 'failed'];

/** Why a job didn't save on this computer, and what to say. */
interface Problem {
  reason: 'no-app' | 'full' | 'failed';
  message: string;
}

/** What the helper's reasons mean, in words. */
const REASONS: Record<string, Problem> = {
  'no-factwright': {
    reason: 'no-app',
    message: 'Open Factwright on this computer once, then save it again.',
  },
  full: {
    reason: 'full',
    message:
      'Factwright on this computer has 200 saved jobs waiting. Open it to add them, then save this one again.',
  },
  'too-big': {
    reason: 'failed',
    message: 'This posting is too long to save. Select the posting’s text, then save it again.',
  },
  'bad-message': {
    reason: 'failed',
    message: 'Factwright on this computer couldn’t take this job. Try again.',
  },
};

/** Anything else: the helper couldn't keep the job. */
const NOT_KEPT: Problem = {
  reason: 'failed',
  message:
    'Factwright on this computer couldn’t keep this job. Check the computer has room, then try again.',
};

/**
 * How a save went, by the helper's answer: Factwright's own, when it was open and took the job, or
 * the helper's, when the job waits for Factwright to open, or couldn't be kept.
 */
export function readAnswer(answer: unknown): SaveResult {
  if (typeof answer !== 'object' || answer === null) return failedWith(NOT_KEPT);
  const said = answer as Record<string, unknown>;
  if (said.ok === true && said.later === true) {
    return said.open === true ? { ok: true, later: true, open: true } : { ok: true, later: true };
  }
  if (
    said.ok === true &&
    typeof said.id === 'string' &&
    typeof said.already === 'boolean' &&
    POSTINGS.includes(said.posting as PostingSaved)
  ) {
    return { ok: true, id: said.id, already: said.already, posting: said.posting as PostingSaved };
  }
  if (said.ok === false && typeof said.message === 'string' && said.message) {
    return { ok: false, reason: 'failed', message: said.message.slice(0, 300) };
  }
  const known = typeof said.reason === 'string' && Object.hasOwn(REASONS, said.reason);
  return failedWith((known && REASONS[said.reason as string]) || NOT_KEPT);
}

const failedWith = ({ reason, message }: Problem): SaveResult => ({ ok: false, reason, message });

/**
 * Saves a job to Factwright on this computer. Only the job's own data goes, field by field, as
 * the extension checked it, and never anything else from the page.
 */
export async function saveOnComputer(job: JobToSave): Promise<SaveResult> {
  if (!(await canReachComputer())) {
    return {
      ok: false,
      reason: 'no-access',
      message: 'The browser doesn’t let the extension reach Factwright on this computer.',
    };
  }
  if (!canSendNow()) {
    return {
      ok: false,
      reason: 'failed',
      message: 'Close this, then click the Factwright button again to save it.',
    };
  }
  try {
    return readAnswer(
      await send({
        type: 'save',
        url: job.url,
        site: job.site,
        company: job.company,
        role: job.role,
        pay: job.pay,
        posting: job.posting.slice(0, SAVED_POSTING_LIMIT),
      }),
    );
  } catch (error) {
    const { missing, message } = unreachable(error);
    return { ok: false, reason: missing ? 'no-app' : 'failed', message };
  }
}

/**
 * What asking Factwright on this computer can't do, and why, as the panel says it. `unreachable`
 * says the ask never got to Factwright: the browser couldn't start its helper, or it didn't answer.
 */
export type NotAsked = Extract<InboxAskAnswer, { ok: false }> & {
  message: string;
  unreachable?: true;
};

/** Why an ask got no answer, in words. */
const ASK_REASONS: Record<string, string> = {
  closed: 'Open Factwright on this computer to fill this page, then click Fill again.',
  busy: 'Factwright on this computer is busy. Try again in a moment.',
  'not-found': 'That isn’t in Factwright anymore. Click Fill again.',
  'too-big': 'That’s more than Factwright on this computer can answer at once.',
  'bad-message': 'Factwright on this computer couldn’t take that. Update it, then try again.',
  failed: 'Factwright on this computer couldn’t do that. Try again.',
};

/**
 * Asks Factwright on this computer something, as filling a form does, through the helper, and
 * waits for its answer. The helper passes an ask only to an app that's open. Only what the ask
 * says goes, as the extension built it, and never what's in the page's fields, until you mark the
 * job applied and it sends the answers to the form's own questions.
 */
export async function askComputer(
  ask: InboxAsk,
): Promise<Extract<InboxAskAnswer, { ok: true }> | NotAsked> {
  if (!(await canReachComputer())) {
    return {
      ok: false,
      reason: 'failed',
      message: 'The browser doesn’t let Factwright reach Factwright on this computer.',
      unreachable: true,
    };
  }
  if (!canSendNow()) {
    return {
      ok: false,
      reason: 'failed',
      message: 'Close this, then click the Factwright button again.',
      unreachable: true,
    };
  }
  let answer: unknown;
  try {
    answer = await send({ type: 'ask', request: JSON.stringify(ask) });
  } catch (error) {
    return { ok: false, reason: 'failed', message: unreachable(error).message, unreachable: true };
  }
  const said = (answer ?? {}) as Record<string, unknown>;
  if (said.ok === true && typeof said.did === 'string' && said.did === ask.ask) {
    return answer as Extract<InboxAskAnswer, { ok: true }>;
  }
  const reason = typeof said.reason === 'string' ? said.reason : 'failed';
  const message =
    typeof said.message === 'string' && said.message
      ? said.message.slice(0, 300)
      : (ASK_REASONS[reason] ?? 'Factwright on this computer couldn’t do that. Try again.');
  return {
    ok: false,
    reason: (Object.hasOwn(ASK_REASONS, reason) ? reason : 'failed') as NotAsked['reason'],
    message,
  };
}
