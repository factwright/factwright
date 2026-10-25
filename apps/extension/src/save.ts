import {
  type AskedJob,
  JOB_LIMITS,
  jobIdFor,
  localDate,
  mergedTargets,
  newJobRows,
  normalizeUrl,
  type StoredRow,
  savedJobFor,
  savedPostingFile,
  savedPostingMarkdown,
  shortCode,
  type TrackedRow,
  trackedRow,
} from '@factwright/core';
import {
  type AccountKeys,
  type Change,
  decodeRecord,
  encodeRecord,
  type FileRecord,
  fileName,
  openRecord,
  type PushChange,
  type RowRecord,
  recordId,
  rowName,
  type SyncClient,
  SyncError,
  sealFile,
  sealRecord,
  utf8,
} from '@factwright/sync';
import type { PageAsked, SavedFor } from './saved.ts';
import { nothingSynced, pullSynced, type Synced } from './synced.ts';

/** A job to add to the job hunt, as the person checked it in the extension. */
export interface JobToSave {
  /** The job's own address. */
  url: string;
  /** The site it was saved from, such as "linkedin.com". */
  site: string;
  company: string;
  /** The job's title. */
  role: string;
  pay: string;
  /** The posting's text, or nothing when only the link is saved. */
  posting: string;
}

/**
 * What became of a saved job's posting: saved now, kept as an earlier save left it, none to save,
 * or not saved, when the job got in but its posting didn't. Saving the job again adds it.
 */
export type PostingSaved = 'saved' | 'kept' | 'none' | 'failed';

/**
 * How a save went: the job's ID, whether the job hunt had it already and what became of its
 * posting, and `joined` for a job it had by its role alone, which the job's link was added to.
 * Saved for Factwright on this computer before it could answer, `later` says it adds the job: in a
 * moment, when it's `open` but busy, as while it starts, or else the next time it opens. Or why it
 * didn't save: "no-app" when Factwright on this computer can't be reached, and "no-access" when the
 * browser won't let the extension reach where it saves.
 */
export type SaveResult =
  | { ok: true; id: string; already: boolean; posting: PostingSaved; joined?: true }
  | { ok: true; later: true; open?: true }
  | {
      ok: false;
      /** "paused": where sync is sold, the account doesn't have it now, so nothing syncs. */
      reason: 'signed-out' | 'offline' | 'full' | 'no-access' | 'no-app' | 'paused' | 'failed';
      message: string;
    };

/** How a save through sync went, which always knows where the job went. */
export type SyncSaveResult = Exclude<SaveResult, { later: true }>;

/** How many jobs with the same company and role it tries IDs for: "-2" up to this. */
const MAX_SAME = 50;
/** How many times it tries the job's history and posting, with the connection lost. */
const TRIES = 3;
/** How many times a job's link is added again, on another device's newer version of the job. */
const CHANGES = 5;
/** How long what was read of sync's jobs stays in memory after it's last used. */
const KEEP_FOR_MS = 5 * 60 * 1000;

export interface SaveDeps {
  /** What the job's records say made them, such as "Factwright in Chrome". */
  device: string;
  /** The sync server as the person knows it, to name it when it can't be reached. */
  server?: string;
  now?: () => Date;
  uuid?: () => string;
  /** Waits before trying again: a second, then two. */
  pause?: (ms: number) => Promise<void>;
}

/** Who made a change, and when. */
export interface Made {
  device: string;
  at: string;
}

/** A posting to keep with a job, and the day it's saved on. */
interface Posting {
  url: string;
  site: string;
  text: string;
  today: string;
}

/** A change that makes a record the given row, as the version after `base`, 0 for a new record. */
export async function rowChange(
  keys: AccountKeys,
  table: string,
  id: string,
  row: RowRecord['row'],
  made: Made,
  base = 0,
): Promise<PushChange> {
  const record = await recordId(keys, rowName(table, id));
  const body: RowRecord = { kind: 'row', table, id, row, ...made };
  return {
    record,
    base,
    data: await sealRecord(keys, record, base + 1, encodeRecord(body)),
    file: null,
    deleted: false,
  };
}

/** The jobs row in a record another device made, or null when it can't be opened. */
async function openJob(keys: AccountKeys, current: Change): Promise<RowRecord | null> {
  const plain = await openRecord(keys, current.record, current.version, current.data);
  const record = plain && decodeRecord(plain);
  return record?.kind === 'row' && record.table === 'jobs' ? record : null;
}

