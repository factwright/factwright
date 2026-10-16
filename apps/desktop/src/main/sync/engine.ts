import {
  type AccountKeys,
  type Bytes,
  type Change,
  decodeRecord,
  encodeRecord,
  type FileRecord,
  fileId,
  fileName,
  LIMITS,
  mergeRows,
  nameOf,
  openFile,
  openRecord,
  type PushChange,
  type RowRecord,
  type RowValues,
  recordId,
  rowName,
  type SyncClient,
  type SyncRecord,
  sealFile,
  sealRecord,
} from '@factwright/sync';
import { SYNC_TABLES, type SyncTable, type Tracker } from '../jobs/tracker.ts';
import {
  conflictCopyPath,
  type LocalFile,
  listSyncFiles,
  readSyncFile,
  removeSyncFile,
  type SkippedFile,
  statSyncFile,
  writeSyncFile,
} from './files.ts';
import { MERGE_RULES, rowHash } from './rows.ts';
import type { Synced, SyncState } from './state.ts';

export interface EngineDeps {
  client: SyncClient;
  keys: AccountKeys;
  state: SyncState;
  tracker: Tracker;
  /** The workspace folder. */
  workspace: string;
  /** This computer's name, for records and conflict copies. */
  device: string;
  now?: () => Date;
}

/** What one round of sync did. */
export interface SyncReport {
  /** Changes from other devices that landed here. */
  pulled: number;
  /** Changes from here that reached the server. */
  pushed: number;
  /** Times both sides changed the same thing: both were kept, or merged. */
  conflicts: number;
  /** Records that wouldn't open: locked with another key, or damaged. */
  unreadable: number;
  /** Files that stay on this computer, and why. */
  skipped: SkippedFile[];
  /** Whether the account ran out of space. */
  full: boolean;
}

/** A change from here, ready to push. */
interface Outgoing {
  name: string;
  record: string;
  base: number;
  body: SyncRecord;
  /** For a file, its locked contents and how it sits on disk. */
  sealed?: { id: string; data: Bytes };
  local?: LocalFile;
  /** For a row, its hash here. */
  hash?: string;
}

/** A change from another device, opened. */
interface Incoming {
  change: Change;
  record: SyncRecord;
  name: string;
}

const isSyncTable = (table: string): table is SyncTable =>
  (SYNC_TABLES as readonly string[]).includes(table);

/** Rows come in jobs first, so calls and history find their job. */
const APPLY_ORDER = (item: Incoming) =>
  item.record.kind === 'row' ? SYNC_TABLES.indexOf(item.record.table as SyncTable) : 9;

