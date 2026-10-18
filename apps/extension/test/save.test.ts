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
import { type JobToSave, saveJob } from '../src/save.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
}, 60_000);

afterAll(() => server?.close());

const NOW = new Date(2026, 9, 15, 20, 30);
const DEVICE = 'Save to Factwright in Chrome';

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

  it('says when the extension has been signed out', async () => {
    const { keys } = await account();
    const signedOut = server.clientFor('not-a-session');
    expect(await save(signedOut, keys)).toMatchObject({ ok: false, reason: 'signed-out' });
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
