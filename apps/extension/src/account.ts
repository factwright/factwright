import {
  type AccountKeys,
  CLIENTS,
  DeviceSignIn,
  type SignInResult,
  SyncClient,
  WindowSignIn,
} from '@factwright/sync';
import { ext } from './ext.ts';
import { hostPattern } from './manifest.ts';
import { DEFAULT_SERVER, isOwn } from './server.ts';

/**
 * What the extension keeps once it's set up: its own sign-in to sync, and the account's keys. The
 * keys open the whole job hunt, as each linked device's do, so they're kept as Web Crypto keys that
 * can't be read back out: this browser's copy of the extension can use them, but nothing can copy
 * them. It only ever uses them to lock what it saves, and to open the job already at the ID it
 * would save to, which may be one the app made, to tell whether it's the same job.
 */
export interface Account {
  /**
   * The sync server the sign-in is for, as an origin: Factwright's, or a server of your own. The
   * token and everything the extension saves go there, and nowhere else.
   */
  server: string;
  /** The account's ID and email, as sync knows them. */
  user: string;
  email: string;
  /** The extension's own session, sent as a bearer token. */
  token: string;
  /** The account's keys, once the extension is linked. */
  keys: AccountKeys | null;
}

const DATABASE = 'save-to-factwright';
const STORE = 'account';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

/**
 * The account as it was saved, or null. One saved before you could choose a server is for the one
 * the extension was built for, the only server it used then.
 */
export function readAccount(saved: unknown): Account | null {
  if (!saved || typeof saved !== 'object') return null;
  const { server } = saved as Partial<Account>;
  return { ...(saved as Account), server: typeof server === 'string' ? server : DEFAULT_SERVER };
}

/** The extension's account, or null before it's signed in. */
export async function loadAccount(): Promise<Account | null> {
  try {
    return readAccount(await run('readonly', (store) => store.get(KEY)));
  } catch {
    return null;
  }
}

/** Keeps the account, and lets the extension reach its server alone (see reachOnly). */
export async function saveAccount(account: Account): Promise<void> {
  await run('readwrite', (store) => store.put(account, KEY));
  await reachOnly(account.server);
}

/**
 * Forgets the sign-in and the keys, as signing out does, or the server saying it's signed out, and
 * gives back the browser's permission for a server of your own.
 */
export async function forgetAccount(): Promise<void> {
  await run('readwrite', (store) => store.clear());
  await reachOnly(null);
}

/** A sync server's site, as the browser's permission names it. */
const siteOf = (server: string) => ({ origins: [hostPattern(server)] });

/**
 * Whether the browser lets the extension reach a sync server. Both browsers let you take that away
 * after installing it, and without it nothing saves.
 */
export const canReachSync = (server: string): Promise<boolean> =>
  ext.permissions.contains(siteOf(server)).catch(() => true);

/**
 * Asks the browser to let the extension reach a sync server: Factwright's, which it has from being
 * installed unless you took it away, or a server of your own, its address alone. Only a click can
 * ask, and Firefox takes it only before the click has waited on anything, so it comes first.
 */
export const allowSync = (server: string): Promise<boolean> =>
  ext.permissions.request(siteOf(server)).catch(() => false);

/**
 * One server's site, as setup asks for it: never a wildcard, such as all https sites, which only
 * you can allow, in the browser's own settings. Firefox then lets the extension reach your server
 * through it, without a site of its own, so it's never given back.
 */
