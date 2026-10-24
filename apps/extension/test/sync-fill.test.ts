// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AskedField,
  type FieldReply,
  type InboxAsk,
  NO_EQUAL_OPPORTUNITY,
  type SavedForm,
} from '@factwright/core';
import { startServer, type TestServer } from '@factwright/server/testing';
import {
  type AccountKeys,
  accountKeys,
  encodeRecord,
  newAccountKey,
  recordId,
  type SyncClient,
  sealRecord,
} from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrivateAnswers } from '../../desktop/src/main/about/private.ts';
import { AboutStore } from '../../desktop/src/main/about/store.ts';
import { answerAsk, type FillDeps } from '../../desktop/src/main/extension/fill.ts';
import { JobsService } from '../../desktop/src/main/jobs/service.ts';
import { Tracker } from '../../desktop/src/main/jobs/tracker.ts';
import { SyncEngine } from '../../desktop/src/main/sync/engine.ts';
import { SyncState } from '../../desktop/src/main/sync/state.ts';
import type { Account } from '../src/account.ts';
import { signInWatch } from '../src/fill-way.ts';
import { KEEP_FOR_MS, type SyncAnswer, SyncFill, type SyncFillDeps } from '../src/sync-fill.ts';
import { readSynced, syncedWorkspace } from '../src/synced.ts';

let server: TestServer;
const work = mkdtempSync(join(tmpdir(), 'fw-sync-fill-'));

beforeAll(async () => {
  server = await startServer();
}, 60_000);