/** The jobs row at an ID, as it is now, with its version, or null when there's none. */
async function currentJob(
  client: SyncClient,
  keys: AccountKeys,
  id: string,
): Promise<{ row: RowRecord; version: number } | null> {
  const record = await recordId(keys, rowName('jobs', id));
  const [latest] = await client.versions(record);
  if (!latest || latest.deleted) return null;
  const change = await client.version(record, latest.version);
  const row = change && (await openJob(keys, change));
  return row ? { row, version: latest.version } : null;
}

/** The jobs sync holds, as saves and the popup last read them, for the account they're of. */
let read: { account: string; synced: Synced; pulled: Promise<void>; timer?: number } | null = null;

/**
 * Every job sync holds now, but one merged into another, whose name and links are the other's: read
 * once, then only what changed since, until a few minutes after it's last used, in memory only.
 */
export async function syncedJobs(client: SyncClient, keys: AccountKeys): Promise<TrackedRow[]> {
  if (read?.account !== keys.id) {
    read = { account: keys.id, synced: nothingSynced(), pulled: Promise.resolve() };
  }
  const now = read;
  clearTimeout(now.timer);
  now.timer = setTimeout(() => {
    if (read === now) read = null;
  }, KEEP_FOR_MS) as unknown as number;
  // One read after another, so two never read into it at once.
  now.pulled = now.pulled.catch(() => {}).then(() => pullSynced(client, keys, now.synced));
  await now.pulled;
  const rows = [...now.synced.rows.jobs.values()].map((row) => trackedRow(row as StoredRow));
  const merged = mergedTargets(rows);
  return rows.filter((row) => !merged.get(row.id));
}

/** A job's row, as the popup tells of it. */
const askedRow = (row: TrackedRow): AskedJob => ({
  id: row.id,
  company: row.company,
  role: row.role,
  status: row.status ?? 'new',
  appliedOn: row.appliedOn,
});

/** The job on file a page is for, as sync holds your job hunt, for the popup (src/saved.ts). */
export async function savedThroughSync(
  client: SyncClient,
  keys: AccountKeys,
  page: PageAsked,
): Promise<SavedFor | null> {
  const found = savedJobFor(await syncedJobs(client, keys), page);
  return found && { job: askedRow(found.job), how: found.how };
}

/**
 * Adds a link to a job's row, as one change from its latest version, so whatever another device
 * changed stays: on another device's newer version, it's added again to that. The job's ID, or
 * null once it's gone.
 */
async function joinJob(
  client: SyncClient,
  keys: AccountKeys,
  id: string,
  link: string,
  made: Made,
): Promise<string | null> {
  let current = await currentJob(client, keys, id);
  for (let attempt = 0; attempt < CHANGES && current; attempt++) {
    const { row, version } = current;
    if (!row.row) return null;
    if (hasLink(row.row, link)) return id;
    const links = [...trackedRow(row.row as StoredRow).links, { url: link, label: 'Posting' }];
    const joined = { ...row.row, links: JSON.stringify(links), updated_at: made.at };
    const [result] = (await client.push([await rowChange(keys, 'jobs', id, joined, made, version)]))
      .results;
    if (result?.ok) return id;
    if (result?.reason === 'full') throw new SyncError('full', 'full');
    if (result?.reason !== 'conflict' || !result.current || result.current.deleted) return null;
    const newer = await openJob(keys, result.current);
    current = newer ? { row: newer, version: result.current.version } : null;
  }
  if (current) throw new Error('The job kept changing in sync. Try again.');
  return null;
}

/** Whether a job has a link to the same address. */
const sameLink = (job: TrackedRow, url: string) =>
  job.links.some((link) => normalizeUrl(link.url) === normalizeUrl(url));

/** Whether a jobs row has a link to the same address. */
function hasLink(row: RowRecord['row'], url: string): boolean {
  let links: unknown;
  try {
    links = JSON.parse(String(row?.links ?? '[]'));
  } catch {
    return false;
  }
  const wanted = normalizeUrl(url);
  return (
    Array.isArray(links) &&
    links.some((link) => normalizeUrl(String((link as { url?: unknown })?.url ?? '')) === wanted)
  );
}

