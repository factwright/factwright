import type { Change, KeyRecord, LinkRequest } from '@factwright/sync';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Where an account's files and backups are kept in R2. */
export const filesPrefix = (owner: string) => `users/${owner}/files/`;
export const backupsPrefix = (owner: string) => `backups/${owner}/`;

/** Each account's store has these tables, made when it first starts. */
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- Every kept version of every record, each one locked by the device that made it.
  CREATE TABLE IF NOT EXISTS versions (
    record TEXT NOT NULL,
    version INTEGER NOT NULL,
    seq INTEGER NOT NULL UNIQUE,
    data TEXT NOT NULL,
    file TEXT,
    deleted INTEGER NOT NULL,
    at TEXT NOT NULL,
    device TEXT NOT NULL,
    PRIMARY KEY (record, version)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS versions_file ON versions (file) WHERE file IS NOT NULL;
  -- Each record's current version.
  CREATE TABLE IF NOT EXISTS heads (
    record TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    seq INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS heads_seq ON heads (seq);
  -- Locked file contents in R2, each under a key of its own. "doomed" marks one no version
  -- points to anymore, which the next cleanup removes if that's still so.
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    size INTEGER NOT NULL,
    at INTEGER NOT NULL,
    doomed INTEGER
  ) WITHOUT ROWID;
  -- Account keys locked with link codes, waiting for a new device.
  CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires INTEGER NOT NULL
  ) WITHOUT ROWID;
  -- New devices asking to link, until a device that's set up approves one. Each holds one-time
  -- public keys, a hash, the sessions taking part, and once approved, the account key sealed
  -- for that new device alone.
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    device TEXT NOT NULL,
    commitment TEXT NOT NULL,
    key TEXT,
    approver TEXT,
    approver_device TEXT,
    approver_key TEXT,
    sealed TEXT,
    denied INTEGER NOT NULL DEFAULT 0,
    linked INTEGER NOT NULL DEFAULT 0,
    signed_in INTEGER NOT NULL,
    asked INTEGER NOT NULL,
    expires INTEGER NOT NULL
  ) WITHOUT ROWID;
  -- When each session asked to link, kept for an hour to limit how often it can.
  CREATE TABLE IF NOT EXISTS requests_made (session TEXT NOT NULL, at INTEGER NOT NULL);
`;

export type RequestRow = {
  id: string;
  session: string;
  device: string;
  commitment: string;
  key: string | null;
  approver: string | null;
  approver_device: string | null;
  approver_key: string | null;
  sealed: string | null;
  denied: number;
  linked: number;
  signed_in: number;
  asked: number;
  expires: number;
};

export type VersionRow = {
  record: string;
  version: number;
  seq: number;
  data: string;
  file: string | null;
  deleted: number;
  at: string;
  device: string;
};

export type HeadRow = { record: string; version: number; seq: number };

export type FileRow = { id: string; key: string; size: number; at: number };

/** A request to link as a session sees it. The sealed account key is never part of it. */
export const toRequest = (row: RequestRow, session: string): LinkRequest => ({
  id: row.id,
  device: row.device,
  asked: new Date(row.asked).toISOString(),
  expires: new Date(row.expires).toISOString(),
  signedIn: new Date(row.signed_in).toISOString(),
  commitment: row.commitment,
  key: row.key,
  approver:
    row.approver_device !== null && row.approver_key !== null
      ? { device: row.approver_device, key: row.approver_key }
      : null,
  state: row.denied
    ? 'denied'
    : row.linked
      ? 'linked'
      : row.sealed !== null
        ? 'approved'
        : 'waiting',
  mine: row.session === session,
  approving: row.approver === session,
});

export const toChange = (row: VersionRow): Change => ({
  record: row.record,
  version: row.version,
  seq: row.seq,
  data: row.data,
  file: row.file,
  deleted: row.deleted === 1,
  at: row.at,
});

/**
 * The store's own facts: which account it's for, its locked account key, the number of its
 * latest change ("seq") and the bytes it stores ("bytes").
 */
export class Meta {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
  }

  get(key: string): string | null {
    return (
      this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]
        ?.value ?? null
    );
  }

  set(key: string, value: string | number): void {
    this.sql.exec(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      key,
      String(value),
    );
  }

  count(key: string): number {
    return Number(this.get(key) ?? 0);
  }

  keys(): KeyRecord | null {
    const saved = this.get('keys');
    return saved ? (JSON.parse(saved) as KeyRecord) : null;
  }
}
