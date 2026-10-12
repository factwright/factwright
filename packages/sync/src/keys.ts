import { type Bytes, concat, fromBase64Url, randomBytes, toBase64Url, utf8 } from './bytes.ts';
import { fromCode, toCode } from './code.ts';

/** A Web Crypto key. Written this way so it means the same in Node, browsers and Workers. */
export type Key = Awaited<ReturnType<(typeof crypto.subtle)['importKey']>>;

/** The account key: 32 random bytes that every other key comes from. It never leaves a device. */
export const ACCOUNT_KEY_BYTES = 32;

/** A recovery key: 160 random bits, written as 32 characters for people to keep. */
export const RECOVERY_KEY_BYTES = 20;

/** A link code: 160 random bits, shown as a QR code and as 32 characters to type. */
export const LINK_CODE_BYTES = 20;

/** The keys a device uses, all made from the account key. None of them can be read back out. */
export interface AccountKeys {
  /** Names the account key without revealing it, so devices can tell they hold the same one. */
  id: string;
  /** Locks each record: what a synced file is called, or what a tracked row says. */
  records: Key;
  /** Locks the contents of files. */
  files: Key;
  /** Turns a record's name, such as a file's path, into an ID that reveals nothing. */
  recordIds: Key;
  /** Turns a file's contents into an ID, so the same contents are stored once. */
  fileIds: Key;
}

/** A secret written for people: the bytes, and the same as text in groups of four. */
export interface WrittenSecret {
  bytes: Bytes;
  text: string;
}

const subtle = () => crypto.subtle;

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;
const SALT = utf8('factwright');
const AES = { name: 'AES-GCM', length: 256 } as const;
const HMAC = { name: 'HMAC', hash: 'SHA-256', length: 256 } as const;

const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: utf8(info) });

const hkdfBase = (secret: Bytes) =>
  subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey', 'deriveBits']);

export const newAccountKey = (): Bytes => randomBytes(ACCOUNT_KEY_BYTES);

/** Makes the keys a device uses from the account key. Each has its own purpose, by HKDF. */
export async function accountKeys(accountKey: Bytes): Promise<AccountKeys> {
  if (accountKey.length !== ACCOUNT_KEY_BYTES) throw new Error('An account key is 32 bytes.');
  const base = await hkdfBase(accountKey);
  const [records, files, recordIds, fileIds, id] = await Promise.all([
    subtle().deriveKey(hkdf('factwright/v1/records'), base, AES, false, ['encrypt', 'decrypt']),
    subtle().deriveKey(hkdf('factwright/v1/files'), base, AES, false, ['encrypt', 'decrypt']),
    subtle().deriveKey(hkdf('factwright/v1/record-ids'), base, HMAC, false, ['sign']),
    subtle().deriveKey(hkdf('factwright/v1/file-ids'), base, HMAC, false, ['sign', 'verify']),
    subtle().deriveBits(hkdf('factwright/v1/key-id'), base, 128),
  ]);
  return { id: toBase64Url(new Uint8Array(id)), records, files, recordIds, fileIds };
}

/**
 * Locks bytes with AES-256-GCM under a fresh random nonce. What it's for (the "additional
 * data") is bound in, so a locked value can't be passed off as something else. The result is a
 * version byte, the nonce, then the ciphertext with its tag.
 */
export async function lock(key: Key, plain: Bytes, purpose: Bytes): Promise<Bytes> {
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: purpose },
    key,
    plain,
  );
  return concat(Uint8Array.of(ENVELOPE_VERSION), nonce, new Uint8Array(sealed));
}

/** Opens what lock() locked, or null when the key, the purpose or any byte is wrong. */
export async function unlock(key: Key, locked: Bytes, purpose: Bytes): Promise<Bytes | null> {
  if (locked.length < 1 + NONCE_BYTES + TAG_BYTES || locked[0] !== ENVELOPE_VERSION) return null;
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: locked.subarray(1, 1 + NONCE_BYTES), additionalData: purpose },
      key,
      locked.subarray(1 + NONCE_BYTES),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

/** A key that locks the account key, made from a recovery key or a link code. */
async function wrappingKey(secret: Bytes, purpose: string): Promise<Key> {
  return subtle().deriveKey(hkdf(purpose), await hkdfBase(secret), AES, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function wrap(accountKey: Bytes, secret: Bytes, purpose: string): Promise<string> {
  const key = await wrappingKey(secret, purpose);
  return toBase64Url(await lock(key, accountKey, utf8(purpose)));
}

async function unwrap(locked: string, secret: Bytes, purpose: string): Promise<Bytes | null> {
  const envelope = fromBase64Url(locked);
  if (!envelope) return null;
  const opened = await unlock(await wrappingKey(secret, purpose), envelope, utf8(purpose));
  return opened?.length === ACCOUNT_KEY_BYTES ? opened : null;
}

const RECOVERY = 'factwright/v1/recovery';

export function newRecoveryKey(): WrittenSecret {
  const bytes = randomBytes(RECOVERY_KEY_BYTES);
  return { bytes, text: toCode(bytes) };
}

/** The recovery key someone typed, or null when it isn't one. Case, dashes and spaces don't matter. */
export const readRecoveryKey = (text: string): Bytes | null => fromCode(text, RECOVERY_KEY_BYTES);

/** The account key locked with a recovery key. The server keeps this, and can't open it. */
export const lockWithRecoveryKey = (accountKey: Bytes, recoveryKey: Bytes): Promise<string> =>
  wrap(accountKey, recoveryKey, RECOVERY);

/** The account key, from what the server keeps and the recovery key, or null for a wrong key. */
export const openWithRecoveryKey = (locked: string, recoveryKey: Bytes): Promise<Bytes | null> =>
  unwrap(locked, recoveryKey, RECOVERY);

export function newLinkCode(): WrittenSecret {
  const bytes = randomBytes(LINK_CODE_BYTES);
  return { bytes, text: toCode(bytes) };
}

/** The link code someone typed, or null when it isn't one. */
export const readLinkCode = (text: string): Bytes | null => fromCode(text, LINK_CODE_BYTES);

/**
 * The ID a link is kept under on the server: a hash of its code. The server can look a link up
 * by it, but can't work out the code, which only the two devices see.
 */
export async function linkId(code: Bytes): Promise<string> {
  const digest = await subtle().digest('SHA-256', concat(utf8('factwright/v1/link-id\n'), code));
  return toBase64Url(new Uint8Array(digest).subarray(0, 16));
}

const linkPurpose = (id: string) => `factwright/v1/link\n${id}`;

/** The account key locked with a link code, for a new device to pick up. */
export async function lockForLink(
  accountKey: Bytes,
  code: Bytes,
): Promise<{ id: string; data: string }> {
  const id = await linkId(code);
  return { id, data: await wrap(accountKey, code, linkPurpose(id)) };
}

/** The account key a link holds, or null when the code doesn't open it. */
export async function openLink(data: string, code: Bytes): Promise<Bytes | null> {
  return unwrap(data, code, linkPurpose(await linkId(code)));
}