afterAll(() => {
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

const NOW = new Date(2026, 9, 23, 18, 30);
const FORM_URL = 'https://jobs.lever.co/northwind/7a1c9e40-2b6d-4f1e-9c3a-5d8e0f2b4a71/apply';
const FOLDER = '2026-10-20-northwind-labs-senior-product-manager';
/** A job a job search turned up, which only the search's files say anything of. */
const SEARCHED = 'https://job-boards.greenhouse.io/harborandpine/jobs/5426468004';
/**
 * A made-up resume the engine printed, as the desktop app's tests use, with room after it, so it
 * uploads in a few parts.
 */
const PDF = Buffer.concat([
  readFileSync(
    createRequire(fileURLToPath(new URL('../../desktop/package.json', import.meta.url))).resolve(
      '@factwright/xray/fixtures/engineer.pdf',
    ),
  ),
  Buffer.alloc(800_000, '\n'),
]);

/** A field as an ask carries it, with only what a test sets. */
const asked = (question: string, more: Partial<AskedField> = {}): AskedField => ({
  question,
  hint: '',
  section: '',
  control: 'text',
  type: 'text',
  autocomplete: '',
  name: '',
  options: [],
  required: false,
  limit: null,
  ...more,
});

/** The application's fields, as the extension reads Lever's form. */
const FIELDS: AskedField[] = [
  asked('First name'),
  asked('Last name'),
  asked('Email', { type: 'email' }),
  asked('Phone', { type: 'tel' }),
  asked('Street address'),
  asked('City'),
  asked('Postal code'),
  asked('LinkedIn profile'),
  asked('Resume/CV', { control: 'file', type: 'file' }),
  asked('Cover letter', { control: 'file', type: 'file' }),
  asked('Gender', { control: 'choice', options: ['Female', 'Male', 'Decline to self identify'] }),
  asked('How did you hear about us?'),
  asked('Current company'),
  asked('School'),
  asked('Tell us about a time you disagreed with your manager.', { control: 'long' }),
  asked('Describe a product you shipped.', { control: 'long' }),
  asked('Why Northwind Labs?', { control: 'long' }),
];

const FILL: Extract<InboxAsk, { ask: 'fill' }> = {
  ask: 'fill',
  url: FORM_URL,
  title: 'Northwind Labs - Senior Product Manager, Data',
  company: 'Northwind Labs',
  role: 'Senior Product Manager, Data',
  fields: FIELDS,
};

/**
 * Factwright on a computer, with a made-up job hunt: Profile, its private answers, a work history,
 * the job's folder with its resume, cover letter and Claude's draft, and another job with what was
 * sent for it. It syncs to the account with the app's own sync.
 */
async function computer() {
  const home = mkdtempSync(join(work, 'home-'));
  const workspace = join(home, 'workspace');
  const write = (path: string, contents: string | Buffer) => {
    const file = join(workspace, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  };
  write(
    'about-me/answers.json',
    JSON.stringify({
      you: {
        name: 'Ana María Ruiz',
        email: 'ana@example.com',
        phone: '(303) 555-0142',
        location: 'Denver, CO',
        linkedin: 'https://www.linkedin.com/in/anaruiz',
        website: '',
      },
      applications: { country: 'United States', countries: ['United States'] },
    }),
  );
  write(
    'about-me/history.json',
    JSON.stringify({
      jobs: [],
      schools: [
        {
          school: 'University of Colorado',
          degree: 'B.S.',
          field: 'Economics',
          start: '',
          end: '2014',
        },
      ],
    }),
  );
  write(
    `applications/${FOLDER}/job.md`,
    [
      '# Northwind Labs: Senior Product Manager, Data',
      '',
      '- **Date:** 2026-10-20',
      `- **Apply:** Lever ${FORM_URL.replace(/\/apply$/, '')}`,
      '- **Work arrangement:** Denver, CO',
    ].join('\n'),
  );
  write(
    `applications/${FOLDER}/resume.json`,
    JSON.stringify({
      name: 'Ana María Ruiz',
      headline: 'Product manager',
      summary: 'Ships data products.',
      experience: [
        {
          title: 'Senior Product Manager',
          company: 'Tidewater Analytics',
          start: '2021',
          end: 'Present',
        },
      ],
    }),
  );
  write(`applications/${FOLDER}/AnaRuizResume10202026_Northwind.pdf`, PDF);
  write(`applications/${FOLDER}/AnaRuizCoverLetter10202026_Northwind.pdf`, PDF.subarray(0, 5000));
  write(
    `applications/${FOLDER}/cover-letter.json`,
    JSON.stringify({ greeting: 'Dear Northwind Labs,', paragraphs: ['I ship data products.'] }),
  );
  write(
    `applications/${FOLDER}/answers.md`,
    [
      '# Application questions: Northwind Labs, Senior Product Manager, Data',
      '',
      '## Describe a product you shipped.',
      '',
      'Tidewater’s forecasting product, from first sketch to 40 customers.',
      '',
    ].join('\n'),
  );
  write(
    'searches/2026-10-21-greenhouse/jobs.json',
    JSON.stringify({
      meta: { checked: '2026-10-21', source: 'Greenhouse' },
      jobs: [
        {
          company: 'Harbor & Pine',
          role: 'Account Executive',
          posting: SEARCHED,
          remote: 'Remote, US',
          tier: 'good',
          score: 74,
        },
      ],
    }),
  );
  const tracker = new Tracker(join(home, 'tracker.db'));
  const jobs = new JobsService({ workspace, tracker, onChange: () => {}, now: () => NOW });
  jobs.read();
  const at = { today: '2026-10-12', now: '2026-10-12T15:00:00.000Z' };
  const other = tracker.addJob(
    { company: 'Fernway', role: 'Product Manager', status: 'applied' },
    at,
  );
  if (!other.ok) throw new Error(other.message);
  tracker.recordAnswers(
    other.jobId,
    [
      {
        question: 'Tell us about a time you disagreed with your manager.',
        nth: 0,
        text: 'I wrote down both plans, and we tested the cheaper one first.',
      },
    ],
    at,
  );
  jobs.read();
  const about = new AboutStore({ workspace, starterDir: join(home, 'starter') });
  const kept = new PrivateAnswers(join(home, 'private-answers.json'));
  kept.save({
    street: '1420 Larimer St',
    postalCode: '80202',
    equalOpportunity: { ...NO_EQUAL_OPPORTUNITY, gender: 'woman' },
  });
  const deps: FillDeps = {
    jobs,
    about,
    kept,
    workspace,
    drafts: { start: async () => 'started', state: () => ({ drafting: false, waiting: false }) },
    now: () => NOW,
  };
  return { workspace, tracker, jobs, deps, about };
}

/** An account, its keys, and a computer that syncs to it. */
async function account() {
  const sam = await server.signUp();
  const keys = await accountKeys(newAccountKey());
  const desktop = await computer();
  const session = await server.newSession(sam.id);
  const engine = new SyncEngine({
    client: session.client,
    keys,
    state: new SyncState(join(dirname(desktop.workspace), 'sync.db')),
    tracker: desktop.tracker,
    workspace: desktop.workspace,
    device: 'Sam’s Mac',
    now: () => NOW,
  });
  await engine.syncOnce();
  const browser = await server.newSession(sam.id, 'Mozilla/5.0 Chrome', 'device');
  return { sam, keys, desktop, engine, client: browser.client as SyncClient };
}

const fillFor = (client: SyncClient, keys: AccountKeys, more: Partial<SyncFillDeps> = {}) =>
  new SyncFill({
    client,
    keys,
    device: 'Factwright in Chrome',
    server: 'Factwright’s sync',
    now: () => NOW,
    uuid: () => crypto.randomUUID(),
    ...more,
  });

function ok(answer: SyncAnswer): Extract<SyncAnswer, { ok: true }> {
  if (!answer.ok) throw new Error(`Not answered: ${answer.message}`);
  return answer;
}

const byKind = (replies: readonly FieldReply[]) =>
  Object.fromEntries(FIELDS.map((field, at) => [field.question, replies[at]]));

describe('filling a form from your job hunt through sync', () => {
  it('answers each field as Factwright on your computer does, but what never syncs', async () => {
    const { desktop, keys, client } = await account();
    const app = await answerAsk(FILL, desktop.deps);
    const synced = ok(await fillFor(client, keys).ask(FILL));
    if (!app.ok || app.did !== 'fill' || synced.did !== 'fill') throw new Error('No plan.');
    expect(synced.job).toEqual(app.job);
    expect(synced.job).toMatchObject({ company: 'Northwind Labs', status: 'new' });
    const apps = byKind(app.replies);
    const ours = byKind(synced.replies);
    // The street, postal code and equal-opportunity answers stay on the computer.
    expect(apps['Street address']).toMatchObject({ text: '1420 Larimer St', source: 'profile' });
    expect(ours['Street address']).toEqual({ kind: 'street', source: 'you', left: 'private' });
    expect(apps['Postal code']).toMatchObject({ text: '80202', source: 'profile' });
    expect(ours['Postal code']).toEqual({ kind: 'postal-code', source: 'you', left: 'private' });
    expect(apps.Gender).toMatchObject({ kind: 'gender', source: 'profile' });
    expect(ours.Gender).toEqual({ kind: 'gender', source: 'you', left: 'sensitive' });
    const same = (replies: Record<string, FieldReply | undefined>) =>
      Object.fromEntries(
        Object.entries(replies).filter(
          ([question]) => !['Street address', 'Postal code', 'Gender'].includes(question),
        ),
      );
    expect(same(ours)).toEqual(same(apps));
    // What each answer is, so the comparison means something.
    expect(ours['First name']).toMatchObject({ text: 'Ana María', source: 'profile' });
    expect(ours['Resume/CV']).toMatchObject({
      file: 'resume',
      from: 'Ana María Ruiz - Resume.pdf',
    });
    expect(ours['Cover letter']).toMatchObject({ file: 'cover-letter' });
    expect(ours['Current company']).toMatchObject({
      text: 'Tidewater Analytics',
      source: 'resume',
    });
    expect(ours.School).toMatchObject({ text: 'University of Colorado', source: 'profile' });
    expect(ours['How did you hear about us?']).toMatchObject({ source: 'job' });
    expect(ours['Tell us about a time you disagreed with your manager.']).toMatchObject({
      text: 'I wrote down both plans, and we tested the cheaper one first.',
      source: 'sent',
    });
    expect(ours['Describe a product you shipped.']).toMatchObject({ source: 'claude' });
    expect(ours['Why Northwind Labs?']).toMatchObject({ source: 'you', left: 'new' });
    // The same files, offered by a version of their own.
    const offered = (files: typeof synced.files) =>
      Object.fromEntries(
        Object.entries(files).map(([kind, file]) => [
          kind,
          file && { name: file.name, size: file.size, parts: file.parts },
        ]),
      );
    expect(offered(synced.files)).toEqual(offered(app.files));
    expect(synced.files.resume?.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it('uploads the job’s resume as sync holds it, a part at a time, as offered', async () => {
    const { keys, client } = await account();
    const fill = fillFor(client, keys);
    const plan = ok(await fill.ask(FILL));
    if (plan.did !== 'fill' || !plan.job || !plan.files.resume) throw new Error('No resume.');
    const { version, parts } = plan.files.resume;
    expect(parts).toBeGreaterThan(1);
    let base64 = '';
    for (let part = 0; part < parts; part++) {
      const answer = ok(
        await fill.ask({ ask: 'file', job: plan.job.id, file: 'resume', version, part }),
      );
      if (answer.did !== 'file') throw new Error('No part.');
      expect(answer).toMatchObject({ part, parts });
      base64 += answer.base64;
    }
    expect(Buffer.from(base64, 'base64').equals(PDF)).toBe(true);
    // Another file, or one that's changed since, is never uploaded in its place.
    expect(
      await fill.ask({
        ask: 'file',
        job: plan.job.id,
        file: 'resume',
        version: '0123456789abcdef',
        part: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('leaves the form’s new questions with the job, where the app has them', async () => {
    const { keys, client, desktop, engine } = await account();
    const fill = fillFor(client, keys);
    const plan = ok(await fill.ask(FILL));
    if (plan.did !== 'fill' || !plan.job) throw new Error('No job.');
    const why = FIELDS[16] as AskedField;
    const travel = asked('Are you open to travel?', {
      control: 'choice',
      options: ['Yes', 'No'],
      required: true,
    });
    const left = await fill.ask({
      ask: 'draft',
      job: plan.job.id,
      url: FORM_URL,
      questions: [why, travel],
    });
    expect(left).toEqual({ ok: true, did: 'draft' });
    // Leaving them again changes nothing.
    expect(
      await fill.ask({ ask: 'draft', job: plan.job.id, url: FORM_URL, questions: [why, travel] }),
    ).toEqual({ ok: true, did: 'draft' });
    await engine.syncOnce();
    desktop.jobs.read();
    const form = desktop.jobs.savedForm(plan.job.id) as SavedForm;
    expect(form).toMatchObject({ url: FORM_URL, from: 'browser', read: NOW.toISOString() });
    expect(form.questions).toEqual([
      {
        question: 'Why Northwind Labs?',
        hint: '',
        section: '',
        control: 'long',
        options: [],
        required: false,
        limit: null,
      },
      {
        question: 'Are you open to travel?',
        hint: '',
        section: '',
        control: 'choice',
        options: ['Yes', 'No'],
        required: true,
        limit: null,
      },
    ]);
    expect(desktop.jobs.job(plan.job.id)?.questions).toEqual([
      'Why Northwind Labs?',
      'Are you open to travel?',
    ]);
  });

  it('marks the job applied with what you sent, as the app records it', async () => {
    const { keys, client, desktop, engine } = await account();
    const fill = fillFor(client, keys);
    const plan = ok(await fill.ask(FILL));
    if (plan.did !== 'fill' || !plan.job) throw new Error('No job.');
    const sent = ok(
      await fill.ask({
        ask: 'sent',
        job: plan.job.id,
        url: FORM_URL,
        answers: [
          { question: 'Why Northwind Labs?', text: '  Data products, at scale.  ' },
          // Never kept as sent: what Profile answers.
          { question: 'Email', text: 'ana@example.com' },
        ],
      }),
    );
    expect(sent).toEqual({
      ok: true,
      did: 'sent',
      recorded: 1,
      job: { ...plan.job, status: 'applied', appliedOn: '2026-10-23' },
    });
    await engine.syncOnce();
    desktop.jobs.read();
    const job = desktop.jobs.job(plan.job.id);
    expect(job).toMatchObject({
      status: 'applied',
      statusOn: '2026-10-23',
      appliedOn: '2026-10-23',
    });
    expect(job?.sent).toEqual([
      {
        question: 'Why Northwind Labs?',
        nth: 0,
        text: 'Data products, at scale.',
        on: '2026-10-23',
        at: NOW.toISOString(),
      },
    ]);
    expect(
      desktop.tracker
        .history()
        .get(plan.job.id)
        ?.map((each) => each.status),
    ).toEqual(['applied']);
  });

  it('keeps what another device changed meanwhile, making its change again on top', async () => {
    const { keys, client, desktop, engine } = await account();
    const fill = fillFor(client, keys);
    const plan = ok(await fill.ask(FILL));
    if (plan.did !== 'fill' || !plan.job) throw new Error('No job.');
    const id = plan.job.id;
    // The app changes the job after the browser read it.
    desktop.tracker.updateJob(
      id,
      { nextAction: 'Follow up with Priya' },
      { today: '2026-10-23', now: '2026-10-23T18:00:00.000Z' },
    );
    await engine.syncOnce();
    ok(
      await fill.ask({
        ask: 'sent',
        job: id,
        url: FORM_URL,
        answers: [{ question: 'Why Northwind Labs?', text: 'Data products.' }],
      }),
    );
    await engine.syncOnce();
    desktop.jobs.read();
    expect(desktop.jobs.job(id)).toMatchObject({
      status: 'applied',
      nextAction: 'Follow up with Priya',
    });
  });

  it('opens only records made for their own names', async () => {
    const { keys, client } = await account();
    // A record whose name makes another record's ID, as a server swapping records would make.
    const record = await recordId(keys, 'file:about-me/other.json');
    const body = {
      kind: 'file' as const,
      path: 'about-me/answers.json',
      file: { id: 'A'.repeat(43), size: 2, modified: NOW.toISOString() },
      device: 'Somewhere',
      at: NOW.toISOString(),
    };
    await client.push([
      {
        record,
        base: 0,
        data: await sealRecord(keys, record, 1, encodeRecord(body)),
        file: null,
        deleted: false,
      },
    ]);
    const synced = await readSynced(client, keys);
    expect(synced.files.get('about-me/answers.json')?.id).not.toBe('A'.repeat(43));
    expect(synced.files.has('about-me/other.json')).toBe(false);
    expect(synced.rows.jobs.size).toBe(3);
  });

  it('reads only what changed since the last fill, and all of it again a few minutes after', async () => {
    const { keys, client, desktop, engine } = await account();
    const files = vi.spyOn(client, 'getFile');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const fill = fillFor(client, keys);
      ok(await fill.ask(FILL));
      const first = files.mock.calls.length;
      expect(first).toBeGreaterThan(3);
      ok(await fill.ask(FILL));
      expect(files.mock.calls.length).toBe(first);
      // Your Claude drafts another answer in Factwright, which syncs.
      writeFileSync(
        join(desktop.workspace, 'applications', FOLDER, 'answers.md'),
        [
          '# Application questions: Northwind Labs, Senior Product Manager, Data',
          '',
          '## Why Northwind Labs?',
          '',
          'Its data products reach the people I build for.',
          '',
        ].join('\n'),
      );
      await engine.syncOnce();
      const again = ok(await fill.ask(FILL));
      expect(files.mock.calls.length).toBe(first + 1);
      if (again.did !== 'fill') throw new Error('No plan.');
      expect(byKind(again.replies)['Why Northwind Labs?']).toMatchObject({ source: 'claude' });
      vi.advanceTimersByTime(KEEP_FOR_MS);
      ok(await fill.ask(FILL));
      expect(files.mock.calls.length).toBeGreaterThanOrEqual(2 * first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('finds a job only a job search turned up, by its row, as the app finds it', async () => {
    const { desktop, keys, client } = await account();
    const ask = {
      ...FILL,
      url: SEARCHED,
      company: 'Harbor & Pine',
      role: 'Account Executive',
      fields: [asked('Email', { type: 'email' })],
    };
    const app = await answerAsk(ask, desktop.deps);
    const synced = ok(await fillFor(client, keys).ask(ask));
    if (!app.ok || app.did !== 'fill' || synced.did !== 'fill') throw new Error('No plan.');
    expect(app.job).toMatchObject({ company: 'Harbor & Pine', role: 'Account Executive' });
    expect(synced.job).toEqual(app.job);
  });

  it('records what you sent on the job kept, for one merged into another meanwhile', async () => {
    const { keys, client, desktop, engine } = await account();
    const fill = fillFor(client, keys);
    const plan = ok(await fill.ask(FILL));
    if (plan.did !== 'fill' || !plan.job) throw new Error('No job.');
    const at = { today: '2026-10-23', now: '2026-10-23T18:00:00.000Z' };
    const kept = desktop.tracker.addJob({ company: 'Northwind Labs', role: 'Data PM' }, at);
    if (!kept.ok) throw new Error(kept.message);
    desktop.tracker.mergeJobs(kept.jobId, plan.job.id, at);
    await engine.syncOnce();
    const sent = ok(
      await fill.ask({
        ask: 'sent',
        job: plan.job.id,
        url: FORM_URL,
        answers: [{ question: 'Why Northwind Labs?', text: 'Data products.' }],
      }),
    );
    expect(sent).toMatchObject({ did: 'sent', job: { id: kept.jobId, status: 'applied' } });
    await engine.syncOnce();
    desktop.jobs.read();
    expect(desktop.jobs.job(kept.jobId)?.sent.map((each) => each.text)).toEqual(['Data products.']);
  });

  it('leaves nothing for a job deleted since the form was read', async () => {
    const { keys, client, sam } = await account();
    const fill = fillFor(client, keys);
    const plan = ok(await fill.ask(FILL));
    if (plan.did !== 'fill' || !plan.job) throw new Error('No job.');
    const record = await recordId(keys, `row:jobs:${plan.job.id}`);
    const [latest] = await sam.client.versions(record);
    const body = {
      kind: 'row' as const,
      table: 'jobs',
      id: plan.job.id,
      row: null,
      device: 'Sam’s Mac',
      at: NOW.toISOString(),
    };
    const version = (latest?.version ?? 0) + 1;
    await sam.client.push([
      {
        record,
        base: latest?.version ?? 0,
        data: await sealRecord(keys, record, version, encodeRecord(body)),
        file: null,
        deleted: true,
      },
    ]);
    expect(
      await fill.ask({
        ask: 'draft',
        job: plan.job.id,
        url: FORM_URL,
        questions: [FIELDS[16] as AskedField],
      }),
    ).toMatchObject({ ok: false, reason: 'not-found' });
    const synced = await readSynced(client, keys);
    expect([...synced.files.keys()].some((path) => path.startsWith('saved/'))).toBe(false);
  });

  it('puts a change back as new on a server restored from a backup, which has no version', async () => {
    const { keys, client } = await account();
    const fill = fillFor(client, keys);
    const plan = ok(await fill.ask(FILL));
    if (plan.did !== 'fill' || !plan.job) throw new Error('No job.');
    const push = vi.spyOn(client, 'push');
    push
      .mockImplementationOnce(async (changes) => ({
        results: [
          { record: changes[0]?.record ?? '', ok: false, reason: 'conflict', current: null },
        ],
      }))
      .mockImplementationOnce(async (changes) => ({
        results: changes.map((change) => ({
          record: change.record,
          ok: true as const,
          version: change.base + 1,
          seq: 1,
        })),
      }));
    ok(
      await fill.ask({
        ask: 'sent',
        job: plan.job.id,
        url: FORM_URL,
        answers: [{ question: 'Why Northwind Labs?', text: 'Data products.' }],
      }),
    );
    expect(push.mock.calls[1]?.[0][0]?.base).toBe(0);
  });

  it('forgets what it read, and answers nothing more, once the extension is signed out', async () => {
    const { keys, client } = await account();
    let signedIn = true;
    const changes = vi.spyOn(client, 'changes');
    const fill = fillFor(client, keys, { signedIn: async () => signedIn });
    ok(await fill.ask(FILL));
    signedIn = false;
    expect(await fill.ask(FILL)).toMatchObject({ ok: false, reason: 'failed' });
    signedIn = true;
    ok(await fill.ask(FILL));
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('says it was signed out, and forgets the sign-in', async () => {
    const keys = await accountKeys(newAccountKey());
    const signedOut = vi.fn(async () => {});
    const fill = fillFor(server.clientFor('not-a-session'), keys, { signedOut });
    expect(await fill.ask(FILL)).toMatchObject({ ok: false, reason: 'failed' });
    expect(signedOut).toHaveBeenCalled();
  });
});

describe('the sign-in a fill goes on with', () => {
  const account = (token: string, id = 'key-1', server = 'https://sync.example') =>
    ({
      server,
      user: 'u1',
      email: 'sam@example.com',
      token,
      keys: { id } as AccountKeys,
    }) as Account & { keys: AccountKeys };

  it('follows a new sign-in to the same account, and stops at another', async () => {
    let now: Account | null = account('second');
    const watch = signInWatch(account('first'), async () => now);
    expect(watch.token()).toBe('first');
    expect(await watch.signedIn()).toBe(true);
    expect(watch.token()).toBe('second');
    now = account('third', 'key-2');
    expect(await watch.signedIn()).toBe(false);
    now = account('third', 'key-1', 'https://other.example');
    expect(await watch.signedIn()).toBe(false);
    now = null;
    expect(await watch.signedIn()).toBe(false);
  });

  it('forgets the sign-in the server turned down, never a newer one', async () => {
    const forget = vi.fn(async () => {});
    let now: Account | null = account('first');
    const watch = signInWatch(account('first'), async () => now, forget);
    now = account('second');
    await watch.signedOut();
    expect(forget).not.toHaveBeenCalled();
    now = account('first');
    await watch.signedOut();
    expect(forget).toHaveBeenCalledTimes(1);
  });
});

describe('the workspace as sync holds it', () => {
  it('lists each folder’s files and folders, and reads only the texts it was given', () => {
    const file = (size: number) => ({ id: 'x', size, modified: '2026-10-20T10:00:00.000Z' });
    const workspace = syncedWorkspace(
      new Map([
        ['applications/a/job.md', file(10)],
        ['applications/a/resume.pdf', file(20)],
        ['applications/b/job.md', file(30)],
        ['about-me/answers.json', file(40)],
      ]),
      new Map([['applications/a/job.md', '# A']]),
    );
    expect(workspace.list('applications').map((each) => [each.name, each.folder])).toEqual([
      ['a', true],
      ['b', true],
    ]);
    expect(workspace.list('applications/a')).toEqual([
      { name: 'job.md', folder: false, size: 10, modified: '2026-10-20T10:00:00.000Z' },
      { name: 'resume.pdf', folder: false, size: 20, modified: '2026-10-20T10:00:00.000Z' },
    ]);
    expect(workspace.list('searches')).toEqual([]);
    expect(workspace.readText('applications/a/job.md')).toBe('# A');
    expect(workspace.readText('applications/b/job.md')).toBeNull();
  });
});
