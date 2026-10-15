// @vitest-environment node
import { type Account, startServer, type TestServer } from '@factwright/server/testing';
import {
  type AccountKeys,
  accountKeys,
  type Bytes,
  encodeRecord,
  fromUtf8,
  nameOf,
  newAccountKey,
  type PushChange,
  recordId,
  SyncClient,
  type SyncRecord,
  sameBytes,
  sealFile,
  sealRecord,
  utf8,
} from '@factwright/sync';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileContents, openVault } from './vault.ts';

const MADE = { device: 'Sam’s MacBook Pro', at: '2026-10-10T18:00:00.000Z' };
const ACME = 'applications/2026-10-07-acme-staff-engineer';
const ACME_ID = 'acme-robotics--staff-engineer-developer-tools';
const RESUME: Bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

/** Files the desktop app syncs from the workspace. */
const FILES: Record<string, string | Bytes> = {
  [`${ACME}/job.md`]: [
    '# Acme Robotics: Staff Engineer, Developer Tools',
    '',
    '- **Date:** 2026-10-07',
    '- **Apply:** Ashby https://jobs.ashbyhq.com/acme/7f3a',
    '- **Work arrangement:** Remote, US',
  ].join('\n'),
  [`${ACME}/posting.md`]: '# Staff Engineer, Developer Tools\n\nBuild the tools our engineers use.',
  [`${ACME}/resume.pdf`]: RESUME,
  'facts/experience.md': 'Ten years of developer tools.',
};

/** Rows from the desktop app's tracker. */
const ROWS: SyncRecord[] = [
  {
    kind: 'row',
    table: 'jobs',
    id: ACME_ID,
    row: {
      company: 'Acme Robotics',
      company_key: 'acme-robotics',
      role: 'Staff Engineer, Developer Tools',
      links: '[]',
      manual: 0,
      status: 'screen',
      status_on: '2026-10-09',
      applied_on: '2026-10-08',
      notes: 'Recruiter: Sam Lee',
      questions: '[]',
      archived: 0,
    },
    ...MADE,
  },
  {
    kind: 'row',
    table: 'status_log',
    id: 's2',
    row: { job_id: ACME_ID, status: 'screen', at: '2026-10-09' },
    ...MADE,
  },
  {
    kind: 'row',
    table: 'status_log',
    id: 's1',
    row: { job_id: ACME_ID, status: 'applied', at: '2026-10-08' },
    ...MADE,
  },
  {
    kind: 'row',
    table: 'calls',
    id: 'c1',
    row: { job_id: ACME_ID, kind: 'screen', on_date: '2026-10-14', state: 'scheduled' },
    ...MADE,
  },
  {
    kind: 'row',
    table: 'notes',
    id: 'n2',
    row: {
      job_id: ACME_ID,
      on_date: '2026-10-12',
      text: 'Screen went well',
      created_at: '2026-10-12T17:00:00.000Z',
    },
    ...MADE,
  },
  {
    kind: 'row',
    table: 'notes',
    id: 'n1',
    row: {
      job_id: ACME_ID,
      on_date: '2026-10-09',
      text: 'They want Go',
      created_at: '2026-10-09T17:00:00.000Z',
    },
    ...MADE,
  },
];

/** Locks records and pushes them as new, the way the desktop app does. */
async function pushRecords(client: SyncClient, keys: AccountKeys, records: SyncRecord[]) {
  const changes: PushChange[] = [];
  for (const record of records) {
    const id = await recordId(keys, nameOf(record));
    changes.push({
      record: id,
      base: 0,
      data: await sealRecord(keys, id, 1, encodeRecord(record)),
      file: record.kind === 'file' ? (record.file?.id ?? null) : null,
      deleted: record.kind === 'file' ? record.file === null : record.row === null,
    });
  }
  const { results } = await client.push(changes);
  expect(results.every((result) => result.ok)).toBe(true);
}

/** Uploads each file's locked contents, then pushes its record. */
async function pushFiles(
  client: SyncClient,
  keys: AccountKeys,
  files: Record<string, string | Bytes>,
) {
  const records: SyncRecord[] = [];
  for (const [path, text] of Object.entries(files)) {
    const contents = typeof text === 'string' ? utf8(text) : text;
    const { id, data } = await sealFile(keys, contents);
    await client.putFile(id, data);
    records.push({
      kind: 'file',
      path,
      file: { id, size: contents.length, modified: MADE.at },
      ...MADE,
    });
  }
  await pushRecords(client, keys, records);
}

let server: TestServer;
let sam: Account;
let keys: AccountKeys;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  sam = await server.signUp();
  keys = await accountKeys(newAccountKey());
});

