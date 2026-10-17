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
  /** Characters in one push, all its changes together. */
  pushChars: 4_000_000,
  /** Changes in one page of a pull. */
  changesPerPage: 500,
  /** How long a link code works. */
  linkMinutes: 10,
  /** Link codes waiting at once. */
  linksAtOnce: 5,
  /** How long a new device's request to link waits to be approved. */
  requestMinutes: 10,
  /** Requests to link waiting at once. Each session has one at most. */
  requestsAtOnce: 5,
  /** Requests to link each device can make in an hour, so none can keep the others asking. */
  requestsPerHour: 10,
  /**
   * How long after signing in a device can ask to link. A sign-in got by tricking someone, days
   * ago, can't ask, and a device that signed in long ago signs in again or types a code.
   */
  askWithinMinutes: 30,
  /** IDs in one check for missing files. */
  filesPerCheck: 500,
} as const;

/** A record or file ID: 32 bytes of HMAC in URL-safe base64. */
const ID = /^[A-Za-z0-9_-]{43}$/;
/** A link's ID: 16 bytes of hash in URL-safe base64. */
const LINK_ID = /^[A-Za-z0-9_-]{22}$/;
/** A key ID: 16 bytes in URL-safe base64. */
const KEY_ID = /^[A-Za-z0-9_-]{22}$/;
/** A one-time public key: an uncompressed P-256 point, 65 bytes starting with 4. */
const ONE_TIME_KEY = /^B[A-Za-z0-9_-]{86}$/;
/** The account key, sealed for a new device: a version byte, the nonce, 32 bytes and the tag. */
const SEALED = /^[A-Za-z0-9_-]{82}$/;

export const isRecordId = (value: unknown): value is string =>
  typeof value === 'string' && ID.test(value);
export const isFileId = isRecordId;
export const isLinkId = (value: unknown): value is string =>
  typeof value === 'string' && LINK_ID.test(value);
export const isKeyId = (value: unknown): value is string =>
  typeof value === 'string' && KEY_ID.test(value);
/** A request to link: 16 random bytes the new device picked. */
export const isRequestId = isLinkId;
/** A SHA-256 hash, such as the one a request to link commits to its key with. */
export const isCommitment = isRecordId;
export const isOneTimeKey = (value: unknown): value is string =>
  typeof value === 'string' && ONE_TIME_KEY.test(value);
export const isSealedKey = (value: unknown): value is string =>
  typeof value === 'string' && SEALED.test(value);

/**
 * The apps that sign in with a device code, each under its own name, so the server knows which
 * one a session is: the desktop app, or the browser extension, Save to Factwright.
 */
export const CLIENTS = {
  desktop: 'factwright-desktop',
  extension: 'factwright-extension',
} as const;

/** Where each part of the API lives on the server. */
export const API = {
  keys: '/api/sync/keys',
  changes: '/api/sync/changes',
  records: '/api/sync/records',
  files: '/api/sync/files',
  missingFiles: '/api/sync/files/missing',
  links: '/api/sync/links',
  requests: '/api/sync/requests',
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
  /**
   * Another device changed it first. Here's its version, to merge with. Null means the server
   * has no version at all, as after a restore from a backup: push it again as a new record.
   */
  | { record: string; ok: false; reason: 'conflict'; current: Change | null }
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
  /** How the account has sync, on a server that sells it. Other servers leave it out. */
  access?: SyncAccess;
}

/**
 * How an account has sync on a server that sells it. Reading what's synced never needs it, only
 * sending changes, adding devices and listening for changes.
 */
export interface SyncAccess {
  /** Whether sync works for the account now. */
  allowed: boolean;
  /** Sync at no cost: "early" for accounts from before sync was sold, "free" for anyone who asked. */
  gift: 'early' | 'free' | null;
  /** The account's subscription, once it has had one. */
  subscription: {
    /** As Stripe says it: "active", "past_due" while a payment is retried, "canceled" and so on. */
    status: string;
    /** When the time paid for ends, as an ISO time: when it renews, or ends if it's canceling. */
    renewsAt: string | null;
    /** Whether it ends then, rather than renewing. */
    canceling: boolean;
  } | null;
}

