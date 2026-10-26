import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/** What this device last synced of one record. */
export interface Synced {
  /** The record's name, such as "file:facts/skills.md" or "row:jobs:acme--staff". */
  name: string;
  /** Its ID on the server. */
  record: string;
  /** The server's version this device has. */
  version: number;
  /** What it said then: a file's ID, or a row's hash. */
  hash: string;
  /** For a row, the row itself as synced, to merge two devices' changes from. */
  base: string | null;
  /** For a file, its size and time on disk when synced, to notice a change without reading it. */
  size: number | null;
  mtime: number | null;
  deleted: boolean;
}

type Row = {
  name: string;
  record: string;
  version: number;
  hash: string;
  base: string | null;
  size: number | null;
  mtime: number | null;
  deleted: number;
};

const toSynced = (row: Row): Synced => ({ ...row, deleted: row.deleted === 1 });

/** Where sync's notes keep this computer's own ID, which starting over never forgets. */
const DEVICE = 'device';

/**
 * Sync's notes on this computer: what it last synced of each record, and how far it has pulled
 * the account's changes. They sit beside the tracker, in their own small database.
 */
export class SyncState {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS synced (
        name TEXT PRIMARY KEY,
        record TEXT NOT NULL,
        version INTEGER NOT NULL,
        hash TEXT NOT NULL,
        base TEXT,
        size INTEGER,
        mtime INTEGER,
        deleted INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  close(): void {
    this.db.close();
  }

  get(name: string): Synced | null {
    const row = this.db.prepare('SELECT * FROM synced WHERE name = ?').get(name);
    return row ? toSynced(row as Row) : null;
  }

  /** Every record synced whose name starts so, such as "file:". */
  all(prefix = ''): Synced[] {
    return this.db
      .prepare("SELECT * FROM synced WHERE name LIKE ? || '%' ESCAPE '\\' ORDER BY name")
      .all(prefix.replace(/[\\%_]/g, '\\$&'))
      .map((row) => toSynced(row as Row));
  }

  save(item: Synced): void {
    this.db
      .prepare(
        `INSERT INTO synced (name, record, version, hash, base, size, mtime, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET record = excluded.record, version = excluded.version,
           hash = excluded.hash, base = excluded.base, size = excluded.size,
           mtime = excluded.mtime, deleted = excluded.deleted`,
      )
      .run(
        item.name,
        item.record,
        item.version,
        item.hash,
        item.base,
        item.size,
        item.mtime,
        item.deleted ? 1 : 0,
      );
  }

  meta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return typeof row?.value === 'string' ? row.value : null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  /** How far this device has pulled the account's changes. */
  cursor(): number {
    return Number(this.meta('cursor') ?? 0);
  }

  setCursor(cursor: number): void {
    this.setMeta('cursor', String(cursor));
  }

  /**
   * This computer's own ID, which its claims on jobs name it by, made the first time it's asked
   * for. It stays as sync starts over, so the claims it made are still known as its own.
   */
  device(): string {
    const known = this.meta(DEVICE);
    if (known) return known;
    const made = randomUUID();
    this.setMeta(DEVICE, made);
    return made;
  }

  /**
   * Forgets everything, as when sync is turned off here: the next time, it starts over. Only this
   * computer's own ID stays.
   */
  clear(): void {
    this.db.prepare('DELETE FROM synced').run();
    this.db.prepare('DELETE FROM meta WHERE key <> ?').run(DEVICE);
  }
}
