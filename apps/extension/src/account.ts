import { type AccountKeys, CLIENTS, DeviceSignIn, SyncClient } from '@factwright/sync';
import { ext } from './ext.ts';
import { hostPattern } from './manifest.ts';
import { SYNC_ORIGIN } from './server.ts';

/**
 * What the extension keeps once it's set up: its own sign-in to sync, and the account's keys. The
 * keys open the whole job hunt, as each linked device's do, so they're kept as Web Crypto keys that
 * can't be read back out: this browser's copy of the extension can use them, but nothing can copy
 * them. It only ever uses them to lock what it saves, and to open the job already at the ID it
 * would save to, which may be one the app made, to tell whether it's the same job.
 */
export interface Account {
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

/** The extension's account, or null before it's signed in. */
export async function loadAccount(): Promise<Account | null> {
  try {
    return ((await run('readonly', (store) => store.get(KEY))) as Account | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveAccount(account: Account): Promise<void> {
  await run('readwrite', (store) => store.put(account, KEY));
}

/** Forgets the sign-in and the keys, as signing out does, or the server saying it's signed out. */
export async function forgetAccount(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}

/** The extension's one site, as its permission names it. */
const SYNC_SITE = { origins: [hostPattern(SYNC_ORIGIN)] };

/**
 * Whether the browser lets the extension reach Factwright's sync. Both browsers let you take that
 * away after installing it, and without it nothing saves.
 */
export const canReachSync = (): Promise<boolean> =>
  ext.permissions.contains(SYNC_SITE).catch(() => true);

/** Asks the browser to let the extension reach Factwright's sync. Only a click can ask. */
export const allowSync = (): Promise<boolean> =>
  ext.permissions.request(SYNC_SITE).catch(() => false);

/** A request to the sync server: with the extension's token, never the browser's cookies for it. */
export const syncFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: 'omit' });

/** The sync API, as the extension's session. */
export const clientFor = (token: string) =>
  new SyncClient({ server: SYNC_ORIGIN, token: () => token, fetch: syncFetch });

/** Signing the extension in, with a code the person approves in their browser. */
export const deviceSignIn = () =>
  new DeviceSignIn({ server: SYNC_ORIGIN, clientId: CLIENTS.extension, fetch: syncFetch });

/** Ends the extension's session on the server, so its sign-in can't be used again. */
export async function endSession(account: Account): Promise<void> {
  await syncFetch(new URL('/api/auth/sign-out', SYNC_ORIGIN), {
    method: 'POST',
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => {});
}

/** Ends the extension's session on the server, then forgets it and the keys here. */
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
