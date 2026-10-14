import {
  byJob,
  type CollectedJob,
  callOrder,
  changeOrder,
  collectJobs,
  type Job,
  type JobDocs,
  jobList,
  KINDS_FILE,
  type KindName,
  kindNamesIn,
  noteOrder,
  readJobExtras,
  readRecords,
  type StoredRow,
  type TrackedRow,
  trackedCall,
  trackedChange,
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
  fromUtf8,
  nameOf,
  openFile,
  openRecord,
  recordId,
  type SyncClient,
} from '@factwright/sync';

/** A file in the synced workspace, without its contents. */
export interface SyncedFile {
  path: string;
  id: string;
  size: number;
  modified: string;
}

/** The job hunt as this browser opened it. */
export interface Vault {
  jobs: Job[];
  /** The kinds of job the user wants, by id and name, when there's more than one. */
  kinds: KindName[];
  /** Every file in the workspace, by path. */
  files: Map<string, SyncedFile>;
  /** Each job's documents, such as its posting and fit check, as text. */
  docs: Map<string, JobDocs>;
  /** Claude's answers to the user's questions about each job, by the question's ID. */
  asked: Map<string, Record<string, string>>;
  /** The tracker's rows as stored, by table, for downloading a copy. */
  rows: Record<string, StoredRow[]>;
  /** Records that wouldn't open: locked with another key, or damaged. */
  unreadable: number;
  /**
   * Each job's page address, by job ID: a code made from the job's ID with the account's key.
   * A job's ID names its company and role, and an address goes to the server, into the browser's
   * history and wherever that history syncs, so the address shows only the code.
   */
  pages: Map<string, string>;
}

/** How much of the code a job's page address keeps: 96 bits, plenty within one job hunt. */
const PAGE_CODE_LENGTH = 16;

/**
 * The files the job list is read from: each job's notes, the logs, job searches, and Claude's
 * answers to the user's questions about a job.
 */
const READ_FOR_JOBS =
  /^(applications\/[^/]+\/[^/]+\.md|searches\/[^/]+\.md|searches\/[^/]+\/jobs\.json|asked\/[^/]+\/[^/]+\.md)$/;

/** The kinds of job the user wants, as the desktop app reads them, or none from a broken file. */
function readKinds(text: string | null): KindName[] {
  try {
    return kindNamesIn(JSON.parse(text ?? 'null'));
  } catch {
    return [];
  }
}

/** How many files download at once. */
const AT_ONCE = 6;

/** Every change on the server, from the start, a page at a time. */
async function allChanges(client: SyncClient): Promise<Change[]> {
  const changes: Change[] = [];
  let cursor = 0;
  for (;;) {
    const page = await client.changes(cursor);
    changes.push(...page.changes);
    cursor = page.cursor;
    if (!page.more) return changes;
  }
}

/** A file's contents, downloaded and opened, or null when they won't open. */
export async function fileContents(
  client: SyncClient,
  keys: AccountKeys,
  id: string,
): Promise<Bytes | null> {
  const locked = await client.getFile(id);
  return locked && openFile(keys, id, locked);
}

/** Reads the synced workspace from memory, the way the desktop app reads it from disk. */
function readerOf(files: Map<string, SyncedFile>, texts: Map<string, string>): WorkspaceReader {
  const folders = new Map<string, Map<string, WorkspaceEntry>>();
  const add = (folder: string, entry: WorkspaceEntry) => {
    const entries = folders.get(folder) ?? new Map<string, WorkspaceEntry>();
    if (!entries.has(entry.name)) entries.set(entry.name, entry);
    folders.set(folder, entries);
  };
  for (const file of files.values()) {
    const parts = file.path.split('/');
    parts.forEach((name, index) => {
      const folder = parts.slice(0, index).join('/');
      const last = index === parts.length - 1;
      add(folder, {
        name,
        folder: !last,
        size: last ? file.size : 0,
        modified: last ? file.modified : '',
      });
    });
  }
  return {
    readText: (path) => texts.get(path) ?? null,
    list: (path) => [...(folders.get(path)?.values() ?? [])],
  };
}