/** What went wrong, in words, by what the sync client says. */
function failed(error: unknown, server = 'Factwright’s sync'): SyncSaveResult {
  if (error instanceof SyncError) {
    if (error.kind === 'signed-out') {
      return { ok: false, reason: 'signed-out', message: 'The extension was signed out.' };
    }
    if (error.kind === 'offline') {
      return {
        ok: false,
        reason: 'offline',
        message: `Couldn’t reach ${server}. Try again.`,
      };
    }
    if (error.kind === 'full') {
      return { ok: false, reason: 'full', message: 'Your sync account is full.' };
    }
    if (error.kind === 'subscription-needed') {
      return {
        ok: false,
        reason: 'paused',
        // The server turns the first change down, so this save added nothing, even to a job the
        // job hunt has already.
        message:
          'Sync is paused, so nothing was saved. Subscribe in Factwright on your computer, then save it again, or save to Factwright on this computer instead, from Settings.',
      };
    }
    return { ok: false, reason: 'failed', message: error.message };
  }
  return { ok: false, reason: 'failed', message: String(error) };
}

/**
 * Adds a job to the job hunt through sync, as Add job in the app would: its row, as New, its
 * history's first line, and the posting as the person saw it, kept with the job's own extras,
 * where Claude's work later copies it into the job's folder. Everything is locked with the
 * account's keys before it leaves the browser.
 *
 * A job the job hunt has already, as sync holds it, is added to instead, as the app does
 * (@factwright/core's savedJobFor): the same posting, by its link or its ID, is that job, and
 * only its posting is saved, if it has none yet; the same role at the company, where one of the
 * two has no posting of its own, as a job a Hacker News search found by its company's board, gets
 * the link and the posting. Another posting of the same role is a job of its own, as is anything
 * else. Its ID comes from its company and role, as the app makes it, and a deleted job's ID is free
 * again. When the ID is taken, it's the same job if it has the same link, as one another device
 * saved just now. Otherwise the next ID, "-2" on, is tried.
 */
export async function saveJob(
  client: SyncClient,
  keys: AccountKeys,
  job: JobToSave,
  deps: SaveDeps,
): Promise<SyncSaveResult> {
  const now = deps.now?.() ?? new Date();
  const today = localDate(now);
  const made: Made = { device: deps.device.slice(0, 200), at: now.toISOString() };
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  // Cut as the app's Add job dialog cuts them, so the ID and the link are the row's own.
  const fields = {
    company: job.company.trim().slice(0, JOB_LIMITS.company),
    role: job.role.trim().slice(0, JOB_LIMITS.role),
    link: job.url.trim().slice(0, JOB_LIMITS.link),
    pay: job.pay.trim().slice(0, JOB_LIMITS.pay),
  };
  const posting: Posting = { url: fields.link, site: job.site, text: job.posting.trim(), today };
  const base = jobIdFor(
    fields.company,
    fields.role,
    fields.link ? shortCode(normalizeUrl(fields.link)) : undefined,
  );
  const pause = deps.pause ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  try {
    const jobs = await syncedJobs(client, keys);
    const linked = jobs.find((job) => fields.link && sameLink(job, fields.link));
    const found = linked
      ? { job: linked, how: 'same' }
      : savedJobFor(jobs, { url: fields.link, company: fields.company, role: fields.role });
    if (found?.how === 'same') {
      const kept = await addPosting(client, keys, found.job.id, posting, made, pause);
      return { ok: true, id: found.job.id, already: true, posting: kept };
    }
    const joined =
      found?.how === 'joins' && (await joinJob(client, keys, found.job.id, fields.link, made));
    if (joined) {
      const kept = await addPosting(client, keys, joined, posting, made, pause);
      return { ok: true, id: joined, already: true, joined: true, posting: kept };
    }
    for (let n = 1; n <= MAX_SAME; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      const rows = newJobRows({
        id,
        ...fields,
        status: 'new',
        today,
        now: made.at,
        statusId: uuid(),
      });
      // The job's row goes first, alone, so a taken ID leaves nothing else behind.
      let [result] = (await client.push([await rowChange(keys, 'jobs', id, rows.job, made)]))
        .results;
      if (result && !result.ok && result.reason === 'conflict' && result.current?.deleted) {
        const version = result.current.version;
        [result] = (
          await client.push([await rowChange(keys, 'jobs', id, rows.job, made, version)])
        ).results;
      }
      if (!result) return { ok: false, reason: 'failed', message: 'Sync didn’t answer the save.' };
      if (result.ok) {
        const saved = await saveRest(client, keys, id, rows.status, posting, made, pause);
        return { ok: true, id, already: false, posting: saved };
      }
      if (result.reason === 'full') return failed(new SyncError('full', 'full'));
      if (result.reason !== 'conflict') {
        return { ok: false, reason: 'failed', message: 'Sync turned the job away.' };
      }
      // The ID is taken: by this job, if it has the same link, or by another, so try the next.
      const existing = result.current && !result.current.deleted ? result.current : null;
      const found = existing && (await openJob(keys, existing));
      if (found && hasLink(found.row, fields.link)) {
        const kept = await addPosting(client, keys, id, posting, made, pause);
        return { ok: true, id, already: true, posting: kept };
      }
    }
    return { ok: false, reason: 'failed', message: 'Too many jobs with that company and title.' };
  } catch (error) {
    return failed(error, deps.server);
  }
}

