import {
  byJob,
  collectJobs,
  type Job,
  jobList,
  knownJobsOf,
  readRecords,
  type StoredRow,
  trackedCall,
  trackedNote,
  trackedRow,
  type WorkspaceEntry,
  type WorkspaceReader,
} from '@factwright/core';
import {
  type AccountKeys,
  type Bytes,
  type Change,
  decodeRecord,
  type FileRecord,
  nameOf,
  openFile,
  openRecord,
  type RowValues,
  recordId,
  type SyncClient,
  type SyncRecord,
} from '@factwright/sync';

/**
 * Your job hunt as sync holds it, read for filling a form in a browser where Factwright isn't: the
 * tracker's rows and the workspace's files, as Factwright on your computer synced them. Each record
 * is opened with the account's keys, and checked, as the app's own sync checks it. What's read
 * stays in memory, for the fill, and is never stored: the files' contents are fetched only as a
 * fill needs them.
 */

/** A file in the workspace, as sync holds it: its contents' ID, its size and when it changed. */
export type SyncedFile = NonNullable<FileRecord['file']>;

/** The tables a fill reads: the jobs, and the calls and notes that keep a job on the list. */
const TABLES = ['jobs', 'calls', 'notes'] as const;

type Table = (typeof TABLES)[number];

const isTable = (table: string): table is Table => (TABLES as readonly string[]).includes(table);

/** What sync holds of a job hunt: each file by its path, and each row of the tables a fill reads. */
export interface Synced {
  files: Map<string, SyncedFile>;
  rows: Record<Table, Map<string, RowValues>>;
}

/**
 * One version of a record, opened, or null when it doesn't open: locked with another key, damaged,
 * or under a name that doesn't make its ID, so no record can stand in for another.
 */
export async function openChange(keys: AccountKeys, change: Change): Promise<SyncRecord | null> {
  const plain = await openRecord(keys, change.record, change.version, change.data);
  const record = plain && decodeRecord(plain);
  if (!record) return null;
  return (await recordId(keys, nameOf(record))) === change.record ? record : null;
}

/**
 * Reads what sync holds now: each record's latest version, a page at a time, from the start of the
 * account's changes. Deleted records, and rows of tables a fill doesn't read, are passed over.
 */
export async function readSynced(client: SyncClient, keys: AccountKeys): Promise<Synced> {
  const synced: Synced = {
    files: new Map(),
    rows: { jobs: new Map(), calls: new Map(), notes: new Map() },
  };
  for (let cursor = 0; ; ) {
    const page = await client.changes(cursor);
    const live = page.changes.filter((change) => !change.deleted);
    const records = await Promise.all(live.map((change) => openChange(keys, change)));
    for (const record of records) {
      if (record?.kind === 'file' && record.file) synced.files.set(record.path, record.file);
      if (record?.kind === 'row' && record.row && isTable(record.table)) {
        synced.rows[record.table].set(record.id, record.row);
      }
    }
    // A page that ends where it started would never end.
    if (!page.more || page.cursor <= cursor) break;
    cursor = page.cursor;
  }
  return synced;
}

/** A file's contents, opened, and checked against its ID, or null when the store doesn't have it. */
export async function fileContents(
  client: SyncClient,
  keys: AccountKeys,
  file: SyncedFile,
): Promise<Bytes | null> {
  const locked = await client.getFile(file.id, file.size);
  return locked && openFile(keys, file.id, locked);
}

/** A text file's contents, read as the app reads one on disk. */
export const decoded = (contents: Bytes): string =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(contents);

/** A text file's contents, or null when it isn't there, or the store doesn't have it. */
export async function textOf(
  client: SyncClient,
  keys: AccountKeys,
  synced: Synced,
  path: string,
): Promise<string | null> {
  const file = synced.files.get(path);
  const contents = file ? await fileContents(client, keys, file) : null;
  return contents ? decoded(contents) : null;
}

/** Does some work for each of a list's items, a few at a time, in the list's order. */
export async function inTurns<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>,
  atOnce = 4,
): Promise<R[]> {
  const done: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let at = next++; at < items.length; at = next++) {
      done[at] = await work(items[at] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, worker));
  return done;
}

/**
 * The workspace as sync holds it, to read as the app reads its folder on disk: each folder's files
 * and folders, and the text of the files read already, in `texts`. Any other file reads as missing.
 */
export function syncedWorkspace(
  files: ReadonlyMap<string, SyncedFile>,
  texts: ReadonlyMap<string, string>,
): WorkspaceReader {
  const folders = new Map<string, Map<string, WorkspaceEntry>>();
  for (const [path, file] of files) {
    const parts = path.split('/');
    for (let depth = 0; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join('/');
      const name = parts[depth] as string;
      const entries = folders.get(folder) ?? new Map<string, WorkspaceEntry>();
      folders.set(folder, entries);
      const last = depth === parts.length - 1;
      if (entries.has(name) && !last) continue;
      entries.set(
        name,
        last
          ? { name, folder: false, size: file.size, modified: file.modified }
          : { name, folder: true, size: 0, modified: '' },
      );
    }
  }
  return {
    readText: (path) => texts.get(path) ?? null,
    list: (path) => [...(folders.get(path.replace(/\/+$/, '')) ?? new Map()).values()],
  };
}

/** Where the skills keep each job's folder, and the notes each folder's job is known by. */
const JOB_NOTES = /^applications\/([^/]+)\/job\.md$/;

/** The path of every job folder's job.md, as sync holds them. */
export const jobNotesPaths = (synced: Synced): string[] =>
  [...synced.files.keys()].filter((path) => JOB_NOTES.test(path));

/**
 * Every job, as the app lists them: each tracker row, joined with what the job folders' job.md
 * files say, by the app's own matching, so a job has the folder, resumes and cover letters the app
 * shows for it. `notes` holds each job.md's text, by its path. A job the user merged into another
 * isn't listed, and one whose files are gone stays only while the user tracks something about it.
 */
export function syncedJobs(synced: Synced, notes: ReadonlyMap<string, string>): Job[] {
  const workspace = syncedWorkspace(synced.files, notes);
  const rows = [...synced.rows.jobs.values()].map((row) => trackedRow(row as StoredRow));
  const found = new Map(
    collectJobs(readRecords(workspace), knownJobsOf(rows)).map((job) => [job.id, job]),
  );
  const rowsOf = (table: 'calls' | 'notes') => [...synced.rows[table].values()] as StoredRow[];
  return jobList(rows, found, {
    calls: byJob(rowsOf('calls'), trackedCall),
    history: new Map(),
    notes: byJob(rowsOf('notes'), trackedNote),
  });
}

/**
 * The resumes Factwright made, as sync holds them, newest first: each job's own, and the base
 * ones, as the app looks for your newest.
 */
export function resumePaths(synced: Synced): string[] {
  return [...synced.files.entries()]
    .filter(
      ([path]) =>
        /^applications\/[^/]+\/resume\.json$/.test(path) || /^base\/[^/]+\.json$/.test(path),
    )
    .sort(([, a], [, b]) => b.modified.localeCompare(a.modified))
    .map(([path]) => path);
}