/**
 * A new device asking to link, waiting for a device that's set up to approve it. Everything in
 * it is public: one-time public keys, a hash, and names the account page shows anyway.
 */
export interface LinkRequest {
  id: string;
  /** The device asking, as the account page names it, such as "Chrome on Windows". */
  device: string;
  /** The ID the account page lists the device asking under, to sign it out by. */
  deviceId: string;
  /** When it asked, and when the request runs out, as ISO times. */
  asked: string;
  expires: string;
  /** When the device asking signed in, as an ISO time. */
  signedIn: string;
  /** A hash of the new device's one-time key, which fixes the key before it's shown. */
  commitment: string;
  /** The new device's one-time key, shown once a device offers to approve it. */
  key: string | null;
  /** The device that offered to approve it, with its one-time key. */
  approver: { device: string; key: string } | null;
  /**
   * How it stands: waiting for an answer; approved, with the sealed account key waiting for the
   * new device; turned down; or linked, once the new device picked the key up.
   */
  state: 'waiting' | 'approved' | 'denied' | 'linked';
  /** Whether the session asking is the one that made it. */
  mine: boolean;
  /** Whether the session asking is the one approving it. */
  approving: boolean;
}

const REQUEST_STATES = new Set<unknown>(['waiting', 'approved', 'denied', 'linked']);

const isTime = (value: unknown) =>
  typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));

const isName = (value: unknown) => typeof value === 'string' && value.length <= 200;

/**
 * Whether the server's word about a request to link is in the shape devices act on: IDs, keys
 * and the hash in their exact formats, so nothing odd ends up in an address or a key.
 */
export function isLinkRequest(value: unknown): value is LinkRequest {
  const request = value as Partial<LinkRequest> | null;
  if (typeof request !== 'object' || request === null) return false;
  const { approver } = request;
  return (
    isRequestId(request.id) &&
    isName(request.device) &&
    typeof request.deviceId === 'string' &&
    /^[A-Za-z0-9_-]{1,100}$/.test(request.deviceId) &&
    isTime(request.asked) &&
    isTime(request.expires) &&
    isTime(request.signedIn) &&
    isCommitment(request.commitment) &&
    (request.key === null || isOneTimeKey(request.key)) &&
    (approver === null ||
      (typeof approver === 'object' &&
        approver !== undefined &&
        isName(approver.device) &&
        isOneTimeKey(approver.key))) &&
    REQUEST_STATES.has(request.state) &&
    typeof request.mine === 'boolean' &&
    typeof request.approving === 'boolean'
  );
}

/** What the server can do beyond the basics, so devices offer only what it has. */
export type Feature =
  /** Approving a new device from one that's set up: requests to link, at API.requests. */
  | 'approve'
  /**
   * Sync on this server is a subscription, so the apps show its price. Only a server that sells
   * sync lists it, as Factwright's will once it does. A server of your own never does.
   */
  | 'subscription';

const FEATURES: ReadonlySet<unknown> = new Set<Feature>(['approve', 'subscription']);

/**
 * The features a server's sign-in options list that this version knows. Anything that isn't a
 * list, from a server too old to say, is none.
 */
export const knownFeatures = (value: unknown): Feature[] =>
  Array.isArray(value) ? value.filter((each): each is Feature => FEATURES.has(each)) : [];

/**
 * The terms of service and privacy policy that signing in to a server means agreeing to, as
 * Factwright's own server has them. A server of your own has none, unless you set yours.
 */
export interface Legal {
  terms: string;
  privacy: string;
}

/** An address a page can link to safely: https, with nothing that could run a script. */
function isHttps(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export const isLegal = (value: unknown): value is Legal =>
  typeof value === 'object' &&
  value !== null &&
  isHttps((value as Partial<Legal>).terms) &&
  isHttps((value as Partial<Legal>).privacy);

/** What the server says when a request fails. */
export interface ErrorBody {
  error: string;
  message: string;
}