/**
 * Tries something again while the connection is lost, a second, then two, apart. `again` says a
 * try before this one was made, which may have got there without its answer getting back.
 */
async function retried<T>(
  work: (again: boolean) => Promise<T>,
  pause: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work(attempt > 1);
    } catch (error) {
      const offline = error instanceof SyncError && error.kind === 'offline';
      if (!offline || attempt >= TRIES) throw error;
      await pause(attempt * 1000);
    }
  }
}

/**
 * The job's history and its posting, once its row is in, and what became of the posting. Tried
 * again through a lost connection, since saving the job again adds only its posting.
 */
async function saveRest(
  client: SyncClient,
  keys: AccountKeys,
  id: string,
  status: Record<string, string | number | null>,
  posting: Posting,
  made: Made,
  pause: (ms: number) => Promise<void>,
): Promise<PostingSaved> {
  try {
    const history = await rowChange(keys, 'status_log', String(status.id), status, made);
    if (!posting.text) {
      await retried(() => client.push([history]), pause);
      return 'none';
    }
    // A posting left from an earlier job with this ID, since deleted: this one takes its place.
    return await retried(
      (again) =>
        pushPosting(client, keys, id, posting, made, { replace: true, again, with: [history] }),
      pause,
    );
  } catch {
    // The job is in: saving it again adds its posting.
    return posting.text ? 'failed' : 'none';
  }
}

/** The posting for a job saved before, by the app or a save that didn't finish, if it has none. */
async function addPosting(
  client: SyncClient,
  keys: AccountKeys,
  id: string,
  posting: Posting,
  made: Made,
  pause: (ms: number) => Promise<void>,
): Promise<PostingSaved> {
  if (!posting.text) return 'none';
  return retried(
    (again) => pushPosting(client, keys, id, posting, made, { replace: false, again }),
    pause,
  ).catch(() => 'failed' as const);
}

/**
 * Keeps a job's posting in its saved extras: `saved/<job ID>/posting.md`. One that's there already
 * is kept, unless `replace` says it's left from an earlier job with this ID. One that was deleted
 * is put back. On a try after one whose answer was lost, the same posting there is this one's.
 */
async function pushPosting(
  client: SyncClient,
  keys: AccountKeys,
  jobId: string,
  posting: Posting,
  made: Made,
  options: { replace: boolean; again: boolean; with?: PushChange[] },
): Promise<'saved' | 'kept' | 'failed'> {
  const path = savedPostingFile(jobId);
  const contents = utf8(
    savedPostingMarkdown({
      url: posting.url,
      site: posting.site,
      savedOn: posting.today,
      text: posting.text,
    }),
  );
  const sealed = await sealFile(keys, contents);
  if ((await client.missingFiles([sealed.id])).includes(sealed.id)) {
    await client.putFile(sealed.id, sealed.data);
  }
  const record = await recordId(keys, fileName(path));
  const change = async (base: number): Promise<PushChange> => {
    const body: FileRecord = {
      kind: 'file',
      path,
      file: { id: sealed.id, size: contents.length, modified: made.at },
      ...made,
    };
    return {
      record,
      base,
      data: await sealRecord(keys, record, base + 1, encodeRecord(body)),
      file: sealed.id,
      deleted: false,
    };
  };
  const { results } = await client.push([...(options.with ?? []), await change(0)]);
  const result = results.find((each) => each.record === record);
  if (!result) return 'failed';
  if (result.ok) return 'saved';
  if (result.reason !== 'conflict' || !result.current) return 'failed';
  // A try before this one got there, but its answer didn't get back: the same contents are there.
  if (options.again && !result.current.deleted && result.current.file === sealed.id) {
    return 'saved';
  }
  if (!options.replace && !result.current.deleted) return 'kept';
  const [again] = (await client.push([await change(result.current.version)])).results;
  return again?.ok ? 'saved' : 'failed';
}
