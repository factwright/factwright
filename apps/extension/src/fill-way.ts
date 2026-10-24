import type { InboxAsk } from '@factwright/core';
import { type AccountKeys, SyncClient } from '@factwright/sync';
import {
  type Account,
  browserName,
  canReachSync,
  forgetAccount,
  loadAccount,
  syncFetch,
} from './account.ts';
import { askComputer, canReachComputer, canSendNow, destination } from './computer.ts';
import { serverName } from './server.ts';
import { type SyncAnswer, SyncFill } from './sync-fill.ts';

/**
 * Where filling a form gets its answers: from Factwright on this computer, through its helper, or
 * from your job hunt through sync, which the extension answers itself, as Factwright would
 * (src/sync-fill.ts). A browser set up to save on this computer fills from Factwright here. One set
 * up through sync fills from Factwright here too, where the browser already lets the extension
 * reach it, as filling before asked, and Factwright answers. Otherwise, as on a computer without
 * Factwright, or with it closed, it fills through sync. Each form keeps to the way its answers came,
 * for its uploads, its questions for your Claude and Mark as applied.
 */
export interface FillWay {
  via: 'computer' | 'sync';
  /** Asks for what filling needs, as the helper passes an ask to Factwright. */
  ask(ask: InboxAsk): Promise<SyncAnswer>;
}

/** Filling from Factwright on this computer. */
export const onComputer: FillWay = { via: 'computer', ask: askComputer };

/**
 * The extension's sign-in, as a fill that started with it goes on: the token to send, which follows
 * a new sign-in to the same account on the same server, as setting it up again makes. Signed out,
 * or to another account or server, it's done. The server saying it's signed out forgets the sign-in
 * only while it's still the one the server turned down, never a newer one.
 */
export function signInWatch(
  account: Account & { keys: AccountKeys },
  load: () => Promise<Account | null> = loadAccount,
  forget: () => Promise<void> = forgetAccount,
) {
  let token = account.token;
  return {
    token: () => token,
    signedIn: async () => {
      const now = await load();
      if (!now?.keys || now.server !== account.server || now.keys.id !== account.keys.id) {
        return false;
      }
      token = now.token;
      return true;
    },
    signedOut: async () => {
      if ((await load())?.token === token) await forget();
    },
  };
}

/**
 * The way through sync this page or the background fills with, for the account it's for, so each
 * fill reads only what's changed since the last, until what they read is forgotten.
 */
let shared: { key: string; fill: SyncFill; way: FillWay } | null = null;

/** Filling from your job hunt through sync, with the extension's sign-in and the account's keys. */
export function throughSync(account: Account & { keys: AccountKeys }): FillWay {
  const key = `${account.server}\n${account.keys.id}`;
  if (shared?.key === key) return shared.way;
  shared?.fill.forget();
  const watch = signInWatch(account);
  const fill = new SyncFill({
    client: new SyncClient({ server: account.server, token: watch.token, fetch: syncFetch }),
    keys: account.keys,
    device: `Factwright in ${browserName()}`,
    server: serverName(account.server),
    signedIn: watch.signedIn,
    signedOut: watch.signedOut,
  });
  const way: FillWay = { via: 'sync', ask: (ask) => fill.ask(ask) };
  shared = { key, fill, way };
  return way;
}

/**
 * Why there's no way to fill now: the browser doesn't let the extension reach Factwright on this
 * computer, which a browser that isn't set up through sync fills from, or the sync server a
 * browser set up through sync fills from.
 */
export type NoWay = { why: 'computer' } | { why: 'sync'; server: string };

/** The ways to fill now, the first to try first, or why there's none. */
export async function fillWays(): Promise<FillWay[] | NoWay> {
  const [to, computer] = await Promise.all([destination(), canReachComputer()]);
  const ways: FillWay[] = computer && canSendNow() ? [onComputer] : [];
  if (to?.to !== 'sync') return ways.length > 0 ? ways : { why: 'computer' };
  if (await canReachSync(to.account.server)) return [...ways, throughSync(to.account)];
  return ways.length > 0 ? ways : { why: 'sync', server: to.account.server };
}

/** Whether Factwright on this computer isn't there to answer: closed, or not found. */
const notThere = (answer: SyncAnswer) =>
  !answer.ok && (answer.reason === 'closed' || answer.unreachable === true);

/**
 * Plans a fill the first way that can: Factwright on this computer, unless it isn't there to
 * answer and sync can, then sync. Says which way answered, and whether that was sync standing in
 * for Factwright here.
 */
export async function firstAnswer(
  ways: readonly FillWay[],
  plan: (way: FillWay) => Promise<SyncAnswer>,
): Promise<{ way: FillWay; answer: SyncAnswer; instead: boolean }> {
  let instead = false;
  for (const [at, way] of ways.entries()) {
    const answer = await plan(way);
    if (at < ways.length - 1 && way.via === 'computer' && notThere(answer)) {
      instead = true;
      continue;
    }
    return { way, answer, instead };
  }
  throw new Error('There’s no way to fill.');
}
