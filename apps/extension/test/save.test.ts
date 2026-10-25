// @vitest-environment node
import { newJobRows, readSavedPosting, savedPostingFile } from '@factwright/core';
import { startServer, type TestServer } from '@factwright/server/testing';
import {
  type AccountKeys,
  accountKeys,
  decodeRecord,
  encodeRecord,
  fileName,
  fromUtf8,
  newAccountKey,
  openFile,
  openRecord,
  recordId,
  rowName,
  type SyncClient,
  SyncError,
  type SyncRecord,
  sealRecord,
} from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type JobToSave, savedThroughSync, saveJob } from '../src/save.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
}, 60_000);

afterAll(() => server?.close());

const NOW = new Date(2026, 9, 15, 20, 30);
const DEVICE = 'Factwright in Chrome';

const JOB: JobToSave = {
  url: 'https://www.linkedin.com/jobs/view/4012345678/',
  site: 'linkedin.com',
  company: 'Northwind',
  role: 'Staff Engineer, Payments',
  pay: '$200k–$240k',
  posting: 'About the job\n\nBuild payments at scale.\n\n- Go\n- Postgres',
};

/** An account with sync set up, and the extension's session and keys for it. */
async function account() {
  const sam = await server.signUp();
  const keys = await accountKeys(newAccountKey());
  return { client: sam.client as SyncClient, keys };
}

/** What a record says now, by its name, as another device would read it. */
async function readRecord(
  client: SyncClient,
  keys: AccountKeys,
  name: string,
): Promise<SyncRecord | null> {
  const id = await recordId(keys, name);
  const { changes } = await client.changes(0);
  const change = changes.findLast((each) => each.record === id);
  if (!change) return null;
  const plain = await openRecord(keys, id, change.version, change.data);
  return plain && decodeRecord(plain);
}

/** The text of a job's saved posting, as another device would read it. */
async function savedText(client: SyncClient, keys: AccountKeys, jobId: string) {
  const path = savedPostingFile(jobId);
  const file = await readRecord(client, keys, fileName(path));
  if (file?.kind !== 'file' || !file.file) return null;
  const data = await client.getFile(file.file.id);
  const contents = data && (await openFile(keys, file.file.id, data));
  return readSavedPosting(path, fromUtf8(contents ?? new Uint8Array()) ?? '').text;
}

/** Deletes a job's row, as the app does when you delete the job. */
async function deleteJob(client: SyncClient, keys: AccountKeys, jobId: string) {
  const record = await recordId(keys, rowName('jobs', jobId));
  const { changes } = await client.changes(0);
  const version = changes.findLast((each) => each.record === record)?.version ?? 0;
  const body = { kind: 'row', table: 'jobs', id: jobId, row: null, device: 'Mac', at: '' } as const;
  const data = await sealRecord(keys, record, version + 1, encodeRecord(body));
  await client.push([{ record, base: version, data, file: null, deleted: true }]);
}

