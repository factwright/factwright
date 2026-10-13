import { DurableObject } from 'cloudflare:workers';
import {
  type Change,
  type ChangesPage,
  type KeyRecord,
  LIMITS,
  type PushChange,
  type PushResult,
  type VersionInfo,
} from '@factwright/sync';
import { type Env, storageLimit } from './env.ts';
import {
  backupsPrefix,
  DAY_MS,
  filesPrefix,
  Meta,
  SCHEMA,
  toChange,
  type VersionRow,
} from './store-tables.ts';
import { backUp, cleanUp, deletePrefix, restore, type Upkeep } from './store-upkeep.ts';

/** Live listeners an account may have at once, such as its computers and phone. */
const LISTENERS = 20;

/** Requests an account may make in a burst, and how fast that allowance comes back. */
const BURST = 600;
const REFILL_PER_SECOND = 10;

/** Thrown when an account sends requests faster than its allowance. */
export const SLOW_DOWN = 'slow-down';

/** Thrown for any call to the store of an account that was deleted. */
export const DELETED = 'deleted';

/** When a deleted account's files are swept once more, for an upload that was on its way. */
const SWEEP_AGAIN_MS = 10 * 60 * 1000;

/**
 * One account's store: its locked records with their history, which file contents they point
 * to, its locked account key, and links waiting for new devices. Each account gets its own,
 * named by its account ID, with its own database. Only the Worker reaches it, after checking
 * the session, and every call names the account it's for: a store answers only its own.
 */
