import { type Bytes, fromBase64Url, toBase64Url, utf8 } from './bytes.ts';
import { type AccountKeys, lock, unlock } from './keys.ts';

const subtle = () => crypto.subtle;

async function hmac(key: AccountKeys['recordIds'], data: Bytes): Promise<string> {
  return toBase64Url(new Uint8Array(await subtle().sign('HMAC', key, data)));
}

/**
 * A record's ID: an HMAC of its name, such as "file:applications/acme/posting.md". The same
 * name always gives the same ID on every device, and the server can't tell what it names.
 */
export const recordId = (keys: AccountKeys, name: string): Promise<string> =>
  hmac(keys.recordIds, utf8(name));

/** A file's ID: an HMAC of its contents, so the same contents are stored once. */
export const fileId = (keys: AccountKeys, contents: Bytes): Promise<string> =>
  hmac(keys.fileIds, contents);

/**
 * Each version of a record is bound to its ID and version number, so the server can't swap one
 * record's data for another's, or pass an old version off under a new number.
 */
const recordPurpose = (id: string, version: number) =>
  utf8(`factwright/v1/record\n${id}\n${version}`);

/** Locks one version of a record, as text for the server to keep. */
export async function sealRecord(
  keys: AccountKeys,
  id: string,
  version: number,
  plain: Bytes,
): Promise<string> {
  return toBase64Url(await lock(keys.records, plain, recordPurpose(id, version)));
}

/** Opens one version of a record, or null when it wasn't locked for that ID and version. */
export async function openRecord(
  keys: AccountKeys,
  id: string,
  version: number,
  data: string,
): Promise<Bytes | null> {
  const locked = fromBase64Url(data);
  return locked ? unlock(keys.records, locked, recordPurpose(id, version)) : null;
}

const filePurpose = (id: string) => utf8(`factwright/v1/file\n${id}`);

/** Locks a file's contents. Returns its ID and the locked bytes to upload. */
export async function sealFile(
  keys: AccountKeys,
  contents: Bytes,
): Promise<{ id: string; data: Bytes }> {
  const id = await fileId(keys, contents);
  return { id, data: await lock(keys.files, contents, filePurpose(id)) };
}

/**
 * Opens a file's contents, or null when they weren't locked under that ID. The contents must
 * also hash to the ID, so a file can't come back changed or under another file's ID.
 */
export async function openFile(keys: AccountKeys, id: string, data: Bytes): Promise<Bytes | null> {
  const contents = await unlock(keys.files, data, filePurpose(id));
  const expected = fromBase64Url(id);
  if (!contents || !expected) return null;
  return (await subtle().verify('HMAC', keys.fileIds, expected, contents)) ? contents : null;
}
