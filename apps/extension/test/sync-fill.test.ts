// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AskedField,
  type FieldKind,
  type FieldReply,
  type InboxAsk,
  NO_CONTACT,
  NO_EQUAL_OPPORTUNITY,
  type SavedForm,
} from '@factwright/core';
import { startServer, type TestServer } from '@factwright/server/testing';
import {
  type AccountKeys,
  accountKeys,
  encodeRecord,
  newAccountKey,
  type RowValues,
  recordId,
  type SyncClient,
  sealRecord,
} from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrivateAnswers } from '../../desktop/src/main/about/private.ts';
import { AboutStore } from '../../desktop/src/main/about/store.ts';
import { answerAsk, type FillDeps } from '../../desktop/src/main/extension/fill.ts';
import { JobsService } from '../../desktop/src/main/jobs/service.ts';
import { trackerAsOf } from '../../desktop/src/main/jobs/testing.ts';
import { Tracker } from '../../desktop/src/main/jobs/tracker.ts';
import { SyncEngine } from '../../desktop/src/main/sync/engine.ts';
import { SyncState } from '../../desktop/src/main/sync/state.ts';
import type { Account } from '../src/account.ts';
import { signInWatch } from '../src/fill-way.ts';
import { KEEP_FOR_MS, type SyncAnswer, SyncFill, type SyncFillDeps } from '../src/sync-fill.ts';
import {
  kindFoundIn,
  nothingSynced,
  readJobNotes,
  readSynced,
  type Synced,
  syncedJobs,
  syncedWorkspace,
} from '../src/synced.ts';

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
/** The Northwind Labs job's ID, as the app gives it. */
const JOB = 'northwind-labs--senior-product-manager-data';
const FOLDER = '2026-10-20-northwind-labs-senior-product-manager';
/** Another job's folder, which a fill for Northwind Labs needn't read. */
const LUMEN = '2026-10-18-lumen-health-product-manager-payments';
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
 * sent for it. It syncs to the account with the app's own sync. `older` is an app from before a
 * job's row named its folder, as 0.15 is: its rows have no folder.
 */
async function computer({ older = false } = {}) {
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
  write(
    `applications/${LUMEN}/job.md`,
    [
      '# Lumen Health: Product Manager, Payments',
      '',
      '- **Date:** 2026-10-18',
      '- **Apply:** Ashby https://jobs.ashbyhq.com/lumen/4c1d2e3f',
      '- **Work arrangement:** Remote, US',
    ].join('\n'),
  );
  write(`applications/${LUMEN}/LumenResume.pdf`, PDF.subarray(0, 4000));
  const file = join(home, 'tracker.db');
  const tracker = new Tracker(file);
  if (older) {
    trackerAsOf(file, 8, { keepTables: true });
    vi.spyOn(tracker, 'saveFolders').mockImplementation(() => {});
  }
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
  return { workspace, tracker, jobs, deps, about, write };
}