/** The sync client, with the pushes `fails` picks, counted from 1, failing as a lost connection does. */
function failingPush(client: SyncClient, fails: (push: number) => boolean): SyncClient {
  let pushes = 0;
  return new Proxy(client, {
    get(target, key) {
      if (key === 'push') {
        return (changes: Parameters<SyncClient['push']>[0]) => {
          pushes += 1;
          if (fails(pushes)) return Promise.reject(new SyncError('offline', 'Gone.'));
          return target.push(changes);
        };
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** A job's row in sync, as the app on a computer synced it: a new job's, with what it's given. */
async function syncedJob(
  client: SyncClient,
  keys: AccountKeys,
  id: string,
  row: Record<string, string | number | null>,
) {
  const job = newJobRows({
    id,
    company: String(row.company ?? 'Northwind'),
    role: String(row.role ?? ''),
    link: '',
    pay: '',
    status: 'new',
    today: '2026-10-01',
    now: '2026-10-01T12:00:00.000Z',
    statusId: 'from-the-app',
  }).job;
  const record = await recordId(keys, rowName('jobs', id));
  const body = { kind: 'row', table: 'jobs', id, row: { ...job, ...row }, device: 'Mac', at: '' };
  const data = await sealRecord(keys, record, 1, encodeRecord(body as SyncRecord));
  await client.push([{ record, base: 0, data, file: null, deleted: false }]);
}

const save = (client: SyncClient, keys: AccountKeys, job: JobToSave = JOB, status = 'status-1') =>
  saveJob(client, keys, job, {
    device: DEVICE,
    now: () => NOW,
    uuid: () => status,
    pause: async () => {},
  });

describe('saving a job through sync', () => {
  it('adds it as New, with its history and the posting as the person saw it', async () => {
    const { client, keys } = await account();
    expect(await save(client, keys)).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments',
      already: false,
      posting: 'saved',
    });

    const job = await readRecord(
      client,
      keys,
      rowName('jobs', 'northwind--staff-engineer-payments'),
    );
    expect(job).toMatchObject({
      kind: 'row',
      table: 'jobs',
      device: DEVICE,
      row: {
        company: 'Northwind',
        role: 'Staff Engineer, Payments',
        status: 'new',
        manual: 1,
        pay_text: '$200k–$240k',
        first_seen: '2026-10-15',
        links: JSON.stringify([{ url: JOB.url, label: 'Posting' }]),
      },
    });
    const history = await readRecord(client, keys, rowName('status_log', 'status-1'));
    expect(history).toMatchObject({
      row: { job_id: 'northwind--staff-engineer-payments', status: 'new', at: '2026-10-15' },
    });

    const path = savedPostingFile('northwind--staff-engineer-payments');
    const file = await readRecord(client, keys, fileName(path));
    if (file?.kind !== 'file' || !file.file) throw new Error('no posting saved');
    const data = await client.getFile(file.file.id);
    if (!data) throw new Error('the posting’s file wasn’t uploaded');
    const contents = await openFile(keys, file.file.id, data);
    const posting = readSavedPosting(path, fromUtf8(contents ?? new Uint8Array()) ?? '');
    expect(posting).toEqual({ path, source: JOB.url, saved: '2026-10-15', text: JOB.posting });
  });

  it('saves the link alone when there’s no posting', async () => {
    const { client, keys } = await account();
    const result = await save(client, keys, { ...JOB, posting: '' });
    expect(result).toMatchObject({ ok: true, posting: 'none' });
    const path = savedPostingFile('northwind--staff-engineer-payments');
    expect(await readRecord(client, keys, fileName(path))).toBeNull();
  });

  it('saves a job once: the same link again finds it there', async () => {
    const { client, keys } = await account();
    await save(client, keys);
    const again = { ...JOB, posting: 'The posting, changed since.' };
    expect(await save(client, keys, again, 'status-2')).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments',
      already: true,
      posting: 'kept',
    });
    expect(await readRecord(client, keys, rowName('status_log', 'status-2'))).toBeNull();
    // The posting as it was first saved.
    expect(await savedText(client, keys, 'northwind--staff-engineer-payments')).toBe(JOB.posting);
    // And the same posting again is kept too, not added.
    expect(await save(client, keys, JOB, 'status-3')).toMatchObject({
      already: true,
      posting: 'kept',
    });
  });

  it('adds the posting to a job saved before without one', async () => {
    const { client, keys } = await account();
    await save(client, keys, { ...JOB, posting: '' });
    expect(await save(client, keys, JOB, 'status-2')).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments',
      already: true,
      posting: 'saved',
    });
    expect(await savedText(client, keys, 'northwind--staff-engineer-payments')).toBe(JOB.posting);
  });

  it('tries the job’s history and posting again when the connection drops', async () => {
    const { client, keys } = await account();
    // The job's row goes up in the first push, and its history and posting in the second.
    expect(
      await save(
        failingPush(client, (push) => push === 2),
        keys,
      ),
    ).toMatchObject({
      already: false,
      posting: 'saved',
    });
    expect(await readRecord(client, keys, rowName('status_log', 'status-1'))).not.toBeNull();
    expect(await savedText(client, keys, 'northwind--staff-engineer-payments')).toBe(JOB.posting);
  });

  it('says the posting saved when an earlier try got there but its answer was lost', async () => {
    const { client, keys } = await account();
    await save(client, keys, { ...JOB, posting: '' });
    // Saved again with its posting: the job's row is found in the first push, and the posting
    // gets there in the second, but its answer doesn't.
    let pushes = 0;
    const lossy = new Proxy(client, {
      get(target, key) {
        if (key === 'push') {
          return async (changes: Parameters<SyncClient['push']>[0]) => {
            const answer = await target.push(changes);
            pushes += 1;
            if (pushes === 2) throw new SyncError('offline', 'Gone.');
            return answer;
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect(await save(lossy, keys, JOB, 'status-2')).toMatchObject({
      already: true,
      posting: 'saved',
    });
    expect(await savedText(client, keys, 'northwind--staff-engineer-payments')).toBe(JOB.posting);
  });

  it('says when the job saved but its posting didn’t, and adds it when it’s saved again', async () => {
    const { client, keys } = await account();
    expect(
      await save(
        failingPush(client, (push) => push >= 2),
        keys,
      ),
    ).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments',
      already: false,
      posting: 'failed',
    });
    expect(await savedText(client, keys, 'northwind--staff-engineer-payments')).toBeNull();
    expect(await save(client, keys, JOB, 'status-2')).toMatchObject({
      already: true,
      posting: 'saved',
    });
    expect(await savedText(client, keys, 'northwind--staff-engineer-payments')).toBe(JOB.posting);
  });

  it('gives a deleted job’s ID to the next job with its company and title, as the app does', async () => {
    const { client, keys } = await account();
    await save(client, keys);
    await deleteJob(client, keys, 'northwind--staff-engineer-payments');
    const other = { ...JOB, url: 'https://northwind.example/careers/42', posting: 'New posting' };
    expect(await save(client, keys, other, 'status-2')).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments',
      already: false,
      posting: 'saved',
    });
    const job = await readRecord(
      client,
      keys,
      rowName('jobs', 'northwind--staff-engineer-payments'),
    );
    expect(job).toMatchObject({
      row: { links: JSON.stringify([{ url: other.url, label: 'Posting' }]) },
    });
    // The deleted job's posting gives way to the new one's.
    expect(await savedText(client, keys, 'northwind--staff-engineer-payments')).toBe('New posting');
  });

  it('cuts each field as the app’s Add job does, so a very long link is still found again', async () => {
    const { client, keys } = await account();
    const long = {
      ...JOB,
      url: `https://jobs.example.com/apply?token=${'a'.repeat(2100)}`,
      company: 'N'.repeat(250),
    };
    const first = await save(client, keys, long);
    expect(first).toMatchObject({ ok: true, already: false });
    expect(await save(client, keys, long, 'status-2')).toMatchObject({ ok: true, already: true });
    const id = first.ok ? first.id : '';
    const job = await readRecord(client, keys, rowName('jobs', id));
    if (job?.kind !== 'row' || !job.row) throw new Error('no job saved');
    expect(String(job.row.company)).toHaveLength(200);
    expect(JSON.parse(String(job.row.links))[0].url).toHaveLength(2000);
  });

  it('finds a job the app knows by its whole ID, from before IDs were cut short', async () => {
    const { client, keys } = await account();
    const role =
      'Senior Software Engineer, Machine Learning Infrastructure - Distributed Training Platform';
    const whole =
      'northwind--senior-software-engineer-machine-learning-infrastructure-distributed-training-platform';
    const rows = newJobRows({
      id: whole,
      company: 'Northwind',
      role,
      link: JOB.url,
      pay: '',
      status: 'new',
      today: '2026-10-01',
      now: '2026-10-01T12:00:00.000Z',
      statusId: 'from-the-app',
    });
    const record = await recordId(keys, rowName('jobs', whole));
    const body = { kind: 'row', table: 'jobs', id: whole, row: rows.job, device: 'Mac', at: '' };
    const data = await sealRecord(keys, record, 1, encodeRecord(body as SyncRecord));
    await client.push([{ record, base: 0, data, file: null, deleted: false }]);

    expect(await save(client, keys, { ...JOB, role })).toEqual({
      ok: true,
      id: whole,
      already: true,
      posting: 'saved',
    });
    expect(await savedText(client, keys, whole)).toBe(JOB.posting);
  });

  it('names a job whose company has no Latin letters by its link', async () => {
    const { client, keys } = await account();
    const japanese = { ...JOB, company: '株式会社', role: 'エンジニア' };
    const first = await save(client, keys, japanese);
    const second = await save(client, keys, { ...japanese, url: 'https://example.jp/jobs/2' });
    expect(first).toMatchObject({
      ok: true,
      id: expect.stringMatching(/^job-[0-9a-f]{8}--general$/),
    });
    expect(second).toMatchObject({
      ok: true,
      id: expect.stringMatching(/^job-[0-9a-f]{8}--general$/),
    });
    expect(first.ok && second.ok && first.id !== second.id).toBe(true);
  });

  it('gives another job with the same company and title the next ID', async () => {
    const { client, keys } = await account();
    await save(client, keys);
    const other = { ...JOB, url: 'https://northwind.example/careers/42' };
    expect(await save(client, keys, other, 'status-2')).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments-2',
      already: false,
      posting: 'saved',
    });
  });

  it('finds the posting saved from its own page in a save from its application', async () => {
    const { client, keys } = await account();
    const ashby = 'https://jobs.ashbyhq.com/northwind/8d2f4b61-07ae-4f39-b5c2-e94a1c6d3f80';
    const posted = { ...JOB, url: ashby, site: 'jobs.ashbyhq.com' };
    expect(await save(client, keys, posted)).toMatchObject({ already: false });
    expect(
      await save(client, keys, { ...posted, url: `${ashby}/application`, posting: '' }, 'status-2'),
    ).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments',
      already: true,
      posting: 'none',
    });
    const lever = 'https://jobs.lever.co/northwind/6f0c2e1a-9d4b-4c7e-8a35-2b9e7d10f4c6';
    const designer = { ...JOB, url: lever, site: 'jobs.lever.co', role: 'Product Designer' };
    await save(client, keys, designer, 'status-3');
    expect(await save(client, keys, { ...designer, url: `${lever}/apply` }, 'status-4')).toEqual({
      ok: true,
      id: 'northwind--product-designer',
      already: true,
      posting: 'kept',
    });
  });

  it('adds the link and posting to the same role found by its company’s board alone', async () => {
    const { client, keys } = await account();
    // Seeq's job, as a Hacker News search found it: by its company's whole board, and the post.
    const found = 'seeq--ai-software-engineer-staff-principal';
    const board = [
      { url: 'https://apply.workable.com/seeq', label: 'Board' },
      { url: 'https://news.ycombinator.com/item?id=45678901', label: 'HN post' },
    ];
    await syncedJob(client, keys, found, {
      company: 'Seeq',
      company_key: 'seeq',
      role: 'AI Software Engineer, Staff/Principal',
      links: JSON.stringify(board),
      manual: 0,
      status: null,
      status_on: null,
    });
    const url = 'https://apply.workable.com/seeq/j/1B6E0A1710/';
    const seeq = {
      url,
      site: 'apply.workable.com',
      company: 'Seeq',
      role: 'AI Software Engineer - Staff/Principal',
      pay: '',
      posting: 'About Seeq\n\nBuild advanced analytics for process manufacturing.',
    };
    expect(await save(client, keys, seeq)).toEqual({
      ok: true,
      id: found,
      already: true,
      joined: true,
      posting: 'saved',
    });
    const job = await readRecord(client, keys, rowName('jobs', found));
    expect(job?.kind === 'row' && JSON.parse(String(job.row?.links))).toEqual([
      ...board,
      { url, label: 'Posting' },
    ]);
    expect(job?.kind === 'row' && job.row?.status).toBeNull();
    expect(await savedText(client, keys, found)).toBe(seeq.posting);
    expect(await readRecord(client, keys, rowName('jobs', `${found}-2`))).toBeNull();
    // Its application is that posting now.
    expect(
      await save(client, keys, { ...seeq, url: `${url}apply/`, posting: '' }, 'status-2'),
    ).toEqual({ ok: true, id: found, already: true, posting: 'none' });
  });

  it('tells two roles saved from one careers page apart, and finds each again', async () => {
    const { client, keys } = await account();
    const careers = { ...JOB, url: 'https://northwind.example/careers', site: 'northwind.example' };
    expect(await save(client, keys, { ...careers, role: 'Data Analyst' })).toMatchObject({
      id: 'northwind--data-analyst',
      already: false,
    });
    expect(
      await save(client, keys, { ...careers, role: 'Product Designer' }, 'status-2'),
    ).toMatchObject({ id: 'northwind--product-designer', already: false });
    expect(
      await save(client, keys, { ...careers, role: 'Data Analyst' }, 'status-3'),
    ).toMatchObject({ id: 'northwind--data-analyst', already: true });
    expect(await savedText(client, keys, 'northwind--product-designer')).toBe(JOB.posting);
  });

  it('joins no job that has a posting of its own by the time it would, as another save made', async () => {
    const { client, keys } = await account();
    const found = 'seeq--ai-software-engineer-staff-principal';
    const board = { url: 'https://apply.workable.com/seeq', label: 'Board' };
    await syncedJob(client, keys, found, {
      company: 'Seeq',
      company_key: 'seeq',
      role: 'AI Software Engineer, Staff/Principal',
      links: JSON.stringify([board]),
    });
    const seeq = {
      url: 'https://apply.workable.com/seeq/j/1B6E0A1710/',
      site: 'apply.workable.com',
      company: 'Seeq',
      role: 'AI Software Engineer - Staff/Principal',
      pay: '',
      posting: 'About Seeq',
    };
    // Another device adds another posting to the job just after this save read sync's jobs, as
    // it reads the job again to join it.
    const record = await recordId(keys, rowName('jobs', found));
    const other = async () => {
      const { changes } = await client.changes(0);
      const latest = changes.findLast((each) => each.record === record);
      const plain = latest && (await openRecord(keys, record, latest.version, latest.data));
      const current = plain && decodeRecord(plain);
      if (!latest || current?.kind !== 'row' || !current.row) throw new Error('No job to change.');
      const links = [
        board,
        { url: 'https://apply.workable.com/seeq/j/0BEAE8BEA3/', label: 'Posting' },
      ];
      const row = { ...current.row, links: JSON.stringify(links) };
      const body = { kind: 'row', table: 'jobs', id: found, row, device: 'Mac', at: '' };
      const version = latest.version + 1;
      const data = await sealRecord(keys, record, version, encodeRecord(body as SyncRecord));
      await client.push([{ record, base: latest.version, data, file: null, deleted: false }]);
    };
    let raced = false;
    const racing = new Proxy(client, {
      get(target, key) {
        if (key === 'versions') {
          return async (asked: string) => {
            if (asked === record && !raced) {
              raced = true;
              await other();
            }
            return target.versions(asked);
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect(await save(racing, keys, seeq)).toMatchObject({
      ok: true,
      id: `${found}-2`,
      already: false,
    });
    expect(raced).toBe(true);
    const job = await readRecord(client, keys, rowName('jobs', found));
    expect(job?.kind === 'row' && String(job.row?.links)).not.toContain('1B6E0A1710');
  });

  it('finds the job kept for one the user merged into another', async () => {
    const { client, keys } = await account();
    await syncedJob(client, keys, 'northwind--staff-engineer', {
      role: 'Staff Engineer',
      links: JSON.stringify([{ url: JOB.url, label: 'Posting' }]),
    });
    await syncedJob(client, keys, 'northwind--staff-engineer-payments', {
      role: JOB.role,
      links: JSON.stringify([{ url: JOB.url, label: 'Posting' }]),
      merged_into: 'northwind--staff-engineer',
    });
    expect(await save(client, keys)).toMatchObject({
      ok: true,
      id: 'northwind--staff-engineer',
      already: true,
    });
  });

  it('says when the extension has been signed out', async () => {
    const { keys } = await account();
    const signedOut = server.clientFor('not-a-session');
    expect(await save(signedOut, keys)).toMatchObject({ ok: false, reason: 'signed-out' });
  });

  it('says sync is paused, saving nothing, when the account needs a subscription', async () => {
    const { client, keys } = await account();
    const paused = new Proxy(client, {
      get(target, key) {
        if (key === 'push' || key === 'putFile') {
          return () =>
            Promise.reject(
              new SyncError(
                'subscription-needed',
                'Sync on Factwright’s server needs a subscription.',
                402,
                null,
                'subscription-needed',
              ),
            );
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect(await save(paused, keys)).toEqual({
      ok: false,
      reason: 'paused',
      message:
        'Sync is paused, so nothing was saved. Subscribe in Factwright on your computer, then save it again, or save to Factwright on this computer instead, from Settings.',
    });
    expect((await client.changes(0)).changes).toEqual([]);
  });

  it('names the sync server it couldn’t reach', async () => {
    const { client, keys } = await account();
    const gone = failingPush(client, () => true);
    expect(await save(gone, keys)).toMatchObject({
      ok: false,
      reason: 'offline',
      message: 'Couldn’t reach Factwright’s sync. Try again.',
    });
    const own = {
      device: DEVICE,
      server: 'your sync server, sync.example.com',
      pause: async () => {},
    };
    expect(await saveJob(gone, keys, JOB, own)).toMatchObject({
      message: 'Couldn’t reach your sync server, sync.example.com. Try again.',
    });
  });
});

describe('looking a page’s job up through sync', () => {
  it('finds a job saved from the same posting, its application too, with its status', async () => {
    const { client, keys } = await account();
    await save(client, keys);
    expect(
      await savedThroughSync(client, keys, {
        url: 'https://www.linkedin.com/jobs/view/staff-engineer-at-northwind-4012345678/',
        company: '',
        role: '',
      }),
    ).toEqual({
      job: {
        id: 'northwind--staff-engineer-payments',
        company: 'Northwind',
        role: JOB.role,
        status: 'new',
        appliedOn: null,
      },
      how: 'same',
    });
  });

  it('finds the same role, saying a save adds to it, and none for another job', async () => {
    const { client, keys } = await account();
    await syncedJob(client, keys, 'seeq--ai-software-engineer-staff-principal', {
      company: 'Seeq',
      company_key: 'seeq',
      role: 'AI Software Engineer, Staff/Principal',
      links: JSON.stringify([{ url: 'https://apply.workable.com/seeq', label: 'Board' }]),
    });
    const page = {
      url: 'https://apply.workable.com/seeq/j/1B6E0A1710/',
      company: 'Seeq',
      role: 'AI Software Engineer - Staff/Principal',
    };
    expect(await savedThroughSync(client, keys, page)).toMatchObject({
      job: { id: 'seeq--ai-software-engineer-staff-principal' },
      how: 'joins',
    });
    expect(
      await savedThroughSync(client, keys, { ...page, role: 'Analytics Engineer' }),
    ).toBeNull();
  });
});
