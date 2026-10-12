import type { AccountKeys } from '@factwright/sync';

const DATABASE = 'factwright';
const STORE = 'keys';

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
 * The keys this browser keeps for an account, or null before it's linked. They're Web Crypto
 * keys that can't be read back out: the page can use them, but nothing can copy them.
 */
export async function savedKeys(account: string): Promise<AccountKeys | null> {
  try {
    return ((await run('readonly', (store) => store.get(account))) as AccountKeys) ?? null;
  } catch {
    return null;
  }
}

export async function saveKeys(account: string, keys: AccountKeys): Promise<void> {
  await run('readwrite', (store) => store.put(keys, account));
}

/** Forgets every account's keys on this browser, as signing out does. */
export async function forgetKeys(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}