/** A batch of changes small enough for one push. */
function batches(changes: PushChange[]): PushChange[][] {
  const all: PushChange[][] = [];
  let batch: PushChange[] = [];
  let chars = 0;
  for (const change of changes) {
    const size = change.data.length + 200;
    if (batch.length >= LIMITS.changesPerPush || chars + size > LIMITS.pushChars) {
      all.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(change);
    chars += size;
  }
  if (batch.length > 0) all.push(batch);
  return all;
}

/**
 * Syncs this computer's workspace and tracker with the account. Each round pulls what other
 * devices changed, then pushes what changed here. When both changed the same thing, nothing is
 * lost: a file keeps both copies, the other device's at its place and this one's beside it,
 * and a tracked row merges the two.
 */
/**
 * Errors that mean a change can never land on this computer, however often it's tried: a name too
 * long for it, or a file where a folder must go.
 */
const NEVER_LANDS = new Set(['ENAMETOOLONG', 'ENOTDIR', 'EISDIR', 'EINVAL', 'EILSEQ']);

export class SyncEngine {
  private readonly deps: EngineDeps;

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Syncs until both sides agree, or a few rounds have passed. */
  async syncOnce(): Promise<SyncReport> {
    const report: SyncReport = {
      pulled: 0,
      pushed: 0,
      conflicts: 0,
      unreadable: 0,
      skipped: [],
      full: false,
    };
    for (let round = 0; round < 5; round++) {
      await this.pull(report);
      if (!(await this.push(report))) break;
    }
    return report;
  }

  private async open(change: Change): Promise<Incoming | null> {
    const { keys } = this.deps;
    const plain = await openRecord(keys, change.record, change.version, change.data);
    const record = plain && decodeRecord(plain);
    if (!record) return null;
    const name = nameOf(record);
    // A record's name must make its ID, so no record can stand in for another.
    return (await recordId(keys, name)) === change.record ? { change, record, name } : null;
  }

  /**
   * Takes another device's change, or passes over one that can never land on this computer, such
   * as a file where this one has a file in place of its folder, so one change can't stop sync for
   * good. Anything else, such as a full disk, still stops this sync, to try again later.
   */
  private async takeOrPass(item: Incoming, report: SyncReport): Promise<boolean> {
    try {
      return await this.take(item, report);
    } catch (error) {
      if (!NEVER_LANDS.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      report.unreadable += 1;
      return true;
    }
  }

  private async pull(report: SyncReport): Promise<void> {
    const { client, state } = this.deps;
    const waiting: Incoming[] = [];
    for (;;) {
      const page = await client.changes(state.cursor());
      const opened: Incoming[] = [];
      for (const change of page.changes) {
        const item = await this.open(change);
        if (item) opened.push(item);
        else report.unreadable += 1;
      }
      opened.sort((a, b) => APPLY_ORDER(a) - APPLY_ORDER(b));
      for (const item of opened) if (!(await this.takeOrPass(item, report))) waiting.push(item);
      state.setCursor(page.cursor);
      if (!page.more) break;
    }
    // A call or history whose job came in a later page gets another try, now its job is here.
    for (const item of waiting) if (!(await this.takeOrPass(item, report))) report.unreadable += 1;
  }

  /**
   * Takes another device's change, merging it with any change made here since. False when it
   * can't land yet: a call or history whose job isn't here.
   */
  private async take(item: Incoming, report: SyncReport): Promise<boolean> {
    const synced = this.deps.state.get(item.name);
    if (synced?.version === item.change.version) return true;
    if (synced && synced.version > item.change.version) {
      // The server went back to an older version, as after a restore from a backup. What's
      // here is newer, so it goes back up, made from the server's version.
      this.resend(synced, item.change.version);
      return true;
    }
    if (item.record.kind === 'file') {
      await this.takeFile(item, item.record, synced, report);
      return true;
    }
    return this.takeRow(item, item.record, synced, report);
  }

  /** Marks a record to push again, as a change made from the server's version. */
  private resend(synced: Synced, version: number): void {
    this.deps.state.save({ ...synced, version, hash: '', size: null, mtime: null });
  }

  /** Whether a file changed here since it last synced. */
  private async fileChanged(local: LocalFile | null, synced: Synced | null): Promise<boolean> {
    if (!synced || synced.deleted) return local !== null;
    if (!local) return true;
    if (local.size === synced.size && local.mtime === synced.mtime) return false;
    const contents = readSyncFile(this.deps.workspace, local.path);
    return !contents || (await fileId(this.deps.keys, contents)) !== synced.hash;
  }

  private async download(id: string): Promise<Bytes | null> {
    const locked = await this.deps.client.getFile(id);
    return locked && openFile(this.deps.keys, id, locked);
  }

  private saveFileState(item: Incoming, file: FileRecord['file'], written: LocalFile | null) {
    this.deps.state.save({
      name: item.name,
      record: item.change.record,
      version: item.change.version,
      hash: file?.id ?? '',
      base: null,
      size: written?.size ?? null,
      mtime: written?.mtime ?? null,
      deleted: file === null,
    });
  }

  /** Puts another device's version of a file here, or removes it. */
  private async putFile(item: Incoming, record: FileRecord, report: SyncReport): Promise<boolean> {
    const { workspace } = this.deps;
    if (!record.file) {
      removeSyncFile(workspace, record.path);
      this.saveFileState(item, null, null);
      return true;
    }
    const contents = await this.download(record.file.id);
    if (!contents) {
      report.unreadable += 1;
      return false;
    }
    const written = writeSyncFile(workspace, record.path, contents, new Date(record.file.modified));
    this.saveFileState(item, record.file, written);
    return true;
  }

  private async takeFile(
    item: Incoming,
    record: FileRecord,
    synced: Synced | null,
    report: SyncReport,
  ): Promise<void> {
    const { workspace, keys, device } = this.deps;
    const local = statSyncFile(workspace, record.path);
    if (!(await this.fileChanged(local, synced))) {
      if (await this.putFile(item, record, report)) report.pulled += 1;
      return;
    }
    const mine = local && readSyncFile(workspace, record.path);
    if (record.file && mine && (await fileId(keys, mine)) === record.file.id) {
      // Both made the same change.
      this.saveFileState(item, record.file, local);
      return;
    }
    if (!record.file || !mine) {
      if (!record.file) {
        // Deleted there, changed here: this one stays, and goes back up.
        this.saveFileState(item, null, null);
      } else if (await this.putFile(item, record, report)) {
        // Deleted here, changed there: theirs comes back.
        report.pulled += 1;
      }
      return;
    }
    // Both changed it: theirs takes its place, and this computer's version moves beside it.
    const copy = conflictCopyPath(workspace, record.path, device, this.now());
    writeSyncFile(workspace, copy, mine, new Date(local?.mtime ?? Date.now()));
    if (await this.putFile(item, record, report)) report.conflicts += 1;
  }

  private takeRow(
    item: Incoming,
    record: RowRecord,
    synced: Synced | null,
    report: SyncReport,
  ): boolean {
    const { tracker, state } = this.deps;
    const { table, id, row: theirs } = record;
    if (!isSyncTable(table)) return true;
    const local = tracker.syncRow(table, id);
    const changed =
      !synced || synced.deleted ? local !== null : !local || rowHash(table, local) !== synced.hash;
    const save = (hash: string, deleted: boolean) =>
      state.save({
        name: item.name,
        record: item.change.record,
        version: item.change.version,
        hash,
        base: theirs ? JSON.stringify(theirs) : null,
        size: null,
        mtime: null,
        deleted,
      });
    const put = (row: RowValues | null): boolean => {
      try {
        tracker.applySyncRow(table, id, row);
      } catch {
        // A call or history whose job isn't here yet.
        return false;
      }
      const stored = tracker.syncRow(table, id);
      save(stored ? rowHash(table, stored) : '', stored === null);
      report.pulled += 1;
      return true;
    };
    if (!changed || !local) {
      // Unchanged here, or deleted here while changed there: theirs is the one to keep.
      return put(theirs);
    }
    if (!theirs) {
      // Deleted there, changed here: this one stays, and goes back up.
      save('', true);
      return true;
    }
    const base = synced?.base && !synced.deleted ? (JSON.parse(synced.base) as RowValues) : null;
    const merged = mergeRows(base, local, theirs, MERGE_RULES[table], item.record.device);
    tracker.applySyncRow(table, id, merged);
    // Their version is now the base; the merge goes up as a change made from it.
    const seen = Object.fromEntries(
      Object.keys(local).map((column) => [column, theirs[column] ?? null]),
    );
    save(rowHash(table, seen), false);
    report.conflicts += 1;
    return true;
  }

  /** What changed here since the last sync: files and rows, new, changed and deleted. */
  private async changesHere(report: SyncReport): Promise<Outgoing[]> {
    const { workspace, tracker, state, keys, device } = this.deps;
    const at = this.now().toISOString();
    const outgoing: Outgoing[] = [];
    const recordFor = async (name: string, synced: Synced | null) =>
      synced?.record ?? (await recordId(keys, name));

    const { files, skipped } = listSyncFiles(workspace);
    report.skipped = skipped;
    // A file that stays here isn't deleted, so other devices keep their copy.
    const here = new Set([...files, ...skipped].map((file) => fileName(file.path)));
    for (const local of files) {
      const name = fileName(local.path);
      const synced = state.get(name);
      if (synced && !synced.deleted && synced.size === local.size && synced.mtime === local.mtime) {
        continue;
      }
      const contents = readSyncFile(workspace, local.path);
      if (!contents) continue;
      const sealed = await sealFile(keys, contents);
      if (synced && !synced.deleted && sealed.id === synced.hash) {
        state.save({ ...synced, size: local.size, mtime: local.mtime });
        continue;
      }
      const modified = new Date(local.mtime).toISOString();
      outgoing.push({
        name,
        record: await recordFor(name, synced),
        base: synced?.version ?? 0,
        body: {
          kind: 'file',
          path: local.path,
          file: { id: sealed.id, size: local.size, modified },
          device,
          at,
        },
        sealed,
        local,
      });
    }
    for (const synced of state.all('file:')) {
      if (synced.deleted || here.has(synced.name)) continue;
      const path = synced.name.slice('file:'.length);
      outgoing.push({
        name: synced.name,
        record: synced.record,
        base: synced.version,
        body: { kind: 'file', path, file: null, device, at },
      });
    }

    const rowsHere = new Set<string>();
    for (const { table, id, row } of tracker.syncRows()) {
      const name = rowName(table, id);
      rowsHere.add(name);
      const synced = state.get(name);
      const hash = rowHash(table, row);
      if (synced && !synced.deleted && synced.hash === hash) continue;
      // Columns a newer app version added ride along unchanged.
      const base = synced?.base ? (JSON.parse(synced.base) as RowValues) : {};
      outgoing.push({
        name,
        record: await recordFor(name, synced),
        base: synced?.version ?? 0,
        body: { kind: 'row', table, id, row: { ...base, ...row }, device, at },
        hash,
      });
    }
    for (const synced of state.all('row:')) {
      if (synced.deleted || rowsHere.has(synced.name)) continue;
      const [, table = '', ...rest] = synced.name.split(':');
      // A table only a newer version keeps, as after going back to an older app, isn't gone.
      if (!isSyncTable(table)) continue;
      outgoing.push({
        name: synced.name,
        record: synced.record,
        base: synced.version,
        body: { kind: 'row', table, id: rest.join(':'), row: null, device, at },
      });
    }
    return outgoing;
  }

  /** Uploads the contents of changed files the server doesn't have yet. */
  private async upload(outgoing: Outgoing[]): Promise<void> {
    const { client } = this.deps;
    const sealed = new Map<string, Bytes>();
    for (const item of outgoing) if (item.sealed) sealed.set(item.sealed.id, item.sealed.data);
    const ids = [...sealed.keys()];
    for (let i = 0; i < ids.length; i += LIMITS.filesPerCheck) {
      const missing = await client.missingFiles(ids.slice(i, i + LIMITS.filesPerCheck));
      for (const id of missing) {
        const data = sealed.get(id);
        if (data) await client.putFile(id, data);
      }
    }
  }

  /** Pushes what changed here. True when another round is needed, as after a conflict. */
  private async push(report: SyncReport): Promise<boolean> {
    const { client, keys, state } = this.deps;
    const outgoing = await this.changesHere(report);
    if (outgoing.length === 0) return false;
    await this.upload(outgoing);
    const byRecord = new Map(outgoing.map((item) => [item.record, item]));
    const changes: PushChange[] = [];
    for (const item of outgoing) {
      changes.push({
        record: item.record,
        base: item.base,
        data: await sealRecord(keys, item.record, item.base + 1, encodeRecord(item.body)),
        file: item.body.kind === 'file' ? (item.body.file?.id ?? null) : null,
        deleted: item.body.kind === 'file' ? item.body.file === null : item.body.row === null,
      });
    }
    let again = false;
    for (const batch of batches(changes)) {
      const { results } = await client.push(batch);
      for (const result of results) {
        const item = byRecord.get(result.record);
        if (!item) continue;
        if (result.ok) {
          const { body } = item;
          state.save({
            name: item.name,
            record: item.record,
            version: result.version,
            hash: body.kind === 'file' ? (body.file?.id ?? '') : (item.hash ?? ''),
            base: body.kind === 'row' && body.row ? JSON.stringify(body.row) : null,
            size: item.local?.size ?? null,
            mtime: item.local?.mtime ?? null,
            deleted: body.kind === 'file' ? body.file === null : body.row === null,
          });
          report.pushed += 1;
        } else if (result.reason === 'conflict') {
          const synced = state.get(item.name);
          if (result.current === null) {
            // The server has no version at all, as after a restore: it goes up as new.
            if (synced) this.resend(synced, 0);
            again = true;
            continue;
          }
          const current = await this.open(result.current);
          if (current && (await this.take(current, report))) again = true;
          else report.unreadable += 1;
        } else if (result.reason === 'full') {
          report.full = true;
        } else {
          again = true;
        }
      }
    }
    return again && !report.full;
  }
}
