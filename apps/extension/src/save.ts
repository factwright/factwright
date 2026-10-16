import {
  companyKey,
  JOB_LIMITS,
  jobIdFor,
  localDate,
  newJobRows,
  normalizeUrl,
  roleKey,
  savedPostingFile,
  savedPostingMarkdown,
  shortCode,
  slug,
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

export type SaveResult =
  | { ok: true; id: string; already: boolean; posting: PostingSaved }
  | {
      ok: false;
      reason: 'signed-out' | 'offline' | 'full' | 'no-access' | 'failed';
      message: string;
    };

/** How many jobs with the same company and role it tries IDs for: "-2" up to this. */
const MAX_SAME = 50;
/** How many times it tries the job's history and posting, with the connection lost. */
const TRIES = 3;

export interface SaveDeps {
  /** What the job's records say made them, such as "Save to Factwright in Chrome". */
  device: string;
  now?: () => Date;
  uuid?: () => string;
  /** Waits before trying again: a second, then two. */
  pause?: (ms: number) => Promise<void>;
}

/** Who made a change, and when. */
interface Made {
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
async function rowChange(
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

/** The jobs row at an ID, as it is now, or null when there's none. */
async function currentJob(
  client: SyncClient,
  keys: AccountKeys,
  id: string,
): Promise<RowRecord | null> {
  const record = await recordId(keys, rowName('jobs', id));
  const [latest] = await client.versions(record);
  if (!latest || latest.deleted) return null;
  const change = await client.version(record, latest.version);
  return change ? openJob(keys, change) : null;
}

/**
 * The ID a job had before IDs were cut short to fit a folder's name: its company's and role's
 * whole keys. The app still knows the jobs it added or found before then by these.
 */
function wholeId(company: string, role: string): string | null {
  const companyPart = companyKey(company) || slug(company);
  return companyPart ? `${companyPart}--${roleKey(role) || 'general'}` : null;
}

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
function failed(error: unknown): SaveResult {
  if (error instanceof SyncError) {
    if (error.kind === 'signed-out') {
      return { ok: false, reason: 'signed-out', message: 'Save to Factwright was signed out.' };
    }
    if (error.kind === 'offline') {
      return {
        ok: false,
        reason: 'offline',
        message: 'Couldn’t reach Factwright’s sync. Try again.',
      };
    }
    if (error.kind === 'full') {
      return { ok: false, reason: 'full', message: 'Your sync account is full.' };
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
 * The job's ID comes from its company and role, as the app makes it. A deleted job's ID is free
 * again. When the ID is taken, it's the same job if it has the same link: nothing more is saved
 * but its posting, if it has none yet. Otherwise the next ID, "-2" on, is tried.
 */
export async function saveJob(
  client: SyncClient,
  keys: AccountKeys,
  job: JobToSave,
  deps: SaveDeps,
): Promise<SaveResult> {
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
    // A job with a long company or title, which the app knows by its whole ID from before.
    const whole = wholeId(fields.company, fields.role);
    const known = whole && whole !== base ? await currentJob(client, keys, whole) : null;
    if (whole && known && hasLink(known.row, fields.link)) {
      const kept = await addPosting(client, keys, whole, posting, made, pause);
      return { ok: true, id: whole, already: true, posting: kept };
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
    return failed(error);
  }
}

/** Tries something again while the connection is lost, a second, then two, apart. */
async function retried<T>(
  work: () => Promise<T>,
  pause: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
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
    const options = { replace: true, with: [history] };
    return await retried(() => pushPosting(client, keys, id, posting, made, options), pause);
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
  const options = { replace: false };
  return retried(() => pushPosting(client, keys, id, posting, made, options), pause).catch(
    () => 'failed' as const,
  );
}

/**
 * Keeps a job's posting in its saved extras: `saved/<job ID>/posting.md`. One that's there already
 * is kept, unless `replace` says it's left from an earlier job with this ID. One that was deleted
 * is put back.
 */
async function pushPosting(
  client: SyncClient,
  keys: AccountKeys,
  jobId: string,
  posting: Posting,
  made: Made,
  options: { replace: boolean; with?: PushChange[] },
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
  if (!options.replace && !result.current.deleted) return 'kept';
  const [again] = (await client.push([await change(result.current.version)])).results;
  return again?.ok ? 'saved' : 'failed';
}
