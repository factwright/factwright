import type { Change, KeyRecord } from '@factwright/sync';

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
`;

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
