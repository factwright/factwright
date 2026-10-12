/**
 * The sync protocol: what devices and the sync server send each other. Everything here is
 * either opaque (IDs, locked data) or about the account itself, never what's in a job hunt.
 */

/** Limits the server holds every account to. A free service invites abuse, so they're firm. */
export const LIMITS = {
  /** The biggest file that syncs. Bigger ones stay on the computer they're on. */
  fileBytes: 25 * 1024 * 1024,
  /** The biggest locked record. A tracked row is a few hundred bytes. */
  recordChars: 300_000,
  /** Changes in one push. */
  changesPerPush: 100,
  /** Changes in one page of a pull. */
  changesPerPage: 500,
  /** How long a link code works. */
  linkMinutes: 10,
  /** Link codes waiting at once. */
  linksAtOnce: 5,
  /** IDs in one check for missing files. */
  filesPerCheck: 500,
} as const;

/** A record or file ID: 32 bytes of HMAC in URL-safe base64. */
const ID = /^[A-Za-z0-9_-]{43}$/;
/** A link's ID: 16 bytes of hash in URL-safe base64. */
const LINK_ID = /^[A-Za-z0-9_-]{22}$/;
/** A key ID: 16 bytes in URL-safe base64. */
const KEY_ID = /^[A-Za-z0-9_-]{22}$/;

export const isRecordId = (value: unknown): value is string =>
  typeof value === 'string' && ID.test(value);
export const isFileId = isRecordId;
export const isLinkId = (value: unknown): value is string =>
  typeof value === 'string' && LINK_ID.test(value);
export const isKeyId = (value: unknown): value is string =>
  typeof value === 'string' && KEY_ID.test(value);

/** Where each part of the API lives on the server. */
export const API = {
  keys: '/api/sync/keys',
  changes: '/api/sync/changes',
  records: '/api/sync/records',
  files: '/api/sync/files',
  missingFiles: '/api/sync/files/missing',
  links: '/api/sync/links',
  liveTicket: '/api/sync/live/ticket',
  live: '/api/sync/live',
  account: '/api/account',
  devices: '/api/account/devices',
  export: '/api/account/export',
} as const;

/** The account key, locked with the recovery key, as the server keeps it. */
export interface KeyRecord {
  /** Which account key it is: devices check theirs matches. */
  keyId: string;
  /** The account key locked with the recovery key. The server can't open it. */
  recovery: string;
  /** When it was saved, as an ISO time. */
  savedAt: string;
}

/** One version of a record, as the server keeps it. */
export interface Change {
  /** The record's ID. */
  record: string;
  /** Its version: 1 for the first, then one more for each change. */
  version: number;
  /** Where it falls among all the account's changes, to pull from. */
  seq: number;
  /** The record, locked. */
  data: string;
  /** The ID of the file contents it points to, so the server can tell which it still needs. */
  file: string | null;
  deleted: boolean;
  /** When the server took it, as an ISO time. */
  at: string;
}

/** A page of changes, after a point in the account's history. */
export interface ChangesPage {
  changes: Change[];
  /** Where this page ends: the next pull starts after it. */
  cursor: number;
  /** Whether there's another page. */
  more: boolean;
}

/** A new version of a record, made on a device from the version it last saw. */
export interface PushChange {
  record: string;
  /** The version this change was made from, or 0 for a new record. */
  base: number;
  data: string;
  file: string | null;
  deleted: boolean;
}

/** What happened to one pushed change. */
export type PushResult =
  | { record: string; ok: true; version: number; seq: number }
  /** Another device changed it first. Here's its version, to merge with. */
  | { record: string; ok: false; reason: 'conflict'; current: Change }
  /** The file contents it points to haven't been uploaded. */
  | { record: string; ok: false; reason: 'missing-file' }
  /** The account is out of space. */
  | { record: string; ok: false; reason: 'full' };

export interface PushResponse {
  results: PushResult[];
}

/** One earlier version of a record, without its data. */
export interface VersionInfo {
  version: number;
  seq: number;
  at: string;
  deleted: boolean;
  file: string | null;
}

/** A device signed in to the account. */
export interface Device {
  id: string;
  /** What it is, such as "Factwright on Steve's MacBook Pro" or "Safari on iPhone". */
  name: string;
  /** Whether it's the one asking. */
  current: boolean;
  /** When it was last used, as an ISO time. */
  lastActive: string;
  since: string;
}

export interface AccountInfo {
  user: { id: string; email: string; name: string; since: string };
  devices: Device[];
  usage: {
    /** Bytes stored, counting each file's contents once. */
    bytes: number;
    /** The most the account may store. */
    limit: number;
    records: number;
    files: number;
  };
}

/** What the server says when a request fails. */
export interface ErrorBody {
  error: string;
  message: string;
}