describe('opening the job hunt in the browser', () => {
  it('rebuilds the job list the desktop app synced, from its files and tracker', async () => {
    await pushFiles(sam.client, keys, FILES);
    await pushRecords(sam.client, keys, ROWS);

    const vault = await openVault(sam.client, keys);
    expect(vault.unreadable).toBe(0);
    expect(vault.jobs).toHaveLength(1);
    expect(vault.jobs[0]).toMatchObject({
      id: ACME_ID,
      company: 'Acme Robotics',
      role: 'Staff Engineer, Developer Tools',
      location: 'Remote, US',
      link: 'https://jobs.ashbyhq.com/acme/7f3a',
      status: 'screen',
      earlierNotes: 'Recruiter: Sam Lee',
      // Oldest first, however they arrived.
      notes: [
        { id: 'n1', text: 'They want Go' },
        { id: 'n2', text: 'Screen went well' },
      ],
      calls: [{ id: 'c1', kind: 'screen', onDate: '2026-10-14', state: 'scheduled' }],
      // Oldest first, however they arrived.
      statusLog: [
        { id: 's1', status: 'applied' },
        { id: 's2', status: 'screen' },
      ],
      files: [
        { path: `${ACME}/resume.pdf`, name: 'resume.pdf', format: 'pdf', size: RESUME.length },
      ],
    });
    expect(vault.docs.get(ACME_ID)?.posting).toContain('Build the tools our engineers use.');
    expect([...vault.files.keys()].sort()).toEqual(Object.keys(FILES).sort());
    expect(vault.rows.jobs).toHaveLength(1);
    expect(vault.rows.status_log).toHaveLength(2);
    expect(vault.rows.calls).toHaveLength(1);
    expect(vault.rows.notes).toHaveLength(2);
  });

  it('names each job’s page by a code its company and role can’t be read from', async () => {
    await pushFiles(sam.client, keys, FILES);
    await pushRecords(sam.client, keys, ROWS);
    const page = (await openVault(sam.client, keys)).pages.get(ACME_ID) ?? '';
    expect(page).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(page.toLowerCase()).not.toContain('acme');
    // The same code each time it opens, so a page can be reloaded, and another account's differs.
    expect((await openVault(sam.client, keys)).pages.get(ACME_ID)).toBe(page);
    const other = await accountKeys(newAccountKey());
    const bob = await server.signUp();
    await pushFiles(bob.client, other, FILES);
    await pushRecords(bob.client, other, ROWS);
    expect((await openVault(bob.client, other)).pages.get(ACME_ID)).not.toBe(page);
  });

  it('downloads only the files the job list is read from, and the rest when asked', async () => {
    await pushFiles(sam.client, keys, FILES);
    const downloaded: string[] = [];
    const client = new SyncClient({
      server: server.url.toString(),
      token: () => sam.token,
      fetch: (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.startsWith('/api/sync/files/')) downloaded.push(path);
        return fetch(input, init);
      },
    });

    const vault = await openVault(client, keys);
    expect(downloaded).toHaveLength(2);

    const resume = vault.files.get(`${ACME}/resume.pdf`);
    expect(resume).toBeDefined();
    const contents = await fileContents(client, keys, resume?.id ?? '');
    expect(contents && sameBytes(contents, RESUME)).toBe(true);
    expect(downloaded).toHaveLength(3);
  });

  it('reads a job’s cover letter, and keeps its files apart from the resume', async () => {
    const letter = JSON.stringify({ greeting: 'Dear Sam,', paragraphs: ['Hello.'] });
    await pushFiles(sam.client, keys, {
      ...FILES,
      [`${ACME}/cover-letter.json`]: letter,
      [`${ACME}/resume.json`]: '{"name": "Alex Rivera"}',
      [`${ACME}/AlexRiveraCoverLetter10142026_Acme.pdf`]: RESUME,
    });
    const downloaded: string[] = [];
    const client = new SyncClient({
      server: server.url.toString(),
      token: () => sam.token,
      fetch: (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.startsWith('/api/sync/files/')) downloaded.push(path);
        return fetch(input, init);
      },
    });
    const vault = await openVault(client, keys);
    expect(vault.docs.get(ACME_ID)?.letter).toBe(letter);
    expect(vault.jobs[0]?.docKinds).toContain('letter');
    expect(vault.jobs[0]?.letters.map((file) => file.name)).toEqual([
      'AlexRiveraCoverLetter10142026_Acme.pdf',
    ]);
    expect(vault.jobs[0]?.files.map((file) => file.name)).toEqual(['resume.pdf']);
    // The job's notes, its posting and its letter: never the resume's data or the files.
    expect(downloaded).toHaveLength(3);
  });

  it('reads the kinds of job the user wants, and what each job was found as', async () => {
    const downloaded: string[] = [];
    const client = new SyncClient({
      server: server.url.toString(),
      token: () => sam.token,
      fetch: (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.startsWith('/api/sync/files/')) downloaded.push(path);
        return fetch(input, init);
      },
    });
    const kinds = {
      first: { id: 'developer', name: 'Developer' },
      others: [{ id: 'project-manager', name: 'Project manager', roles: ['TPM'] }],
    };
    await pushFiles(sam.client, keys, {
      ...FILES,
      [`${ACME}/job.md`]: `${FILES[`${ACME}/job.md`]}\n- **Kind of job:** Project manager`,
      'about-me/kinds-of-job.json': JSON.stringify(kinds),
      'about-me/answers.json': JSON.stringify({ roles: ['Staff Engineer'] }),
    });
    const vault = await openVault(client, keys);
    expect(vault.kinds).toEqual([
      { id: 'developer', name: 'Developer' },
      { id: 'project-manager', name: 'Project manager' },
    ]);
    expect(vault.jobs[0]?.kindFound).toBe('Project manager');
    // The job's notes and posting, and the kinds file, but never the answers.
    expect(downloaded).toHaveLength(3);
  });

  it('names a first kind of job the kinds file leaves out, as the desktop app does', async () => {
    await pushFiles(sam.client, keys, {
      ...FILES,
      'about-me/kinds-of-job.json': JSON.stringify({
        others: [{ id: 'project-manager', name: 'Project manager' }],
      }),
    });
    expect((await openVault(sam.client, keys)).kinds).toEqual([
      { id: 'your-first-kind-of-job', name: 'Your first kind of job' },
      { id: 'project-manager', name: 'Project manager' },
    ]);
  });

  it('has no kinds of job with one, or with a kinds file that won’t read', async () => {
    await pushFiles(sam.client, keys, FILES);
    expect((await openVault(sam.client, keys)).kinds).toEqual([]);
    const bob = await server.signUp();
    await pushFiles(bob.client, keys, { ...FILES, 'about-me/kinds-of-job.json': '{ not json' });
    expect((await openVault(bob.client, keys)).kinds).toEqual([]);
  });

  it('reads Claude’s answers to the user’s questions about a job', async () => {
    const answer =
      '# What should I expect?\n\nAsked 2026-10-09. Answered 2026-10-09.\n\nA short screen.';
    await pushFiles(sam.client, keys, {
      ...FILES,
      [`asked/${ACME_ID}/2026-10-09-what-should-i-expect.md`]: answer,
    });
    const vault = await openVault(sam.client, keys);
    expect(vault.asked.get(ACME_ID)).toEqual({ '2026-10-09-what-should-i-expect': answer });
  });

  it('lists a job the files show before the tracker has it', async () => {
    await pushFiles(sam.client, keys, FILES);
    const vault = await openVault(sam.client, keys);
    expect(vault.jobs).toMatchObject([{ id: ACME_ID, company: 'Acme Robotics', status: null }]);
  });

  it('leaves out deleted files and rows', async () => {
    await pushFiles(sam.client, keys, FILES);
    const gone: SyncRecord[] = [
      { kind: 'file', path: 'facts/old.md', file: null, ...MADE },
      { kind: 'row', table: 'calls', id: 'c9', row: null, ...MADE },
    ];
    await pushRecords(sam.client, keys, gone);
    const vault = await openVault(sam.client, keys);
    expect(vault.files.has('facts/old.md')).toBe(false);
    expect(vault.rows.calls).toEqual([]);
    expect(vault.unreadable).toBe(0);
  });

  it('counts records it can’t open, and opens the rest', async () => {
    await pushFiles(sam.client, keys, FILES);
    // Locked with another account's key, as a device on the wrong account would.
    const stranger = await accountKeys(newAccountKey());
    const id = await recordId(keys, 'row:jobs:stranger');
    const data = await sealRecord(
      stranger,
      id,
      1,
      encodeRecord({ kind: 'row', table: 'jobs', id: 'stranger', row: { company: 'X' }, ...MADE }),
    );
    // And one moved under another record's ID.
    const moved = await recordId(keys, 'row:jobs:elsewhere');
    const movedData = await sealRecord(
      keys,
      moved,
      1,
      encodeRecord({ kind: 'row', table: 'jobs', id: 'other', row: { company: 'Y' }, ...MADE }),
    );
    const { results } = await sam.client.push([
      { record: id, base: 0, data, file: null, deleted: false },
      { record: moved, base: 0, data: movedData, file: null, deleted: false },
    ]);
    expect(results.every((result) => result.ok)).toBe(true);

    const vault = await openVault(sam.client, keys);
    expect(vault.unreadable).toBe(2);
    expect(vault.jobs.map((each) => each.company)).toEqual(['Acme Robotics']);
  });

  it('can’t open another account’s job hunt, even with its key', async () => {
    await pushFiles(sam.client, keys, FILES);
    const alex = await server.signUp('Alex Kim');
    const vault = await openVault(alex.client, keys);
    expect(vault.jobs).toEqual([]);
    expect(vault.files.size).toBe(0);
    const file = [...(await openVault(sam.client, keys)).files.values()][0];
    expect(await fileContents(alex.client, keys, file?.id ?? '')).toBeNull();
  });

  it('reads text the way it was written', async () => {
    const text = 'Café notes: “quotes”, — dashes, and 日本語.';
    await pushFiles(sam.client, keys, { 'searches/notes.md': text });
    const vault = await openVault(sam.client, keys);
    const file = vault.files.get('searches/notes.md');
    const contents = await fileContents(sam.client, keys, file?.id ?? '');
    expect(contents && fromUtf8(contents)).toBe(text);
  });
});
