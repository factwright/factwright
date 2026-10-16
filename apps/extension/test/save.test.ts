// @vitest-environment node
import { readSavedPosting, savedPostingFile } from '@factwright/core';
import { startServer, type TestServer } from '@factwright/server/testing';
import {
  type AccountKeys,
  accountKeys,
  decodeRecord,
  fileName,
  fromUtf8,
  newAccountKey,
  openFile,
  openRecord,
  recordId,
  rowName,
  type SyncClient,
  type SyncRecord,
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
  const change = changes.find((each) => each.record === id);
  if (!change) return null;
  const plain = await openRecord(keys, id, change.version, change.data);
  return plain && decodeRecord(plain);
}

const save = (client: SyncClient, keys: AccountKeys, job: JobToSave = JOB, status = 'status-1') =>
  saveJob(client, keys, job, { device: DEVICE, now: () => NOW, uuid: () => status });

describe('saving a job through sync', () => {
  it('adds it as New, with its history and the posting as the person saw it', async () => {
    const { client, keys } = await account();
    expect(await save(client, keys)).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments',
      already: false,
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
    expect(result).toMatchObject({ ok: true });
    const path = savedPostingFile('northwind--staff-engineer-payments');
    expect(await readRecord(client, keys, fileName(path))).toBeNull();
  });

  it('saves a job once: the same link again finds it there', async () => {
    const { client, keys } = await account();
    await save(client, keys);
    expect(await save(client, keys, JOB, 'status-2')).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments',
      already: true,
    });
    expect(await readRecord(client, keys, rowName('status_log', 'status-2'))).toBeNull();
  });

  it('gives another job with the same company and title the next ID', async () => {
    const { client, keys } = await account();
    await save(client, keys);
    const other = { ...JOB, url: 'https://northwind.example/careers/42' };
    expect(await save(client, keys, other, 'status-2')).toEqual({
      ok: true,
      id: 'northwind--staff-engineer-payments-2',
      already: false,
    });
  });

  it('says when the extension has been signed out', async () => {
    const { keys } = await account();
    const signedOut = server.clientFor('not-a-session');
    expect(await save(signedOut, keys)).toMatchObject({ ok: false, reason: 'signed-out' });
  });
});