export class UserStore extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly meta: Meta;
  private tokens = BURST;
  private refilled = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.meta = new Meta(this.sql);
    this.sql.exec(SCHEMA);
    // Listeners keep their connection alive with "ping", answered without waking the store.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private get upkeep(): Upkeep {
    return { sql: this.sql, storage: this.ctx.storage, files: this.env.FILES, meta: this.meta };
  }

  /** Set when the account is being deleted, so calls that arrive in the meantime are turned away. */
  private deleting = false;

  /**
   * The account this store is for. The first call claims it, and no other account gets in. Once
   * the account is deleted, nothing does.
   */
  private claim(owner: string): void {
    if (this.isDeleted()) throw new Error(DELETED);
    const current = this.meta.get('owner');
    if (current === null) this.meta.set('owner', owner);
    else if (current !== owner) throw new Error('This store belongs to another account.');
  }

  /** Takes from the account's allowance of requests, or refuses when it's spent. */
  private spend(cost = 1): void {
    const now = Date.now();
    this.tokens = Math.min(BURST, this.tokens + ((now - this.refilled) / 1000) * REFILL_PER_SECOND);
    this.refilled = now;
    if (this.tokens < cost) throw new Error(SLOW_DOWN);
    this.tokens -= cost;
  }

  /** Plans a cleanup for a day from now, unless one's planned already. */
  private async planCleanup(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
    }
  }

  /** Tells each listening device how far the account's changes go. */
  private notify(): void {
    const message = JSON.stringify({ cursor: this.meta.count('seq') });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // It closed: the runtime drops it.
      }
    }
  }

  keys(owner: string): KeyRecord | null {
    this.claim(owner);
    this.spend();
    return this.meta.keys();
  }

  /**
   * Keeps the account key, locked with the recovery key. Only the first device sets it, and no
   * session can change it after, so one that signed in by a device code can't spoil recovery.
   */
  saveKeys(owner: string, keyId: string, recovery: string): 'saved' | 'taken' {
    this.claim(owner);
    this.spend();
    if (this.meta.keys()) return 'taken';
    const record: KeyRecord = { keyId, recovery, savedAt: new Date().toISOString() };
    this.meta.set('keys', JSON.stringify(record));
    return 'saved';
  }

  /** Each record's current version, for those that changed after a point in the account's history. */
  changes(owner: string, since: number, limit: number): ChangesPage {
    this.claim(owner);
    this.spend();
    const top = this.meta.count('seq');
    // A device ahead of the store saw history it no longer has: it starts over.
    const from = since > top ? 0 : Math.max(0, since);
    const size = Math.min(Math.max(1, limit), LIMITS.changesPerPage);
    const rows = this.sql
      .exec<VersionRow>(
        `SELECT v.* FROM heads h JOIN versions v ON v.record = h.record AND v.version = h.version
         WHERE h.seq > ? ORDER BY h.seq LIMIT ?`,
        from,
        size,
      )
      .toArray();
    return {
      changes: rows.map(toChange),
      cursor: rows.at(-1)?.seq ?? top,
      more: rows.length === size,
    };
  }

  private versionRow(record: string, version: number): VersionRow | undefined {
    return this.sql
      .exec<VersionRow>('SELECT * FROM versions WHERE record = ? AND version = ?', record, version)
      .toArray()[0];
  }

  private pushOne(change: PushChange, device: string, limit: number): PushResult {
    const { record } = change;
    const current =
      this.sql
        .exec<{ version: number }>('SELECT version FROM heads WHERE record = ?', record)
        .toArray()[0]?.version ?? 0;
    if (change.base !== current) {
      const row = current ? this.versionRow(record, current) : undefined;
      return { record, ok: false, reason: 'conflict', current: row ? toChange(row) : null };
    }
    if (change.file !== null) {
      const stored = this.sql.exec('SELECT id FROM files WHERE id = ?', change.file).toArray();
      if (stored.length === 0) return { record, ok: false, reason: 'missing-file' };
      // It's wanted again, so it stays.
      this.sql.exec('UPDATE files SET doomed = NULL WHERE id = ?', change.file);
    }
    const size = change.data.length;
    if (!change.deleted && this.meta.count('bytes') + size > limit) {
      return { record, ok: false, reason: 'full' };
    }
    const seq = this.meta.count('seq') + 1;
    const version = current + 1;
    this.sql.exec(
      `INSERT INTO versions (record, version, seq, data, file, deleted, at, device)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      record,
      version,
      seq,
      change.data,
      change.file,
      change.deleted ? 1 : 0,
      new Date().toISOString(),
      device,
    );
    this.sql.exec(
      `INSERT INTO heads (record, version, seq) VALUES (?, ?, ?)
       ON CONFLICT (record) DO UPDATE SET version = excluded.version, seq = excluded.seq`,
      record,
      version,
      seq,
    );
    this.meta.set('seq', seq);
    this.meta.set('bytes', this.meta.count('bytes') + size);
    return { record, ok: true, version, seq };
  }

  /**
   * Takes new versions of records, each made from the version its device last saw. One another
   * device changed first comes back as a conflict, with that device's version to merge with.
   */
  async push(owner: string, device: string, changes: PushChange[]): Promise<PushResult[]> {
    this.claim(owner);
    this.spend(1 + Math.floor(changes.length / 10));
    const limit = storageLimit(this.env);
    const results = this.ctx.storage.transactionSync(() =>
      changes.map((change) => this.pushOne(change, device, limit)),
    );
    if (results.some((result) => result.ok)) {
      this.notify();
      await this.planCleanup();
    }
    return results;
  }

  /** A record's kept versions, newest first. */
  versions(owner: string, record: string): VersionInfo[] {
    this.claim(owner);
    this.spend();
    return this.sql
      .exec<VersionRow>('SELECT * FROM versions WHERE record = ? ORDER BY version DESC', record)
      .toArray()
      .map(({ version, seq, at, deleted, file }) => ({
        version,
        seq,
        at,
        deleted: deleted === 1,
        file,
      }));
  }

  version(owner: string, record: string, version: number): Change | null {
    this.claim(owner);
    this.spend();
    const row = this.versionRow(record, version);
    return row ? toChange(row) : null;
  }

  /** Which of these file IDs the store has no contents for. */
  missingFiles(owner: string, ids: string[]): string[] {
    this.claim(owner);
    this.spend();
    return this.sql
      .exec<{ value: string }>(
        'SELECT value FROM json_each(?) WHERE value NOT IN (SELECT id FROM files)',
        JSON.stringify(ids),
      )
      .toArray()
      .map((row) => row.value);
  }

  /**
   * Records file contents the Worker just put in R2 under a key of its own. "duplicate" means
   * the store already had them, so the Worker removes its copy; "full" means there's no room.
   */
  async fileStored(
    owner: string,
    id: string,
    key: string,
    size: number,
  ): Promise<'stored' | 'duplicate' | 'full'> {
    this.claim(owner);
    this.spend();
    if (this.sql.exec('SELECT id FROM files WHERE id = ?', id).toArray().length > 0) {
      return 'duplicate';
    }
    if (this.meta.count('bytes') + size > storageLimit(this.env)) return 'full';
    this.sql.exec(
      'INSERT INTO files (id, key, size, at) VALUES (?, ?, ?, ?)',
      id,
      key,
      size,
      Date.now(),
    );
    this.meta.set('bytes', this.meta.count('bytes') + size);
    await this.planCleanup();
    return 'stored';
  }

  /** Where a file's contents are in R2, or null when the store has none under that ID. */
  fileKey(owner: string, id: string): string | null {
    this.claim(owner);
    this.spend();
    const row = this.sql.exec<{ key: string }>('SELECT key FROM files WHERE id = ?', id).toArray();
    return row[0]?.key ?? null;
  }

  /** Leaves the account key, locked with a link code, for a new device. */
  saveLink(owner: string, id: string, data: string): 'saved' | 'too-many' {
    this.claim(owner);
    this.spend();
    const now = Date.now();
    this.sql.exec('DELETE FROM links WHERE expires <= ?', now);
    const waiting = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM links').one().n;
    if (waiting >= LIMITS.linksAtOnce) return 'too-many';
    this.sql.exec(
      'INSERT OR REPLACE INTO links (id, data, expires) VALUES (?, ?, ?)',
      id,
      data,
      now + LIMITS.linkMinutes * 60_000,
    );
    return 'saved';
  }

  /** Hands a link over once, then it's gone. Null when there's none, or it ran out. */
  takeLink(owner: string, id: string): string | null {
    this.claim(owner);
    this.spend();
    this.sql.exec('DELETE FROM links WHERE expires <= ?', Date.now());
    const link = this.sql
      .exec<{ data: string }>('SELECT data FROM links WHERE id = ?', id)
      .toArray()[0];
    this.sql.exec('DELETE FROM links WHERE id = ?', id);
    return link?.data ?? null;
  }

  cancelLink(owner: string, id: string): void {
    this.claim(owner);
    this.spend();
    this.sql.exec('DELETE FROM links WHERE id = ?', id);
  }

  usage(owner: string): { bytes: number; limit: number; records: number; files: number } {
    this.claim(owner);
    this.spend();
    const records = this.sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM heads h JOIN versions v
         ON v.record = h.record AND v.version = h.version WHERE v.deleted = 0`,
      )
      .one().n;
    const files = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM files').one().n;
    return { bytes: this.meta.count('bytes'), limit: storageLimit(this.env), records, files };
  }

  /** Everything the store holds, still locked: each record's current version and the files. */
  exportAll(owner: string): { keys: KeyRecord | null; records: Change[]; files: object[] } {
    this.claim(owner);
    this.spend();
    const records = this.sql
      .exec<VersionRow>(
        `SELECT v.* FROM heads h JOIN versions v
         ON v.record = h.record AND v.version = h.version ORDER BY h.seq`,
      )
      .toArray()
      .map(toChange);
    const files = this.sql
      .exec<{ id: string; size: number }>('SELECT id, size FROM files ORDER BY id')
      .toArray();
    return { keys: this.meta.keys(), records, files };
  }

  /**
   * Deletes everything the account has: the store, then its files and backups in R2. From the
   * start, the store turns every other call away, and it remembers the account was deleted, so
   * nothing can fill it again. One more sweep, a few minutes later, catches an upload that was on
   * its way, or files a sweep that failed left behind. Asked again after it failed partway, it
   * sweeps once more and finishes, so the account's deletion can always be done.
   */
  async wipe(owner: string): Promise<void> {
    const deleted = this.meta.get('deleted');
    if (deleted === null) {
      this.claim(owner);
      this.deleting = true;
      for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'The account was deleted.');
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.sql.exec(SCHEMA);
      this.meta.set('deleted', owner);
    } else if (deleted !== owner) {
      throw new Error('This store belongs to another account.');
    }
    await this.ctx.storage.setAlarm(Date.now() + SWEEP_AGAIN_MS);
    await this.sweep(owner);
  }

  /** Deletes an account's files and backups from R2. */
  private async sweep(owner: string): Promise<void> {
    for (const prefix of [filesPrefix(owner), backupsPrefix(owner)]) {
      await deletePrefix(this.env.FILES, prefix);
    }
  }

  /** Saves the day's backup of the store to R2. False when there's nothing to back up. */
  async backup(owner: string, day: string): Promise<boolean> {
    this.claim(owner);
    return backUp(this.upkeep, owner, day);
  }

  /** Puts the store back as a day's backup left it. False when there's no such backup. */
  async restore(owner: string, day: string): Promise<boolean> {
    this.claim(owner);
    // The backup is read from R2 first: an account deleted meanwhile gets nothing written back.
    const restored = await restore(this.upkeep, owner, day, () => this.isDeleted());
    if (restored) this.notify();
    return restored;
  }

  /** The daily cleanup of old versions, unused files and links that ran out. */
  async cleanup(now = Date.now()): Promise<void> {
    await cleanUp(this.upkeep, now);
  }

  override async alarm(): Promise<void> {
    // A deleted account's last sweep, and nothing after it.
    const deleted = this.meta.get('deleted');
    if (deleted !== null) return this.sweep(deleted);
    if (this.meta.get('owner') === null) return;
    await this.cleanup();
    // Deleted while the cleanup waited on R2: its sweep's alarm stays as it is.
    if (this.isDeleted()) return;
    await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }

  /** Whether the account is deleted, or being deleted. */
  private isDeleted(): boolean {
    return this.deleting || this.meta.get('deleted') !== null;
  }

  /** A device listening for changes as they happen. The Worker checked its ticket. */
  override async fetch(request: Request): Promise<Response> {
    const owner = request.headers.get('x-factwright-account');
    if (!owner || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 400 });
    }
    this.claim(owner);
    this.spend();
    const listening = this.ctx.getWebSockets();
    if (listening.length >= LISTENERS) listening[0]?.close(1013, 'Too many listeners.');
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify({ cursor: this.meta.count('seq') }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    try {
      socket.close(code === 1005 ? 1000 : code);
    } catch {
      // Already closed.
    }
  }
}
