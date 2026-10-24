import {
  byJob,
  type CollectedJob,
  collectJobs,
  folderFiles,
  type Job,
  jobList,
  knownJobsOf,
  readRecords,
  type StoredRow,
  type TrackedRow,
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

/**
 * What sync holds of a job hunt: each file by its path, each row of the tables a fill reads, and
 * where in the account's changes it's read to.
 */
export interface Synced {
  files: Map<string, SyncedFile>;
  rows: Record<Table, Map<string, RowValues>>;
  cursor: number;
}

/** Nothing read yet. */
export const nothingSynced = (): Synced => ({
  files: new Map(),
  rows: { jobs: new Map(), calls: new Map(), notes: new Map() },
  cursor: 0,
});

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
 * Reads what's changed in sync since `synced` was read, into it: each changed record's latest
 * version, a page at a time, from where it left off, or from the start of the account's changes
 * for nothing read yet. What was deleted is taken out, and rows of tables a fill doesn't read are
 * passed over. A server that starts over, as after a restore from a backup, is read again whole.
 */
export async function pullSynced(
  client: SyncClient,
  keys: AccountKeys,
  synced: Synced,
): Promise<void> {
  for (;;) {
    const from = synced.cursor;
    const page = await client.changes(from);
    if (page.cursor < from) {
      synced.files.clear();
      for (const rows of Object.values(synced.rows)) rows.clear();
    }
    const records = await Promise.all(page.changes.map((change) => openChange(keys, change)));
    for (const record of records) {
      if (record?.kind === 'file') {
        if (record.file) synced.files.set(record.path, record.file);
        else synced.files.delete(record.path);
      } else if (record && isTable(record.table)) {
        if (record.row) synced.rows[record.table].set(record.id, record.row);
        else synced.rows[record.table].delete(record.id);
      }
    }
    synced.cursor = page.cursor;
    if (!page.more || page.changes.length === 0) break;
  }
}

/** Reads what sync holds now, from the start of the account's changes. */
export async function readSynced(client: SyncClient, keys: AccountKeys): Promise<Synced> {
  const synced = nothingSynced();
  await pullSynced(client, keys, synced);
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

/** A job folder's job.md, by the folder's name. */
export const notesPath = (folder: string) => `applications/${folder}/job.md`;

/**
 * Each job folder a job's row names, as the app last found it, by the folder's name, with the
 * job's ID: one sync holds, named by no other job's row. Rows from an app before it kept a job's
 * folder name none, and neither does a job merged into another.
 */
export function namedFolders(synced: Synced): Map<string, string> {
  const named = new Map<string, string | null>();
  for (const stored of synced.rows.jobs.values()) {
    const row = trackedRow(stored as StoredRow);
    if (!row.folder || row.mergedInto || !synced.files.has(notesPath(row.folder))) continue;
    named.set(row.folder, named.has(row.folder) ? null : row.id);
  }
  return new Map([...named].flatMap(([folder, id]) => (id ? [[folder, id] as const] : [])));
}

/** The jobs the app's own matching makes of the job folders whose job.md was read. */
function foundJobs(
  workspace: WorkspaceReader,
  rows: readonly TrackedRow[],
): Map<string, CollectedJob> {
  return new Map(
    collectJobs(readRecords(workspace), knownJobsOf(rows)).map((job) => [job.id, job]),
  );
}

/** Each job's row, as sync holds it. */
const jobRows = (synced: Synced) =>
  [...synced.rows.jobs.values()].map((row) => trackedRow(row as StoredRow));

/**
 * The job.md of each job folder a fill reads, by its path: each folder no job's row names, as
 * from an app before rows named them, and every folder of a job one of those joins, so that job
 * is made of all its folders, as the app makes it. A folder a job's row names is that job's, by
 * the row, and isn't read. `text` reads a file's text, or null for one the store doesn't have.
 */
export async function readJobNotes(
  synced: Synced,
  text: (path: string) => Promise<string | null>,
): Promise<Map<string, string>> {
  const named = namedFolders(synced);
  const rows = jobRows(synced);
  const notes = new Map<string, string>();
  const tried = new Set<string>();
  let paths = jobNotesPaths(synced).filter((path) => !named.has(path.split('/')[1] ?? ''));
  while (paths.length > 0) {
    for (const path of paths) tried.add(path);
    const texts = await inTurns(paths, text);
    paths.forEach((path, at) => {
      const read = texts[at];
      if (read) notes.set(path, read);
    });
    const found = foundJobs(syncedWorkspace(synced.files, notes), rows);
    paths = [...named]
      .filter(([folder, id]) => found.has(id) && !tried.has(notesPath(folder)))
      .map(([folder]) => notesPath(folder));
  }
  return notes;
}

/**
 * A job whose row names its folder, as the app last found it, made of its row and what sync holds
 * in the folder, without reading the folder's job.md: its name and links from its row, as the app
 * keeps them, and the folder's resumes and cover letters. What only the job.md says, such as where
 * the job is, is read for the job a form's for.
 */
function namedJob(row: TrackedRow, folder: string, workspace: WorkspaceReader): CollectedJob {
  return {
    id: row.id,
    company: row.company,
    companyKey: row.companyKey,
    role: row.role,
    link: row.links[0]?.url ?? null,
    links: row.links,
    location: null,
    pay: null,
    source: '',
    fit: null,
    search: null,
    searches: [],
    kindFound: null,
    folder,
    // Claude's work made the folder, which takes a job out of New.
    stage: 'review',
    firstSeen: row.firstSeen,
    lastActivity: row.firstSeen,
    summary: null,
    events: [],
    docs: {},
    outreach: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    ...folderFiles(workspace, folder),
  };
}

/**
 * Where a job is, as its folder's job.md says, for a job whose row named the folder, so it wasn't
 * read for the list: null when it doesn't say.
 */
export function notesLocation(synced: Synced, folder: string, text: string): string | null {
  const workspace = syncedWorkspace(synced.files, new Map([[notesPath(folder), text]]));
  const record = readRecords(workspace).find((each) => each.tool === 'folder');
  return record?.tool === 'folder' ? record.location : null;
}

/**
 * Every job, as the app lists them: each tracker row, joined with what the job folders' job.md
 * files say, by the app's own matching, so a job has the folder, resumes and cover letters the app
 * shows for it. `notes` holds each job.md's text read, by its path (readJobNotes): a job whose row
 * names its folder, and that no folder read joins, is its row with the folder's files. A job the
 * user merged into another isn't listed, and one whose files are gone stays only while the user
 * tracks something about it. The app also lists a job a job search turned up, from the search's
 * files, which a fill doesn't read: those are `others`, each by its row alone, with the rest the
 * app wouldn't list.
 */
export function syncedJobs(
  synced: Synced,
  notes: ReadonlyMap<string, string>,
): { listed: Job[]; others: Job[] } {
  const workspace = syncedWorkspace(synced.files, notes);
  const rows = jobRows(synced);
  const found = foundJobs(workspace, rows);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [folder, id] of namedFolders(synced)) {
    const row = byId.get(id);
    if (row && !found.has(id) && !notes.has(notesPath(folder))) {
      found.set(id, namedJob(row, folder, workspace));
    }
  }
  const rowsOf = (table: 'calls' | 'notes') => [...synced.rows[table].values()] as StoredRow[];
  const items = {
    calls: byJob(rowsOf('calls'), trackedCall),
    history: new Map(),
    notes: byJob(rowsOf('notes'), trackedNote),
  };
  const listed = jobList(rows, found, items);
  const ids = new Set(listed.map((job) => job.id));
  const others = jobList(rows, found, items, { untracked: true }).filter((job) => !ids.has(job.id));
  return { listed, others };
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
