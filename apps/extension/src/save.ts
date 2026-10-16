import {
  jobIdFor,
  localDate,
  newJobRows,
  normalizeUrl,
  savedPostingFile,
  savedPostingMarkdown,
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

export type SaveResult =
  | { ok: true; id: string; already: boolean }
  | { ok: false; reason: 'signed-out' | 'offline' | 'full' | 'failed'; message: string };

/** How many jobs with the same company and role it tries IDs for: "-2" up to this. */
const MAX_SAME = 50;

export interface SaveDeps {
  /** What the job's records say made them, such as "Save to Factwright in Chrome". */
  device: string;
  now?: () => Date;
  uuid?: () => string;
}

/** A row record, locked as the first version of a record. */
async function newRow(
  keys: AccountKeys,
  table: string,
  id: string,
  row: RowRecord['row'],
  made: { device: string; at: string },
): Promise<PushChange> {
  const record = await recordId(keys, rowName(table, id));
  const body: RowRecord = { kind: 'row', table, id, row, ...made };
  return {
    record,
    base: 0,
    data: await sealRecord(keys, record, 1, encodeRecord(body)),
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
 * The job's ID comes from its company and role. When that ID is taken, it's the same job if it has
 * the same link, and nothing more is saved; otherwise the next ID, "-2" on, is tried.
 */
export async function saveJob(
  client: SyncClient,
  keys: AccountKeys,
  job: JobToSave,
  deps: SaveDeps,
): Promise<SaveResult> {
  const now = deps.now?.() ?? new Date();
  const today = localDate(now);
  const at = now.toISOString();
  const made = { device: deps.device.slice(0, 200), at };
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const base = jobIdFor(job.company, job.role);
  try {
    for (let n = 1; n <= MAX_SAME; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      const rows = newJobRows({
        id,
        company: job.company,
        role: job.role,
        link: job.url,
        pay: job.pay,
        status: 'new',
        today,
        now: at,
        statusId: uuid(),
      });
      // The job's row goes first, alone, so a taken ID leaves nothing else behind.
      const [result] = (await client.push([await newRow(keys, 'jobs', id, rows.job, made)]))
        .results;
      if (!result) return { ok: false, reason: 'failed', message: 'Sync didn’t answer the save.' };
      if (result.ok) {
        await saveRest(client, keys, job, id, rows.status, { today, made });
        return { ok: true, id, already: false };
      }
      if (result.reason === 'full') return failed(new SyncError('full', 'full'));
      if (result.reason !== 'conflict') {
        return { ok: false, reason: 'failed', message: 'Sync turned the job away.' };
      }
      // The ID is taken: by this job, if it has the same link, or by another, so try the next.
      const existing = result.current && !result.current.deleted ? result.current : null;
      const found = existing && (await openJob(keys, existing));
      if (found && hasLink(found.row, job.url)) return { ok: true, id, already: true };
    }
    return { ok: false, reason: 'failed', message: 'Too many jobs with that company and title.' };
  } catch (error) {
    return failed(error);
  }
}

/** The job's history and its saved posting, once its row is in. */
async function saveRest(
  client: SyncClient,
  keys: AccountKeys,
  job: JobToSave,
  id: string,
  status: Record<string, string | number | null>,
  { today, made }: { today: string; made: { device: string; at: string } },
): Promise<void> {
  const changes = [await newRow(keys, 'status_log', String(status.id), status, made)];
  const text = job.posting.trim();
  if (text) {
    const path = savedPostingFile(id);
    const contents = utf8(
      savedPostingMarkdown({ url: job.url, site: job.site, savedOn: today, text }),
    );
    const sealed = await sealFile(keys, contents);
    if ((await client.missingFiles([sealed.id])).includes(sealed.id)) {
      await client.putFile(sealed.id, sealed.data);
    }
    const record = await recordId(keys, fileName(path));
    const file = (version: number) => {
      const body: FileRecord = {
        kind: 'file',
        path,
        file: { id: sealed.id, size: contents.length, modified: made.at },
        ...made,
      };
      return sealRecord(keys, record, version, encodeRecord(body));
    };
    changes.push({ record, base: 0, data: await file(1), file: sealed.id, deleted: false });
    const { results } = await client.push(changes);
    // A posting left from an earlier job with this ID, since deleted: this one takes its place.
    const clash = results.find((each) => each.record === record && !each.ok);
    if (clash && !clash.ok && clash.reason === 'conflict' && clash.current) {
      const version = clash.current.version;
      await client.push([
        { record, base: version, data: await file(version + 1), file: sealed.id, deleted: false },
      ]);
    }
    return;
  }
  await client.push(changes);
}