/** An account, its keys, and a computer that syncs to it. */
async function account(app: Parameters<typeof computer>[0] = {}) {
  const sam = await server.signUp();
  const keys = await accountKeys(newAccountKey());
  const desktop = await computer(app);
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
      from: 'AnaRuizResume10202026_Northwind.pdf',
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

  it('says how many jobs and schools are on file, as the app does, for a form’s parts for each', async () => {
    const { desktop, keys, client } = await account();
    const app = await answerAsk(FILL, desktop.deps);
    const synced = ok(await fillFor(client, keys).ask(FILL));
    if (!app.ok || app.did !== 'fill' || synced.did !== 'fill') throw new Error('No plan.');
    // A school in the work history, and a job only the job's resume has, as Workday's My
    // Experience offers to add a part for each.
    expect(synced.blocks).toEqual({ jobs: 1, schools: 1 });
    expect(synced.blocks).toEqual(app.blocks);
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
      marked: true,
      undo: {
        line: expect.any(String),
        row: { status: null, status_on: null, applied_on: null },
      },
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

  it('takes marking it Applied back, as Undo asks, with its line in the job’s history', async () => {
    const { keys, client, desktop, engine } = await account();
    const fill = fillFor(client, keys);
    const plan = ok(await fill.ask(FILL));
    if (plan.did !== 'fill' || !plan.job) throw new Error('No job.');
    const id = plan.job.id;
    const sent = ok(
      await fill.ask({
        ask: 'sent',
        job: id,
        url: FORM_URL,
        answers: [{ question: 'Why Northwind Labs?', text: 'Data products.' }],
      }),
    );
    if (sent.did !== 'sent' || !sent.undo) throw new Error('Nothing to undo.');
    const undone = ok(await fill.ask({ ask: 'unsent', job: id, undo: sent.undo }));
    expect(undone).toEqual({
      ok: true,
      did: 'unsent',
      undone: true,
      job: { ...plan.job, status: 'new', appliedOn: null },
    });
    await engine.syncOnce();
    desktop.jobs.read();
    expect(desktop.jobs.job(id)).toMatchObject({ status: null, statusOn: null, appliedOn: null });
    expect(desktop.tracker.history().get(id) ?? []).toEqual([]);
    // What you sent stays with the job, and Undo again changes nothing.
    expect(desktop.jobs.job(id)?.sent.map((each) => each.text)).toEqual(['Data products.']);
    expect(await fill.ask({ ask: 'unsent', job: id, undo: sent.undo })).toMatchObject({
      undone: false,
    });
    // Without what to put back, it says where to change it.
    expect(await fill.ask({ ask: 'unsent', job: id })).toMatchObject({ ok: false });
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
    expect(synced.rows.jobs.size).toBe(4);
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

/** The job folders whose job.md a fill fetched, by their names. */
async function notesFetched(client: SyncClient, keys: AccountKeys, ids: readonly string[]) {
  const synced = await readSynced(client, keys);
  const paths = new Map([...synced.files].map(([path, file]) => [file.id, path]));
  return ids
    .flatMap((id) => paths.get(id)?.match(/^applications\/([^/]+)\/job\.md$/)?.[1] ?? [])
    .sort();
}

/** Every reply but those that never sync: the street, postal code and equal-opportunity ones. */
const synced = (replies: Record<string, FieldReply | undefined>) =>
  Object.fromEntries(
    Object.entries(replies).filter(
      ([question]) => !['Street address', 'Postal code', 'Gender'].includes(question),
    ),
  );

describe('what you did in a position, through sync', () => {
  const ASK = {
    ...FILL,
    fields: [
      asked('Description', { section: 'Work Experience 1', control: 'long' }),
      asked('Description', { section: 'Work Experience 2', control: 'long', limit: 40 }),
    ],
  };
  const COMPANY = 'Tidewater Analytics';
  /** A resume listing a position's words: the first, then the one before it. */
  const saying = (first: string[], second: string[] = []) =>
    JSON.stringify({
      name: 'Ana María Ruiz',
      headline: 'Product manager',
      summary: 'Ships data products.',
      experience: [
        ['Senior Product Manager', '2021', 'Present', first],
        ['Product Manager', '2018', '2021', second],
      ].map(([title, start, end, bullets]) => ({
        title,
        company: COMPANY,
        start,
        end,
        bullet_groups: [{ bullets: (bullets as string[]).map((text) => ({ text })) }],
      })),
    });
  /** What Profile's work history says of those two positions. */
  const HISTORY = JSON.stringify({
    jobs: [
      {
        company: COMPANY,
        location: 'Denver, CO',
        positions: [
          {
            title: 'Senior Product Manager',
            start: '2021',
            end: 'present',
            summary: 'From Profile.',
          },
          { title: 'Product Manager', start: '2018', end: '2021', summary: 'Ran a team of three.' },
        ],
      },
    ],
    schools: [],
  });
  /** The same answers from the app and through sync, with the same answers again asked again. */
  async function both(
    desktop: Awaited<ReturnType<typeof computer>>,
    keys: AccountKeys,
    client: SyncClient,
    form: typeof ASK = ASK,
  ) {
    desktop.jobs.read();
    const app = await answerAsk(form, desktop.deps);
    const synced = ok(await fillFor(client, keys).ask(form));
    if (!app.ok || app.did !== 'fill' || synced.did !== 'fill') throw new Error('No plan.');
    expect(synced.replies).toEqual(app.replies);
    return synced.replies;
  }
  const words = (reply: FieldReply | undefined) => [reply?.text, reply?.from];
  const KINDS = JSON.stringify({
    first: { id: 'pmo', name: 'PMO' },
    others: [{ id: 'strategy', name: 'Strategy' }],
  });

  it('gives what the app gives, at each step, by the job’s own resume and its kind of job', async () => {
    const { desktop, keys, client, engine } = await account();
    desktop.write('about-me/history.json', HISTORY);
    desktop.write('about-me/kinds-of-job.json', KINDS);
    desktop.write('base/big-company-leader.json', saying(['Ran the PMO.']));
    desktop.write(
      'base/big-company-leader (Sam’s Mac, Oct 12).json',
      saying(['Sync’s copy, first by its name.']),
    );
    desktop.write('base/strategy/startup-leader.json', saying(['Set the strategy.']));
    desktop.write('base/strategy/big-company-leader.json', saying(['Sized markets.']));
    await engine.syncOnce();

    // Nothing says its kind yet: Profile's, with each kind's words in the menu.
    let replies = await both(desktop, keys, client);
    expect(words(replies[0])).toEqual(['From Profile.', 'From your work history']);
    expect(replies[0]?.others?.map((each) => each.from)).toEqual([
      'From your PMO starting resume',
      'From your Strategy starting resume',
    ]);
    expect(words(replies[1])).toEqual(['Ran a team of three.', 'From your work history']);

    // Put under one, its row says so.
    const at = { today: '2026-10-23', now: '2026-10-23T18:00:00.000Z' };
    desktop.tracker.updateJob(JOB, { kind: 'strategy' }, at);
    await engine.syncOnce();
    replies = await both(desktop, keys, client);
    // Of a kind's starting resumes, the first by its file's name that says what you did there.
    expect(words(replies[0])).toEqual(['Sized markets.', 'From your Strategy starting resume']);
    expect(replies[0]?.others).toEqual([
      { text: 'From Profile.', source: 'profile', from: 'From your work history' },
    ]);

    // The job's own resume wins, a field's limit cuts it, and the kind's go in the menu.
    const long = 'Took the data team from three people to thirty in two years.';
    desktop.write(
      `applications/${FOLDER}/resume.json`,
      saying(['Led the data products.'], ['Ran the roadmap.', long, 'Cut cost 9%.']),
    );
    await engine.syncOnce();
    replies = await both(desktop, keys, client);
    expect(words(replies[0])).toEqual(['Led the data products.', 'From the job’s resume']);
    expect(words(replies[1])).toEqual([
      'Ran the roadmap.\nCut cost 9%.',
      'From the job’s resume, cut to fit 40 characters',
    ]);
  });

  describe('for a job its title fits one kind of job', () => {
    const AT = { today: '2026-10-23', now: '2026-10-23T18:00:00.000Z' };
    /** An account with each kind's titles and pay: the first's in answers.json, Strategy's apart. */
    async function holding(first: string[], strategy: string[], pay = ['', '']) {
      const held = await account();
      const { desktop } = held;
      const path = join(desktop.workspace, 'about-me', 'answers.json');
      const answers = JSON.parse(readFileSync(path, 'utf8'));
      desktop.write(
        'about-me/answers.json',
        JSON.stringify({ ...answers, roles: first, targetPay: pay[0] }),
      );
      desktop.write('about-me/history.json', HISTORY);
      desktop.write(
        'about-me/kinds-of-job.json',
        JSON.stringify({
          first: { id: 'pmo', name: 'PMO' },
          others: [{ id: 'strategy', name: 'Strategy', roles: strategy, targetPay: pay[1] }],
        }),
      );
      desktop.write('base/big-company-leader.json', saying(['Ran the PMO.']));
      desktop.write('base/strategy/big-company-leader.json', saying(['Set the strategy.']));
      return held;
    }
    /** The same answers from the app and through sync, for the Senior Product Manager, Data job. */
    async function titled(first: string[], strategy: string[]) {
      const { desktop, keys, client, engine } = await holding(first, strategy);
      await engine.syncOnce();
      return both(desktop, keys, client);
    }
    const froms = (reply: FieldReply | undefined) => reply?.others?.map((each) => each.from);
    const BY_TITLE = [
      'Set the strategy.',
      'From your Strategy starting resume, by the job’s title',
    ];
    const NEITHER = ['From Profile.', 'From your work history'];

    it('fills that kind’s, as the app does, whatever level the job’s title says', async () => {
      const replies = await titled(['Program Manager'], ['Product Manager', 'Strategist']);
      expect(words(replies[0])).toEqual(BY_TITLE);
      expect(froms(replies[0])).toEqual([
        'From your work history',
        'From your PMO starting resume',
      ]);
    });

    it('fills the first kind’s by its titles in Profile’s answers', async () => {
      const replies = await titled(['Product Manager'], ['Strategist']);
      expect(words(replies[0])).toEqual([
        'Ran the PMO.',
        'From your PMO starting resume, by the job’s title',
      ]);
      expect(froms(replies[0])).toEqual([
        'From your work history',
        'From your Strategy starting resume',
      ]);
    });

    it('fills neither where both fit, or none does, as the app does', async () => {
      const two = await titled(['Product Manager'], ['Product Manager, Data']);
      expect(words(two[0])).toEqual(NEITHER);
      expect(froms(two[0])).toEqual([
        'From your PMO starting resume',
        'From your Strategy starting resume',
      ]);
      const none = await titled(['Program Manager'], ['Strategist']);
      expect(words(none[0])).toEqual(NEITHER);
    });

    it('goes by the whole words of titles in other letters, as the app does', async () => {
      // Neither fits the job's title in Latin letters, or each other's.
      const latin = await titled(['プロジェクトマネージャー'], ['戦略コンサルタント']);
      expect(words(latin[0])).toEqual(NEITHER);
      const { desktop, keys, client, engine } = await holding(
        ['プロジェクトマネージャー'],
        ['戦略コンサルタント'],
      );
      const company = '株式会社メルカリ';
      const url = 'https://careers.example.com/apply/4567';
      desktop.tracker.addJob({ company, role: '戦略コンサルタント' }, AT);
      await engine.syncOnce();
      const form = { ...ASK, url, company, role: '戦略コンサルタント' };
      expect(words((await both(desktop, keys, client, form))[0])).toEqual(BY_TITLE);
      desktop.tracker.addJob({ company: 'ヤマト', role: '営業マネージャー' }, AT);
      await engine.syncOnce();
      const other = { ...ASK, url, company: 'ヤマト', role: '営業マネージャー' };
      expect(words((await both(desktop, keys, client, other))[0])).toEqual(NEITHER);
    });

    it('reads titles that don’t hold up as the app does', async () => {
      const replies = await titled(
        ['Product Manager', 7 as never],
        [` Product Manager `, '', 'product manager'],
      );
      // The first kind's list doesn't hold up, so only Strategy's fits.
      expect(words(replies[0])).toEqual(BY_TITLE);
    });

    it('gives way to the kind you put it under, or a job search found, as the app does', async () => {
      const OF_KIND = ['Set the strategy.', 'From your Strategy starting resume'];
      const put = await holding(['Product Manager'], ['Strategist']);
      put.desktop.tracker.updateJob(JOB, { kind: 'strategy' }, AT);
      await put.engine.syncOnce();
      expect(words((await both(put.desktop, put.keys, put.client))[0])).toEqual(OF_KIND);
      const found = await holding(['Product Manager'], ['Strategist']);
      found.desktop.write(
        'searches/2026-10-22-lever/jobs.json',
        JSON.stringify({
          meta: { checked: '2026-10-22', source: 'Lever' },
          jobs: [
            {
              company: 'Northwind Labs',
              role: 'Senior Product Manager, Data',
              posting: FORM_URL.replace(/\/apply$/, ''),
              kind: 'strategy',
            },
          ],
        }),
      );
      await found.engine.syncOnce();
      expect(words((await both(found.desktop, found.keys, found.client))[0])).toEqual(OF_KIND);
    });

    it('goes by the job’s row where its job.md names no title, as the app does', async () => {
      const { desktop, keys, client, engine } = await holding(['Product Manager'], ['Strategist']);
      const notes = join(desktop.workspace, 'applications', FOLDER, 'job.md');
      const text = readFileSync(notes, 'utf8');
      writeFileSync(notes, text.replace(': Senior Product Manager, Data', ''));
      await engine.syncOnce();
      expect(words((await both(desktop, keys, client))[0])).toEqual([
        'Ran the PMO.',
        'From your PMO starting resume, by the job’s title',
      ]);
    });

    it('goes by the title you gave the job, as the app does', async () => {
      const { desktop, keys, client, engine } = await holding(['Product Manager'], ['Strategist']);
      desktop.tracker.updateJob(JOB, { role: 'Lead Strategist, Data' }, AT);
      await engine.syncOnce();
      expect(words((await both(desktop, keys, client))[0])).toEqual(BY_TITLE);
    });

    describe('its pay box', () => {
      const FORM = {
        ...ASK,
        fields: [...ASK.fields, asked('What are your salary expectations?')],
      };
      const PAY = ['$150,000', '$210,000'];

      it('takes that kind’s target and says why, and the job’s kind stays, as the app does', async () => {
        const { desktop, keys, client, engine } = await holding(
          ['Program Manager'],
          ['Product Manager'],
          PAY,
        );
        await engine.syncOnce();
        const replies = await both(desktop, keys, client, FORM);
        expect(words(replies[0])).toEqual(BY_TITLE);
        expect(words(replies[2])).toEqual([
          '$210,000',
          'Your target for Strategy jobs, by the job’s title',
        ]);
        // Nothing was put under Strategy.
        expect(desktop.tracker.rows().find((row) => row.id === JOB)?.kind ?? null).toBeNull();
      });

      it('takes your first kind’s where both fit, or none does, as the app does', async () => {
        const first = ['$150,000', 'Your target for PMO jobs'];
        for (const titles of [
          [['Product Manager'], ['Product Manager, Data']],
          [['Program Manager'], ['Strategist']],
        ] as const) {
          const { desktop, keys, client, engine } = await holding(
            [...titles[0]],
            [...titles[1]],
            PAY,
          );
          await engine.syncOnce();
          expect(words((await both(desktop, keys, client, FORM))[2])).toEqual(first);
        }
      });

      it('gives way to the kind you put it under, as the app does', async () => {
        const { desktop, keys, client, engine } = await holding(
          ['Program Manager'],
          ['Product Manager'],
          PAY,
        );
        desktop.tracker.updateJob(JOB, { kind: 'pmo' }, AT);
        await engine.syncOnce();
        expect(words((await both(desktop, keys, client, FORM))[2])).toEqual([
          '$150,000',
          'Your target for PMO jobs',
        ]);
      });

      it('is left for you where that kind has no target, as the app does', async () => {
        const { desktop, keys, client, engine } = await holding(
          ['Program Manager'],
          ['Product Manager'],
          ['$150,000', ''],
        );
        await engine.syncOnce();
        const replies = await both(desktop, keys, client, FORM);
        expect(replies[2]).toMatchObject({ kind: 'pay', source: 'you', left: 'unset' });
      });
    });
  });

  it('gives what the app gives from an app before rows named folders', async () => {
    const { desktop, keys, client, engine } = await account({ older: true });
    desktop.write('about-me/history.json', HISTORY);
    desktop.write('about-me/kinds-of-job.json', KINDS);
    desktop.write('base/big-company-leader.json', saying(['Ran the PMO.']));
    desktop.write('base/strategy/big-company-leader.json', saying(['Set the strategy.']));
    const notes = join(desktop.workspace, 'applications', FOLDER, 'job.md');
    writeFileSync(notes, `${readFileSync(notes, 'utf8')}\n- **Kind of job:** strategy\n`);
    await engine.syncOnce();
    const replies = await both(desktop, keys, client);
    expect(words(replies[0])).toEqual(['Set the strategy.', 'From your Strategy starting resume']);
  });

  it('knows a job’s kind from the job search that found it, as the app does', async () => {
    const { desktop, keys, client, engine } = await account();
    desktop.write('about-me/history.json', HISTORY);
    desktop.write(
      'about-me/kinds-of-job.json',
      JSON.stringify({
        first: { id: 'pmo', name: 'PMO' },
        others: [{ id: 'strategy', name: 'Strategy', targetPay: '$210,000' }],
      }),
    );
    desktop.write('base/big-company-leader.json', saying(['Ran the PMO.']));
    desktop.write('base/strategy/big-company-leader.json', saying(['Set the strategy.']));
    desktop.write(
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
            kind: 'strategy',
          },
        ],
      }),
    );
    await engine.syncOnce();
    desktop.jobs.read();
    const form = {
      ...ASK,
      url: SEARCHED,
      company: 'Harbor & Pine',
      role: 'Account Executive',
      fields: [...ASK.fields, asked('What are your salary expectations?')],
    };
    const app = await answerAsk(form, desktop.deps);
    const synced = ok(await fillFor(client, keys).ask(form));
    if (!app.ok || app.did !== 'fill' || synced.did !== 'fill') throw new Error('No plan.');
    expect(synced.job?.company).toBe('Harbor & Pine');
    expect(synced.replies).toEqual(app.replies);
    expect(words(synced.replies[0])).toEqual([
      'Set the strategy.',
      'From your Strategy starting resume',
    ]);
    // Its pay box takes that kind's target too.
    expect(synced.replies[2]?.text).toBe('$210,000');
  });

  it('leaves out your newest resume’s words, as the app does', async () => {
    const { desktop, keys, client, engine } = await account();
    desktop.write('about-me/history.json', HISTORY);
    // The job has no resume of its own: another job's is your newest.
    rmSync(join(desktop.workspace, 'applications', FOLDER, 'resume.json'));
    desktop.write(`applications/${LUMEN}/resume.json`, saying(['Written for Lumen Health.']));
    await engine.syncOnce();
    const replies = await both(desktop, keys, client);
    expect(words(replies[0])).toEqual(['From Profile.', 'From your work history']);
    expect(replies[0]?.others).toBeUndefined();
    // Its company and title are what the form's other boxes would take, as before.
    const blank = await both(
      await (async () => {
        desktop.write('about-me/history.json', JSON.stringify({ jobs: [], schools: [] }));
        await engine.syncOnce();
        return desktop;
      })(),
      keys,
      client,
    );
    expect(blank[0]).toEqual({ kind: 'job-summary', source: 'you', left: 'unset' });
  });

  it('takes a kind its fit check named over a job search’s, even one you’ve since removed', async () => {
    const { desktop, keys, client, engine } = await account();
    desktop.write('about-me/history.json', HISTORY);
    desktop.write('about-me/kinds-of-job.json', KINDS);
    desktop.write('base/big-company-leader.json', saying(['Ran the PMO.']));
    desktop.write('base/strategy/big-company-leader.json', saying(['Set the strategy.']));
    const notes = join(desktop.workspace, 'applications', FOLDER, 'job.md');
    writeFileSync(notes, `${readFileSync(notes, 'utf8')}\n- **Kind of job:** removed-kind\n`);
    desktop.write(
      'searches/2026-10-22-lever/jobs.json',
      JSON.stringify({
        meta: { checked: '2026-10-22', source: 'Lever' },
        jobs: [
          {
            company: 'Northwind Labs',
            role: 'Senior Product Manager, Data',
            posting: FORM_URL.replace(/\/apply$/, ''),
            kind: 'strategy',
          },
        ],
      }),
    );
    await engine.syncOnce();
    const replies = await both(desktop, keys, client);
    // Its kind isn't known, in the app or through sync, so each kind's goes in the menu.
    expect(words(replies[0])).toEqual(['From Profile.', 'From your work history']);
    expect(replies[0]?.others?.map((each) => each.from)).toEqual([
      'From your PMO starting resume',
      'From your Strategy starting resume',
    ]);
  });
});

describe('the kind of job a job search found a job as', () => {
  const row = (id: string, company: string, more: Record<string, string> = {}) => ({
    id,
    company,
    company_key: company.toLowerCase(),
    role: 'Analyst',
    links: '[]',
    ...more,
  });
  /** What sync holds with these rows, and a job search that found the job at a company. */
  function holding(rows: ReturnType<typeof row>[], found: string) {
    const synced = nothingSynced();
    for (const each of rows) synced.rows.jobs.set(each.id, each);
    const path = 'searches/2026-10-21-greenhouse/jobs.json';
    synced.files.set(path, { id: 'file', size: 1, modified: '2026-10-21T00:00:00.000Z' });
    const search = {
      meta: { checked: '2026-10-21', source: 'Greenhouse' },
      jobs: [{ company: found, role: 'Analyst', tier: 'good', score: 74, kind: 'strategy' }],
    };
    return { synced, texts: new Map([[path, JSON.stringify(search)]]) };
  }

  it('by the job itself, and not by another at another company', () => {
    const { synced, texts } = holding(
      [row('acme--analyst', 'Acme'), row('beta--analyst', 'Beta')],
      'Beta',
    );
    expect(kindFoundIn(synced, { id: 'beta--analyst' }, texts)).toBe('strategy');
    expect(kindFoundIn(synced, { id: 'acme--analyst' }, texts)).toBeNull();
  });

  it('by a job merged into it, however far back', () => {
    const { synced, texts } = holding(
      [
        row('acme--analyst', 'Acme'),
        row('beta--analyst', 'Beta', { merged_into: 'acme--analyst' }),
        row('gamma--analyst', 'Gamma', { merged_into: 'beta--analyst' }),
      ],
      'Gamma',
    );
    expect(kindFoundIn(synced, { id: 'acme--analyst' }, texts)).toBe('strategy');
  });

  it('by what you call it', () => {
    const { synced, texts } = holding(
      [row('delta--analyst', 'Delta', { own_company: 'Epsilon' })],
      'Epsilon',
    );
    expect(kindFoundIn(synced, { id: 'delta--analyst' }, texts)).toBe('strategy');
  });
});

describe('the pay to ask for, and why you’re leaving, through sync', () => {
  const LEAVING = 'I want to build data products for more than one team.';
  const PAY_FIELDS = [
    asked('Why are you leaving your current role?', { control: 'long' }),
    asked('What are your salary expectations?'),
    asked('Desired salary', { control: 'number', type: 'number' }),
    asked('Salary range', {
      control: 'choice',
      options: ['$100,000 - $149,999', '$150,000 - $199,999', '$200,000 or more'],
    }),
  ];
  const ASK = { ...FILL, fields: PAY_FIELDS };
  /** What each field got, as source and words, from the app and through sync, which agree. */
  async function both(
    desktop: Awaited<ReturnType<typeof computer>>,
    keys: AccountKeys,
    client: SyncClient,
  ) {
    desktop.jobs.read();
    const app = await answerAsk(ASK, desktop.deps);
    const synced = ok(await fillFor(client, keys).ask(ASK));
    if (!app.ok || app.did !== 'fill' || synced.did !== 'fill') throw new Error('No plan.');
    expect(synced.replies).toEqual(app.replies);
    return synced.replies.map((reply) => [reply.source, reply.text ?? reply.pick?.[0]]);
  }
  /** Profile with why you're leaving, a target pay, and a second kind of job with its own. */
  function profile(desktop: Awaited<ReturnType<typeof computer>>) {
    const path = join(desktop.workspace, 'about-me', 'answers.json');
    const answers = JSON.parse(readFileSync(path, 'utf8'));
    desktop.write(
      'about-me/answers.json',
      JSON.stringify({
        ...answers,
        targetPay: '$170,000',
        applications: { ...answers.applications, leaving: LEAVING },
      }),
    );
    desktop.write(
      'about-me/kinds-of-job.json',
      JSON.stringify({
        first: { id: 'product', name: 'Product' },
        others: [{ id: 'data', name: 'Data', targetPay: '$210,000' }],
      }),
    );
  }

  it('fills your target for the job’s kind of job, then your Claude’s suggestion, then yours', async () => {
    const { desktop, keys, client, engine } = await account();
    profile(desktop);
    await engine.syncOnce();
    expect(await both(desktop, keys, client)).toEqual([
      ['profile', LEAVING],
      ['profile', '$170,000'],
      ['profile', '170000'],
      ['profile', '$150,000 - $199,999'],
    ]);
    // Put under the other kind of job, as its row says.
    const at = { today: '2026-10-23', now: '2026-10-23T18:00:00.000Z' };
    desktop.tracker.updateJob(JOB, { kind: 'data' }, at);
    await engine.syncOnce();
    expect((await both(desktop, keys, client)).slice(1)).toEqual([
      ['profile', '$210,000'],
      ['profile', '210000'],
      ['profile', '$200,000 or more'],
    ]);
    // Your Claude suggests one in the job's job.md, which only the job's own folder says.
    const notes = join(desktop.workspace, 'applications', FOLDER, 'job.md');
    writeFileSync(notes, `${readFileSync(notes, 'utf8')}\n- **Pay to ask for:** $185,000\n`);
    await engine.syncOnce();
    expect((await both(desktop, keys, client)).slice(1)).toEqual([
      ['claude', '$185,000'],
      ['claude', '185000'],
      ['claude', '$150,000 - $199,999'],
    ]);
    // Yours, from the job's row, wins.
    desktop.tracker.updateJob(JOB, { payAsk: '$195,000' }, at);
    await engine.syncOnce();
    expect((await both(desktop, keys, client)).slice(1)).toEqual([
      ['job', '$195,000'],
      ['job', '195000'],
      ['job', '$150,000 - $199,999'],
    ]);
  });

  it('reads your Claude’s suggestion from every job.md, from an app before rows named folders', async () => {
    const { desktop, keys, client, engine } = await account({ older: true });
    profile(desktop);
    const notes = join(desktop.workspace, 'applications', FOLDER, 'job.md');
    writeFileSync(notes, `${readFileSync(notes, 'utf8')}\n- **Pay to ask for:** $185,000\n`);
    await engine.syncOnce();
    expect((await both(desktop, keys, client)).slice(1)).toEqual([
      ['claude', '$185,000'],
      ['claude', '185000'],
      ['claude', '$150,000 - $199,999'],
    ]);
  });
});

describe('finding a job’s folder through sync', () => {
  /** The form, with a question only where the job is answers: its job.md says. */
  const WHERE = asked('Are you legally authorized to work in the country you applied for?', {
    control: 'choice',
    options: ['Yes', 'No'],
  });
  const ASK = { ...FILL, fields: [...FIELDS, WHERE] };
  const replies = (answer: Awaited<ReturnType<typeof answerAsk>>) => {
    if (!answer.ok || answer.did !== 'fill') throw new Error('No plan.');
    return Object.fromEntries(ASK.fields.map((field, at) => [field.question, answer.replies[at]]));
  };

  it('finds it by the job’s row, and reads only the job.md of the job the form’s for', async () => {
    const { desktop, keys, client } = await account();
    const rows = (await readSynced(client, keys)).rows.jobs;
    expect([...rows.values()].map((row) => row.folder).sort()).toEqual([LUMEN, FOLDER, null, null]);
    const files = vi.spyOn(client, 'getFile');
    const app = replies(await answerAsk(ASK, desktop.deps));
    const ours = replies(ok(await fillFor(client, keys).ask(ASK)));
    expect(synced(ours)).toEqual(synced(app));
    // Where the job is, as only its job.md says.
    expect(ours[WHERE.question]).toMatchObject({ pick: ['Yes'], source: 'profile' });
    expect(
      await notesFetched(
        client,
        keys,
        files.mock.calls.map(([id]) => id),
      ),
    ).toEqual([FOLDER]);
  });

  it('reads every folder’s job.md from an app before rows named them, and answers alike', async () => {
    const { desktop, keys, client } = await account({ older: true });
    const rows = (await readSynced(client, keys)).rows.jobs;
    expect([...rows.values()].some((row) => 'folder' in row)).toBe(false);
    const files = vi.spyOn(client, 'getFile');
    const app = replies(await answerAsk(ASK, desktop.deps));
    const ours = replies(ok(await fillFor(client, keys).ask(ASK)));
    expect(synced(ours)).toEqual(synced(app));
    expect(ours[WHERE.question]).toMatchObject({ pick: ['Yes'], source: 'profile' });
    expect(
      await notesFetched(
        client,
        keys,
        files.mock.calls.map(([id]) => id),
      ),
    ).toEqual([FOLDER, LUMEN].sort());
  });

  it('reads a folder no row names, and every folder of the job it joins, as the app makes it', async () => {
    const { desktop, keys, client, engine } = await account();
    // Another folder for the job, as an app from before rows named them makes on another
    // computer, with a draft of its own: the job's row still names the first.
    const later = '2026-10-22-northwind-labs-senior-product-manager-data';
    desktop.write(
      `applications/${later}/job.md`,
      [
        '# Northwind Labs: Senior Product Manager, Data',
        '',
        '- **Date:** 2026-10-22',
        `- **Apply:** Lever ${FORM_URL.replace(/\/apply$/, '')}`,
        '- **Work arrangement:** Hybrid, Boulder, CO',
      ].join('\n'),
    );
    desktop.write(
      `applications/${later}/answers.md`,
      '## Why Northwind Labs?\n\nIts data products reach the people I build for.\n',
    );
    await engine.syncOnce();
    expect((await readSynced(client, keys)).rows.jobs.get(JOB)?.folder).toBe(FOLDER);
    const files = vi.spyOn(client, 'getFile');
    const ours = replies(ok(await fillFor(client, keys).ask(ASK)));
    expect(
      await notesFetched(
        client,
        keys,
        files.mock.calls.map(([id]) => id),
      ),
    ).toEqual([FOLDER, later].sort());
    desktop.jobs.read();
    const app = replies(await answerAsk(ASK, desktop.deps));
    expect(synced(ours)).toEqual(synced(app));
    expect(ours['Why Northwind Labs?']).toMatchObject({ source: 'claude' });
  });
});

describe('which job folders a fill reads', () => {
  const file = (id: string) => ({ id, size: 10, modified: '2026-10-20T10:00:00.000Z' });
  const row = (id: string, company: string, folder: string | null, more: RowValues = {}) => ({
    id,
    company,
    company_key: company.toLowerCase().replace(/\W+/g, '-'),
    role: 'Product Manager',
    links: '[]',
    folder,
    ...more,
  });
  const notes = (company: string) => `# ${company}: Product Manager\n\n- **Date:** 2026-10-20`;
  /** What sync holds: a folder for each company, and a row for each job given. */
  const holding = (rows: RowValues[], folders: Record<string, string>): Synced => ({
    files: new Map(
      Object.keys(folders).flatMap((folder) => [
        [`applications/${folder}/job.md`, file(`${folder}-notes`)],
        [`applications/${folder}/resume.pdf`, file(`${folder}-pdf`)],
      ]),
    ),
    rows: {
      jobs: new Map(rows.map((each) => [String(each.id), each])),
      calls: new Map(),
      notes: new Map(),
    },
    cursor: 1,
  });
  const reads = async (held: Synced, folders: Record<string, string>) => {
    const read: string[] = [];
    const texts = await readJobNotes(held, async (path) => {
      read.push(path.split('/')[1] ?? '');
      return folders[path.split('/')[1] ?? ''] ?? null;
    });
    return { read: read.sort(), jobs: syncedJobs(held, texts).listed };
  };

  it('reads none a job’s row names, and gives each job its folder’s files', async () => {
    const folders = { 'a-pm': notes('Acme'), 'b-pm': notes('Bolt') };
    const held = holding(
      [row('acme--pm', 'Acme', 'a-pm'), row('bolt--pm', 'Bolt', 'b-pm')],
      folders,
    );
    const { read, jobs } = await reads(held, folders);
    expect(read).toEqual([]);
    expect(jobs.map((job) => [job.id, job.folder, job.files.map((each) => each.path)])).toEqual([
      ['acme--pm', 'a-pm', ['applications/a-pm/resume.pdf']],
      ['bolt--pm', 'b-pm', ['applications/b-pm/resume.pdf']],
    ]);
  });

  it('reads a folder two rows name, one sync doesn’t hold, and a merged job’s', async () => {
    const folders = { 'a-pm': notes('Acme'), 'b-pm': notes('Bolt'), 'c-pm': notes('Cord') };
    const held = holding(
      [
        row('acme--pm', 'Acme', 'a-pm'),
        row('acme--pm-2', 'Acme', 'a-pm'),
        row('bolt--pm', 'Bolt', 'gone-pm'),
        row('cord--pm', 'Cord', 'c-pm', { merged_into: 'acme--pm' }),
      ],
      folders,
    );
    const { read } = await reads(held, folders);
    expect(read).toEqual(['a-pm', 'b-pm', 'c-pm']);
  });

  it('reads the folder a job’s row names too, once a folder no row names joins the job', async () => {
    const folders = { 'a-pm': notes('Acme'), 'a-pm-later': notes('Acme'), 'b-pm': notes('Bolt') };
    const held = holding(
      [row('acme--pm', 'Acme', 'a-pm'), row('bolt--pm', 'Bolt', 'b-pm')],
      folders,
    );
    const { read, jobs } = await reads(held, folders);
    expect(read).toEqual(['a-pm', 'a-pm-later']);
    expect(jobs.find((job) => job.id === 'acme--pm')?.files.map((each) => each.path)).toEqual([
      'applications/a-pm/resume.pdf',
      'applications/a-pm-later/resume.pdf',
    ]);
  });
});

describe('keeping a new answer in Profile through sync', () => {
  /** The new answers you typed, as Mark as applied offers to keep them. */
  const ANSWERS: { kind: FieldKind; text: string }[] = [
    { kind: 'phone', text: '(303) 555-0199' },
    { kind: 'city', text: 'Denver' },
    { kind: 'pronouns', text: 'she/her' },
    { kind: 'how-heard', text: 'A friend at Northwind' },
    { kind: 'start-date', text: 'Two weeks after an offer' },
  ];
  /** A fill through sync, and the version of Profile it filled from. */
  const filled = async (client: SyncClient, keys: AccountKeys) => {
    const fill = fillFor(client, keys);
    const plan = ok(await fill.ask(FILL));
    if (plan.did !== 'fill' || plan.profile === undefined) throw new Error('No Profile.');
    return { fill, since: plan.profile };
  };
  /** What Profile says, as the app reads it, of the answers a form asks. */
  const profileOf = (about: AboutStore) => {
    const { you, applications, start } = about.answers();
    return { you, applications, start };
  };

  it('keeps each one in Profile, as the app keeps it with the extension on its computer', async () => {
    const here = await computer();
    expect(await answerAsk({ ask: 'remember', answers: ANSWERS }, here.deps)).toEqual({
      ok: true,
      did: 'remember',
      saved: 5,
    });
    const { keys, client, desktop, engine } = await account();
    const { fill, since } = await filled(client, keys);
    expect(await fill.ask({ ask: 'remember', answers: ANSWERS, since })).toEqual({
      ok: true,
      did: 'remember',
      saved: 5,
    });
    await engine.syncOnce();
    expect(profileOf(desktop.about)).toEqual(profileOf(here.about));
    expect(profileOf(desktop.about)).toMatchObject({
      you: { phone: '(303) 555-0199', email: 'ana@example.com' },
      applications: { city: 'Denver', pronouns: 'she/her', countries: ['United States'] },
      start: 'Two weeks after an offer',
    });
    // Saving the same again changes nothing in sync.
    const versions = await client.versions(await recordId(keys, 'file:about-me/answers.json'));
    expect(await fill.ask({ ask: 'remember', answers: ANSWERS, since })).toMatchObject({
      saved: 5,
    });
    expect(await client.versions(await recordId(keys, 'file:about-me/answers.json'))).toEqual(
      versions,
    );
  });

  it('never keeps your street, postal code or equal-opportunity answers through sync', async () => {
    const { keys, client, desktop, engine } = await account();
    const { fill, since } = await filled(client, keys);
    const record = await recordId(keys, 'file:about-me/answers.json');
    const versions = await client.versions(record);
    expect(
      await fill.ask({
        ask: 'remember',
        answers: [
          { kind: 'street', text: '77 Main St' },
          { kind: 'postal-code', text: '80203' },
          { kind: 'gender', text: 'Female' },
        ],
        since,
      }),
    ).toEqual({ ok: true, did: 'remember', saved: 0 });
    expect(await client.versions(record)).toEqual(versions);
    await engine.syncOnce();
    expect(desktop.deps.kept.read()).toMatchObject({
      street: '1420 Larimer St',
      postalCode: '80202',
    });
  });

  it('replaces an answer Profile had when the form was filled, and keeps what changed since', async () => {
    const { keys, client, desktop, engine } = await account();
    const { fill, since } = await filled(client, keys);
    // Meanwhile, Factwright changes another answer in Profile.
    const { you } = desktop.about.answers();
    desktop.about.saveAnswers({ you: { ...you, email: 'ana.ruiz@example.com' } });
    await engine.syncOnce();
    expect(
      await fill.ask({
        ask: 'remember',
        answers: [{ kind: 'phone', text: '(303) 555-0199' }],
        since,
      }),
    ).toEqual({ ok: true, did: 'remember', saved: 1 });
    await engine.syncOnce();
    expect(desktop.about.answers().you).toMatchObject({
      email: 'ana.ruiz@example.com',
      phone: '(303) 555-0199',
    });
  });

  it('keeps an answer Factwright changed since the form was filled, and yours beside it', async () => {
    const { keys, client, desktop, engine } = await account();
    const { fill, since } = await filled(client, keys);
    const { you } = desktop.about.answers();
    desktop.about.saveAnswers({ you: { ...you, phone: '(720) 555-0111' } });
    await engine.syncOnce();
    const copy = 'about-me/answers (Factwright in Chrome, Oct 23).json';
    expect(
      await fill.ask({
        ask: 'remember',
        answers: [
          { kind: 'phone', text: '(303) 555-0199' },
          { kind: 'city', text: 'Denver' },
        ],
        since,
      }),
    ).toEqual({ ok: true, did: 'remember', saved: 1, copy });
    await engine.syncOnce();
    expect(desktop.about.answers()).toMatchObject({
      you: { phone: '(720) 555-0111' },
      applications: { city: 'Denver' },
    });
    // Yours, as you'd have kept them, beside it, as sync keeps both copies of a file.
    const beside = JSON.parse(readFileSync(join(desktop.workspace, ...copy.split('/')), 'utf8'));
    expect(beside).toMatchObject({
      you: { phone: '(303) 555-0199', email: 'ana@example.com' },
      applications: { city: 'Denver' },
    });
    // Another clash the same day gets a copy of its own.
    desktop.about.saveAnswers({ you: { ...you, phone: '(720) 555-0122' } });
    await engine.syncOnce();
    expect(
      await fill.ask({
        ask: 'remember',
        answers: [{ kind: 'phone', text: '(303) 555-0199' }],
        since,
      }),
    ).toMatchObject({ saved: 0, copy: 'about-me/answers (Factwright in Chrome, Oct 23 2).json' });
  });

  it('makes its change again on Profile changed in the moment before it went up', async () => {
    const { keys, client, desktop, engine } = await account();
    const { fill, since } = await filled(client, keys);
    const push = client.push.bind(client);
    vi.spyOn(client, 'push').mockImplementationOnce(async (changes) => {
      const { you } = desktop.about.answers();
      desktop.about.saveAnswers({ you: { ...you, website: 'https://anaruiz.example' } });
      await engine.syncOnce();
      return push(changes);
    });
    expect(
      await fill.ask({
        ask: 'remember',
        answers: [{ kind: 'phone', text: '(303) 555-0199' }],
        since,
      }),
    ).toEqual({ ok: true, did: 'remember', saved: 1 });
    await engine.syncOnce();
    expect(desktop.about.answers().you).toMatchObject({
      website: 'https://anaruiz.example',
      phone: '(303) 555-0199',
    });
  });

  it('opens only Profile’s own record, never another, nor a deletion the server makes up', async () => {
    const { keys, client, desktop, engine } = await account();
    const { fill, since } = await filled(client, keys);
    const before = desktop.about.answers().you;
    const profile = await recordId(keys, 'file:about-me/answers.json');
    const other = await recordId(keys, 'file:about-me/history.json');
    const [latest] = await client.versions(profile);
    const [history] = await client.versions(other);
    const real = client.version.bind(client);
    const [own, swapped] = await Promise.all([
      real(profile, latest?.version ?? 1),
      real(other, history?.version ?? 1),
    ]);
    const phone = [{ kind: 'phone' as const, text: '(303) 555-0199' }];
    const version = vi.spyOn(client, 'version');
    // A server that sends another file's version, or says Profile's was deleted, with nothing
    // locked to show it.
    for (const sent of [swapped, own && { ...own, deleted: true, data: '' }]) {
      version.mockImplementation(async (record, at) =>
        record === profile ? sent : real(record, at),
      );
      expect(await fill.ask({ ask: 'remember', answers: phone, since })).toMatchObject({
        ok: false,
        reason: 'failed',
      });
    }
    // Saying it was deleted when the record it locked says otherwise changes nothing.
    version.mockImplementation(async (record, at) =>
      record === profile && own ? { ...own, deleted: true } : real(record, at),
    );
    expect(await fill.ask({ ask: 'remember', answers: phone, since })).toMatchObject({ saved: 1 });
    await engine.syncOnce();
    expect(desktop.about.answers().you).toEqual({ ...before, phone: '(303) 555-0199' });
  });

  it('saves nothing in place of a Profile gone from sync since the form was filled', async () => {
    const { keys, client, desktop, engine } = await account();
    const { fill, since } = await filled(client, keys);
    const profile = await recordId(keys, 'file:about-me/answers.json');
    const versions = client.versions.bind(client);
    // As after the server's restored from a backup from before Profile.
    vi.spyOn(client, 'versions').mockImplementation(async (record) =>
      record === profile ? [] : versions(record),
    );
    const push = vi.spyOn(client, 'push');
    expect(
      await fill.ask({ ask: 'remember', answers: [{ kind: 'phone', text: '1' }], since }),
    ).toMatchObject({ ok: false, reason: 'failed' });
    expect(push).not.toHaveBeenCalled();
    await engine.syncOnce();
    expect(desktop.about.answers().you.email).toBe('ana@example.com');
  });

  it('starts Profile’s answers through sync where there were none as the form was filled', async () => {
    const { keys, client, desktop, engine } = await account();
    rmSync(join(desktop.workspace, 'about-me', 'answers.json'));
    await engine.syncOnce();
    const { fill, since } = await filled(client, keys);
    expect(since).toBe('');
    expect(
      await fill.ask({ ask: 'remember', answers: [{ kind: 'phone', text: '1' }], since }),
    ).toEqual({ ok: true, did: 'remember', saved: 1 });
    await engine.syncOnce();
    expect(desktop.about.answers().you).toEqual({ ...NO_CONTACT, phone: '1' });
  });

  it('leaves Profile’s answers as they are when they don’t read', async () => {
    const { keys, client, desktop, engine } = await account();
    const { fill, since } = await filled(client, keys);
    desktop.write('about-me/answers.json', '{ "you": ');
    await engine.syncOnce();
    expect(
      await fill.ask({
        ask: 'remember',
        answers: [{ kind: 'phone', text: '(303) 555-0199' }],
        since,
      }),
    ).toMatchObject({ ok: false, reason: 'failed' });
    await engine.syncOnce();
    expect(readFileSync(join(desktop.workspace, 'about-me', 'answers.json'), 'utf8')).toBe(
      '{ "you": ',
    );
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