const ONE_SITE = /^https?:\/\/[^/*]+\/\*$/;

/** Gives back a site, if the browser will. */
async function giveBackSite(site: string): Promise<void> {
  try {
    await ext.permissions.remove({ origins: [site] });
  } catch {
    // Not one it can give back, such as one the browser grants on its own.
  }
}

/**
 * Gives back the browser's permission for each server of your own the extension isn't signed in
 * to, once its account changes: one it signed out of, or one a sign-in elsewhere asked for. It
 * keeps the server its sign-in is for, if it has one, and the one it was built for, which its
 * manifest asks for. Each is given back on its own, so one the browser won't give back stops none
 * of the others.
 */
export async function reachOnly(server: string | null): Promise<void> {
  const keep = new Set([DEFAULT_SERVER, ...(server ? [server] : [])].map(hostPattern));
  let granted: string[] = [];
  try {
    granted = (await ext.permissions.getAll()).origins ?? [];
  } catch {
    return;
  }
  await Promise.all(
    granted.filter((site) => ONE_SITE.test(site) && !keep.has(site)).map(giveBackSite),
  );
}

/**
 * Gives back the browser's permission for a server setup asked for, once signing in there failed
 * or was canceled, unless the extension is signed in there already (`signedInTo`), or was built
 * for it. A sign-in in another setup tab keeps what it asked for.
 */
export async function giveBack(server: string, signedInTo: string | null): Promise<void> {
  const keep = [DEFAULT_SERVER, ...(signedInTo ? [signedInTo] : [])].map(hostPattern);
  if (!keep.includes(hostPattern(server))) await giveBackSite(hostPattern(server));
}

/** A request to the sync server: with the extension's token, never the browser's cookies for it. */
export const syncFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: 'omit' });

/** The sync API on a server, as the extension's session there. */
export const clientFor = (server: string, token: string) =>
  new SyncClient({ server, token: () => token, fetch: syncFetch });

/**
 * Signing the extension in with a code the person approves in their browser: only ever with the
 * server it was built for, since a server of your own could pass along another server's code
 * (signInWay, in server.ts).
 */
export function deviceSignIn(server: string): DeviceSignIn {
  if (isOwn(server)) {
    throw new Error(
      'The extension signs in to a server of your own through the browser’s window alone.',
    );
  }
  return new DeviceSignIn({ server, clientId: CLIENTS.extension, fetch: syncFetch });
}

/**
 * Where this copy's sign-in window returns to, as the browser names it for this extension alone,
 * or null in a browser with no such window.
 */
export function returnAddress(): string | null {
  try {
    return ext.identity?.getRedirectURL() ?? null;
  } catch {
    return null;
  }
}

/** What each browser says when the person closes the window, which is canceling. */
const CLOSED = new Set(['The user did not approve access.', 'User cancelled or denied access.']);

/**
 * Signs the extension in through the browser's own window (WindowSignIn): the server's page asks
 * there, where the person signs in if they need to, and only this extension gets the answer.
 */
export async function windowSignIn(server: string, redirect: string): Promise<SignInResult> {
  const flow = new WindowSignIn({ server, redirect, fetch: syncFetch });
  const url = await flow.start();
  let returned: string | undefined;
  try {
    returned = await ext.identity?.launchWebAuthFlow({ url, interactive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return CLOSED.has(message)
      ? { ok: false, reason: 'canceled', message: 'Signing in was canceled.' }
      : { ok: false, reason: 'failed', message };
  }
  if (!returned) return { ok: false, reason: 'canceled', message: 'Signing in was canceled.' };
  return flow.finish(returned);
}

/** How long signing out waits for the server, before forgetting the sign-in here anyway. */
const SIGN_OUT_MS = 10_000;

/** Ends the extension's session on the server, so its sign-in can't be used again. */
export async function endSession(account: Pick<Account, 'server' | 'token'>): Promise<void> {
  await syncFetch(new URL('/api/auth/sign-out', account.server), {
    method: 'POST',
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(SIGN_OUT_MS),
  }).catch(() => {});
}

/**
 * Ends the extension's session on the server, then forgets it and the keys here, which gives back
 * the permission to reach a server of your own.
 */
export async function signOut(account: Account | null): Promise<void> {
  if (account) await endSession(account);
  await forgetAccount();
}

/** The browser the extension is in, for the name its saves carry, such as "Chrome". */
export function browserName(userAgent: string = globalThis.navigator?.userAgent ?? ''): string {
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Edg\//.test(userAgent)) return 'Edge';
  return 'Chrome';
}