/** A tracker row for a job the files show but the tracker doesn't have yet. */
function untracked(job: CollectedJob): TrackedRow {
  return {
    id: job.id,
    company: job.company,
    companyKey: job.companyKey,
    role: job.role,
    links: job.links,
    manual: false,
    payText: null,
    firstSeen: job.firstSeen,
    status: null,
    statusOn: null,
    backOn: null,
    passReason: null,
    appliedOn: null,
    nextAction: null,
    nextOn: null,
    questions: [],
    sent: [],
    asks: [],
    earlierNotes: null,
    archived: false,
    kind: null,
  };
}

/**
 * Opens the account's job hunt in the browser: downloads every record, opens each with the
 * account's keys, reads the files the job list needs, and joins them with the tracker, just as
 * the desktop app does. Nothing leaves the browser opened.
 */
export async function openVault(client: SyncClient, keys: AccountKeys): Promise<Vault> {
  const files = new Map<string, SyncedFile>();
  const rows: Record<string, StoredRow[]> = { jobs: [], status_log: [], calls: [], notes: [] };
  let unreadable = 0;
  for (const change of await allChanges(client)) {
    if (change.deleted) continue;
    const plain = await openRecord(keys, change.record, change.version, change.data);
    const record = plain && decodeRecord(plain);
    if (!record || (await recordId(keys, nameOf(record))) !== change.record) {
      unreadable += 1;
      continue;
    }
    if (record.kind === 'file') {
      const file = (record as FileRecord).file;
      if (file) files.set(record.path, { path: record.path, ...file });
    } else if (record.row) {
      rows[record.table]?.push({ ...record.row, id: record.id });
    }
  }

  const texts = new Map<string, string>();
  const wanted = [...files.values()].filter(
    (file) => READ_FOR_JOBS.test(file.path) || file.path === KINDS_FILE,
  );
  for (let i = 0; i < wanted.length; i += AT_ONCE) {
    await Promise.all(
      wanted.slice(i, i + AT_ONCE).map(async (file) => {
        const contents = await fileContents(client, keys, file.id);
        const text = contents && fromUtf8(contents);
        if (text !== null) texts.set(file.path, text);
        else unreadable += 1;
      }),
    );
  }

  const tracked = (rows.jobs ?? []).map(trackedRow);
  const known = tracked.map(({ id, company, companyKey, role, links }) => ({
    id,
    company,
    companyKey,
    role,
    links,
  }));
  const reader = readerOf(files, texts);
  const collected = collectJobs(readRecords(reader), known);
  const found = new Map(collected.map((job) => [job.id, job]));
  const ids = new Set(tracked.map((row) => row.id));
  const all = [...tracked, ...collected.filter((job) => !ids.has(job.id)).map(untracked)];
  const calls = byJob([...(rows.calls ?? [])].sort(callOrder), trackedCall);
  const history = byJob([...(rows.status_log ?? [])].sort(changeOrder), trackedChange);
  const notes = byJob([...(rows.notes ?? [])].sort(noteOrder), trackedNote);
  const docs = new Map(collected.map((job) => [job.id, job.docs]));
  const jobs = jobList(all, found, { calls, history, notes });
  const asked = new Map(jobs.map((job) => [job.id, readJobExtras(reader, job.id).asked]));
  const pages = new Map(
    await Promise.all(
      jobs.map(
        async (job) =>
          [job.id, (await recordId(keys, `page/${job.id}`)).slice(0, PAGE_CODE_LENGTH)] as const,
      ),
    ),
  );
  return {
    jobs,
    kinds: readKinds(texts.get(KINDS_FILE) ?? null),
    files,
    docs,
    asked,
    rows,
    unreadable,
    pages,
  };
}
