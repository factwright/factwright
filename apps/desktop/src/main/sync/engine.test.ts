import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CollectedJob } from '@factwright/core';
import { type Account, startServer, type TestServer } from '@factwright/server/testing';
import { accountKeys, type Bytes, newAccountKey } from '@factwright/sync';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { trackerAsOf } from '../jobs/testing.ts';
import { type EditContext, Tracker } from '../jobs/tracker.ts';
import { SyncEngine } from './engine.ts';
import { adoptGainedColumns, adoptGainedTables } from './rows.ts';
import { SyncState } from './state.ts';

const AT: EditContext = { today: '2026-10-12', now: '2026-10-12T09:00:00.000Z' };
const OCT_12 = () => new Date('2026-10-12T09:30:00');

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const job = (id: string): CollectedJob => ({
  id,
  company: 'Acme Robotics',
  companyKey: 'acme-robotics',
  role: 'Staff Engineer',
  link: null,
  links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
  location: null,
  pay: null,
  source: 'Fit check',
  fit: null,
  search: null,
  searches: [],
  kindFound: null,
  suggestedAsk: null,
  folder: null,
  stage: 'review',
  firstSeen: '2026-10-07',
  lastActivity: '2026-10-07',
  summary: null,
  events: [],
  docs: {},
  outreach: [],
  apply: null,
  fitReport: null,
  sentiment: null,
  files: [],
  letters: [],
  projectPages: [],
});

/** A computer with its own workspace, tracker and sync notes, signed in to the account. */
async function computer(name: string, account: Account, accountKey: Bytes) {
  const folder = mkdtempSync(join(tmpdir(), 'factwright-sync-'));
  const workspace = join(folder, 'workspace');
  mkdirSync(workspace);
  const file = join(folder, 'tracker.db');
  let tracker = new Tracker(file);
  const state = new SyncState(join(folder, 'sync.db'));
  const session = await server.newSession(account.id);
  const keys = await accountKeys(accountKey);
  const engineFor = (current: Tracker) =>
    new SyncEngine({
      client: session.client,
      keys,
      state,
      tracker: current,
      workspace,
      device: name,
      now: OCT_12,
    });
  let engine = engineFor(tracker);
  const at = (path: string) => join(workspace, ...path.split('/'));
  return {
    workspace,
    state,
    get tracker() {
      return tracker;
    },
    sync: () => engine.syncOnce(),
    /**
     * Goes back to an earlier version's tracker, such as 2, before the answers sent and questions
     * for Claude, or 4, before the day a job set aside comes back and why a job was passed on, or 5, before kinds
     * of job.
     * The tables made since stay, as this version's sync needs them.
     */
    goBackTo(version: number) {
      trackerAsOf(file, version, { keepTables: true });
    },
    /** Updates the app: opens the tracker again, as the new version does, and syncs from there. */
    update() {
      tracker.close();
      tracker = new Tracker(file);
      adoptGainedColumns(tracker, state);
      adoptGainedTables(tracker, state);
      engine = engineFor(tracker);
    },
    /**
     * Updates the app from a version before notes, which passed over the notes other devices
     * sent: it had no table to keep them in, so it never noted them as synced.
     */
    updateFromBeforeNotes() {
      tracker.close();
      trackerAsOf(file, 3);
      const synced = new DatabaseSync(join(folder, 'sync.db'));
      synced.exec("DELETE FROM synced WHERE name LIKE 'row:notes:%'");
      synced.close();
      tracker = new Tracker(file);
      adoptGainedColumns(tracker, state);
      adoptGainedTables(tracker, state);
      engine = engineFor(tracker);
    },
    write(path: string, text: string | Uint8Array) {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), text);
    },
    read: (path: string) => (existsSync(at(path)) ? readFileSync(at(path), 'utf8') : null),
    remove: (path: string) => rmSync(at(path)),
    has: (path: string) => existsSync(at(path)),
    close() {
      tracker.close();
      state.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

type Computer = Awaited<ReturnType<typeof computer>>;

let mac: Computer;
let pc: Computer;

beforeEach(async () => {
  const account = await server.signUp();
  const accountKey = newAccountKey();
  mac = await computer('Sam’s Mac', account, accountKey);
  pc = await computer('Sam’s PC', account, accountKey);
});

afterEach(() => {
  mac?.close();
  pc?.close();
});

describe('two computers on one account', () => {
  it('show the same job hunt: every file, and everything tracked', async () => {
    mac.write('facts/skills.md', '# Skills\n- TypeScript');
    mac.write('applications/acme--staff/posting.md', '# Staff Engineer at Acme');
    mac.write('applications/acme--staff/resume.pdf', new Uint8Array([37, 80, 68, 70, 0, 255]));
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.updateJob('acme--staff', { status: 'applied', earlierNotes: 'Recruiter: Sam' }, AT);
    mac.tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-14' }, AT);

    expect(await mac.sync()).toMatchObject({ pushed: 7, pulled: 0, conflicts: 0 });
    expect(await pc.sync()).toMatchObject({ pulled: 7, pushed: 0 });

    expect(pc.read('facts/skills.md')).toBe('# Skills\n- TypeScript');
    expect(pc.read('applications/acme--staff/posting.md')).toBe('# Staff Engineer at Acme');
    expect(
      new Uint8Array(readFileSync(join(pc.workspace, 'applications/acme--staff/resume.pdf'))),
    ).toEqual(new Uint8Array([37, 80, 68, 70, 0, 255]));
    expect(pc.tracker.rows()).toEqual(mac.tracker.rows());
    expect(pc.tracker.calls()).toEqual(mac.tracker.calls());
    expect(pc.tracker.history()).toEqual(mac.tracker.history());
  });

  it('send changes both ways, and nothing that didn’t change', async () => {
    mac.write('facts/skills.md', 'v1');
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    await mac.sync();
    await pc.sync();
    expect(await pc.sync()).toMatchObject({ pushed: 0, pulled: 0 });

    pc.write('facts/skills.md', 'v2 from the PC');
    pc.tracker.updateJob('acme--staff', { nextAction: 'Follow up', nextOn: '2026-10-20' }, AT);
    expect(await pc.sync()).toMatchObject({ pushed: 2 });
    expect(await mac.sync()).toMatchObject({ pulled: 2, pushed: 0 });
    expect(mac.read('facts/skills.md')).toBe('v2 from the PC');
    expect(mac.tracker.rows()[0]).toMatchObject({ nextAction: 'Follow up', nextOn: '2026-10-20' });
  });

  it('delete everywhere what’s deleted on one, with folders it leaves empty', async () => {
    mac.write('applications/globex/posting.md', 'Globex');
    mac.write('facts/skills.md', 'Skills');
    await mac.sync();
    await pc.sync();
    mac.remove('applications/globex/posting.md');
    await mac.sync();
    expect(await pc.sync()).toMatchObject({ pulled: 1 });
    expect(pc.has('applications/globex/posting.md')).toBe(false);
    expect(pc.has('applications/globex')).toBe(false);
    expect(pc.read('facts/skills.md')).toBe('Skills');
  });

  it('keep both copies of a file both changed', async () => {
    mac.write('facts/skills.md', 'first');
    await mac.sync();
    await pc.sync();
    mac.write('facts/skills.md', 'the Mac’s change');
    pc.write('facts/skills.md', 'the PC’s change');
    await mac.sync();
    expect(await pc.sync()).toMatchObject({ conflicts: 1 });
    expect(pc.read('facts/skills.md')).toBe('the Mac’s change');
    expect(pc.read('facts/skills (Sam’s PC, Oct 12).md')).toBe('the PC’s change');
    await mac.sync();
    expect(mac.read('facts/skills (Sam’s PC, Oct 12).md')).toBe('the PC’s change');
    expect(mac.read('facts/skills.md')).toBe('the Mac’s change');
  });

  it('keep the notes each one jots, and both words when both change one', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.addNote('acme--staff', { text: 'Screen with Sam on Tuesday' }, AT);
    await mac.sync();
    await pc.sync();
    const later: EditContext = { today: '2026-10-13', now: '2026-10-13T09:00:00.000Z' };
    const [shared] = pc.tracker.notes().get('acme--staff') ?? [];
    mac.tracker.updateNote(shared?.id ?? '', { text: 'Screen with Sam: they want Go' }, later);
    pc.tracker.updateNote(shared?.id ?? '', { text: 'Screen with Sam, then a panel' }, later);
    pc.tracker.addNote('acme--staff', { text: 'Panel is four people' }, later);
    await mac.sync();
    expect(await pc.sync()).toMatchObject({ conflicts: 1 });
    await mac.sync();
    for (const each of [mac, pc]) {
      expect(
        each.tracker
          .notes()
          .get('acme--staff')
          ?.map((note) => note.text),
      ).toEqual([
        'Screen with Sam, then a panel\n\nFrom Sam’s Mac:\nScreen with Sam: they want Go',
        'Panel is four people',
      ]);
    }
    // Deleted on one, gone from both.
    mac.tracker.deleteNote(shared?.id ?? '');
    await mac.sync();
    await pc.sync();
    expect(
      pc.tracker
        .notes()
        .get('acme--staff')
        ?.map((note) => note.text),
    ).toEqual(['Panel is four people']);
  });

  it('bring a computer that passed over notes the ones it missed, once it updates', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    await mac.sync();
    await pc.sync();
    mac.tracker.addNote('acme--staff', { text: 'Screen went well, from the Mac' }, AT);
    await mac.sync();
    await pc.sync();
    pc.updateFromBeforeNotes();
    expect(pc.tracker.notes().size).toBe(0);
    await pc.sync();
    expect(
      pc.tracker
        .notes()
        .get('acme--staff')
        ?.map((note) => note.text),
    ).toEqual(['Screen went well, from the Mac']);
    // Once is enough: after that, sync goes on from where it got to.
    expect(await pc.sync()).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('leave alone the rows of a table only a newer version keeps', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    await mac.sync();
    // As after going back to an older app: its last sync saw a row it has no table for.
    const [synced] = mac.state.all('row:jobs:');
    if (!synced) throw new Error('No synced job');
    mac.state.save({ ...synced, name: 'row:reminders:r1', record: synced.record });
    expect(await mac.sync()).toMatchObject({ pushed: 0 });
  });

  it('merge a job both changed, keeping both notes', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.updateJob('acme--staff', { earlierNotes: 'Recruiter: Sam' }, AT);
    await mac.sync();
    await pc.sync();
    const later: EditContext = { today: '2026-10-13', now: '2026-10-13T09:00:00.000Z' };
    mac.tracker.updateJob(
      'acme--staff',
      { earlierNotes: 'Recruiter: Sam. Salary band shared.' },
      later,
    );
    pc.tracker.updateJob(
      'acme--staff',
      { status: 'interview', earlierNotes: 'Referred by Priya' },
      later,
    );
    await mac.sync();
    expect(await pc.sync()).toMatchObject({ conflicts: 1 });
    await mac.sync();
    for (const each of [mac, pc]) {
      expect(each.tracker.rows()[0]).toMatchObject({
        status: 'interview',
        earlierNotes: 'Referred by Priya\n\nFrom Sam’s Mac:\nRecruiter: Sam. Salary band shared.',
      });
    }
    expect(mac.tracker.history()).toEqual(pc.tracker.history());
  });

  it('keep what one sent when the other updates the app after syncing it', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.updateJob('acme--staff', { questions: ['Why Acme?'] }, AT);
    mac.tracker.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys, mostly.', AT);
    mac.tracker.addAsk('acme--staff', 'What should I expect?', AT);
    await mac.sync();
    // The PC is still on the version before them, so it keeps them only in what it synced.
    pc.goBackTo(2);
    await pc.sync();
    expect(pc.tracker.rows()[0]?.earlierNotes).toBeNull();
    pc.update();
    expect(pc.tracker.rows()[0]).toMatchObject({
      sent: [{ question: 'Why Acme?', text: 'Deploys, mostly.' }],
      asks: [{ question: 'What should I expect?' }],
    });
    expect(await pc.sync()).toMatchObject({ pushed: 0 });
    await mac.sync();
    expect(mac.tracker.rows()[0]?.sent).toHaveLength(1);
    expect(mac.tracker.rows()[0]?.asks).toHaveLength(1);
  });

  it('keep what one sent when the other changed a job before updating', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys, mostly.', AT);
    await mac.sync();
    pc.goBackTo(2);
    await pc.sync();
    pc.tracker.updateJob('acme--staff', { earlierNotes: 'Referred by Priya' }, AT);
    pc.update();
    expect(await pc.sync()).toMatchObject({ pushed: 1 });
    await mac.sync();
    for (const each of [mac, pc]) {
      expect(each.tracker.rows()[0]).toMatchObject({
        earlierNotes: 'Referred by Priya',
        sent: [{ question: 'Why Acme?', text: 'Deploys, mostly.' }],
      });
    }
  });

  it('keep a job’s kind through a computer from before kinds, which gets it once it updates', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    await mac.sync();
    await pc.sync();
    // The PC is still on a version without kinds of job, as 0.1.x is.
    pc.goBackTo(5);
    mac.tracker.updateJob('acme--staff', { kind: 'project-manager' }, AT);
    await mac.sync();
    await pc.sync();
    // It changes the job without knowing its kind, and what it sends keeps the kind.
    const later: EditContext = { today: '2026-10-13', now: '2026-10-13T09:00:00.000Z' };
    pc.tracker.updateJob('acme--staff', { status: 'applied' }, later);
    expect(await pc.sync()).toMatchObject({ pushed: 2 });
    await mac.sync();
    expect(mac.tracker.rows()[0]).toMatchObject({ status: 'applied', kind: 'project-manager' });
    // Once it updates, it has the kind too, from what it synced, with nothing to send.
    pc.update();
    expect(pc.tracker.rows()[0]).toMatchObject({ status: 'applied', kind: 'project-manager' });
    expect(await pc.sync()).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('keep a job’s kind when a computer from before kinds changed the job at the same time', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    await mac.sync();
    await pc.sync();
    pc.goBackTo(5);
    const later: EditContext = { today: '2026-10-13', now: '2026-10-13T09:00:00.000Z' };
    mac.tracker.updateJob('acme--staff', { kind: 'project-manager' }, AT);
    pc.tracker.updateJob('acme--staff', { status: 'interview' }, later);
    await mac.sync();
    expect(await pc.sync()).toMatchObject({ conflicts: 1 });
    await mac.sync();
    expect(mac.tracker.rows()[0]).toMatchObject({ status: 'interview', kind: 'project-manager' });
    pc.update();
    expect(pc.tracker.rows()[0]).toMatchObject({ status: 'interview', kind: 'project-manager' });
    expect(await pc.sync()).toMatchObject({ pushed: 0 });
  });

  it('keep the pay to ask for at a job through a computer from before it, which gets it once it updates', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    await mac.sync();
    await pc.sync();
    // The PC is still on a version without the pay to ask for, as 0.16 is.
    pc.goBackTo(9);
    mac.tracker.updateJob('acme--staff', { payAsk: '$185,000' }, AT);
    await mac.sync();
    await pc.sync();
    // It changes the job without knowing the pay to ask for, and what it sends keeps it.
    const later: EditContext = { today: '2026-10-13', now: '2026-10-13T09:00:00.000Z' };
    pc.tracker.updateJob('acme--staff', { status: 'applied' }, later);
    expect(await pc.sync()).toMatchObject({ pushed: 2 });
    await mac.sync();
    expect(mac.tracker.rows()[0]).toMatchObject({ status: 'applied', payAsk: '$185,000' });
    // Once it updates, it has it too, from what it synced, with nothing to send.
    pc.update();
    expect(pc.tracker.rows()[0]).toMatchObject({ status: 'applied', payAsk: '$185,000' });
    expect(await pc.sync()).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('keep the details the user set, and their word that two jobs aren’t the same, both ways', async () => {
    mac.tracker.saveCollected([job('acme--staff'), job('acme--staff-2')], AT.now);
    mac.tracker.noteMaybeSame('acme--staff', 'acme--staff-2', 'Same team', AT);
    await mac.sync();
    await pc.sync();
    // The PC is on a version from before them, as 0.17 is, and changes the job meanwhile.
    pc.goBackTo(10);
    const later: EditContext = { today: '2026-10-13', now: '2026-10-13T09:00:00.000Z' };
    mac.tracker.updateJob('acme--staff', { company: 'Acme', location: 'Remote (US)' }, later);
    mac.tracker.notSame('acme--staff', 'acme--staff-2', later);
    pc.tracker.updateJob('acme--staff', { status: 'apply' }, later);
    await mac.sync();
    await pc.sync();
    await mac.sync();
    expect(mac.tracker.rows()[0]).toMatchObject({
      status: 'apply',
      own: { company: 'Acme', role: null, pay: null, location: 'Remote (US)' },
      maybeSame: [{ id: 'acme--staff-2', why: 'Same team', notSame: true }],
    });
    pc.update();
    expect(pc.tracker.rows()[0]).toMatchObject({
      own: { company: 'Acme', location: 'Remote (US)' },
      maybeSame: [{ id: 'acme--staff-2', notSame: true }],
    });
  });

  it('keep a job’s folder through a computer from before folders, which gets it once it updates', async () => {
    const folder = '2026-10-07-acme-robotics-staff-engineer';
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    await mac.sync();
    await pc.sync();
    // The PC is still on a version that doesn't keep a job's folder in its row, as 0.15 is.
    pc.goBackTo(8);
    mac.tracker.saveFolders([{ ...job('acme--staff'), folder }], new Set([folder]));
    expect(await mac.sync()).toMatchObject({ pushed: 1 });
    await pc.sync();
    // It changes the job without knowing its folder, and what it sends keeps the folder.
    const later: EditContext = { today: '2026-10-13', now: '2026-10-13T09:00:00.000Z' };
    pc.tracker.updateJob('acme--staff', { status: 'applied' }, later);
    expect(await pc.sync()).toMatchObject({ pushed: 2 });
    await mac.sync();
    expect(mac.tracker.rows()[0]).toMatchObject({ status: 'applied', folder });
    pc.update();
    expect(pc.tracker.rows()[0]).toMatchObject({ status: 'applied', folder });
    expect(await pc.sync()).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('send a job’s folder once, when the computer from before folders updates', async () => {
    const folder = '2026-10-07-acme-robotics-staff-engineer';
    mac.goBackTo(8);
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    await mac.sync();
    await pc.sync();
    expect(pc.tracker.rows()[0]?.folder).toBeNull();
    // Updated, it has nothing to send until it reads the workspace and finds the job's folder.
    mac.update();
    expect(await mac.sync()).toMatchObject({ pulled: 0, pushed: 0 });
    mac.tracker.saveFolders([{ ...job('acme--staff'), folder }], new Set([folder]));
    expect(await mac.sync()).toMatchObject({ pushed: 1 });
    await pc.sync();
    expect(pc.tracker.rows()[0]?.folder).toBe(folder);
    expect(await mac.sync()).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('keep a call’s details through a computer from before them, which gets them once it updates', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.addCall(
      'acme--staff',
      {
        kind: 'panel',
        onDate: '2026-10-20',
        atTime: '14:00',
        minutes: 60,
        mode: 'video',
        place: 'https://meet.example/abc',
        people: [
          { name: 'Dana Lee', role: 'Hiring manager' },
          { name: 'Sam Ortiz', role: 'Staff engineer' },
        ],
      },
      AT,
    );
    await mac.sync();
    // The PC is on the version before a call's details, as 0.4.0 is.
    pc.goBackTo(6);
    await pc.sync();
    const id = mac.tracker.calls().get('acme--staff')?.[0]?.id ?? '';
    expect(pc.tracker.syncRow('calls', id)).not.toHaveProperty('people');
    // Both change the call: the PC says it's done, while the Mac writes how it went.
    const later: EditContext = { today: '2026-10-20', now: '2026-10-20T16:00:00.000Z' };
    pc.tracker.updateCall(id, { state: 'done', outcome: 'advanced' }, later);
    mac.tracker.updateCall(id, { debrief: 'Dana asked about on-call.' }, later);
    await pc.sync();
    expect(await mac.sync()).toMatchObject({ conflicts: 1 });
    await pc.sync();
    const call = {
      state: 'done',
      outcome: 'advanced',
      minutes: 60,
      mode: 'video',
      place: 'https://meet.example/abc',
      people: [
        { name: 'Dana Lee', role: 'Hiring manager' },
        { name: 'Sam Ortiz', role: 'Staff engineer' },
      ],
      debrief: 'Dana asked about on-call.',
    };
    expect(mac.tracker.calls().get('acme--staff')).toEqual([expect.objectContaining(call)]);
    // Once the PC updates, it has them all, and nothing more to send.
    pc.update();
    expect(pc.tracker.calls()).toEqual(mac.tracker.calls());
    expect(await pc.sync()).toMatchObject({ pushed: 0 });
  });

  it('keep the people both computers added to a call, and both accounts of how it went', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.addCall(
      'acme--staff',
      { kind: 'panel', onDate: '2026-10-11', people: [{ name: 'Dana Lee', role: null }] },
      AT,
    );
    await mac.sync();
    await pc.sync();
    const id = mac.tracker.calls().get('acme--staff')?.[0]?.id ?? '';
    mac.tracker.updateCall(
      id,
      {
        people: [
          { name: 'Dana Lee', role: 'Hiring manager' },
          { name: 'Sam Ortiz', role: null },
        ],
        debrief: 'Went long on the migration.',
      },
      AT,
    );
    pc.tracker.updateCall(
      id,
      {
        people: [
          { name: 'Dana Lee', role: null },
          { name: 'Ana Ruiz', role: 'Product manager' },
        ],
        debrief: 'Ana asked about roadmaps.',
      },
      AT,
    );
    await mac.sync();
    expect(await pc.sync()).toMatchObject({ conflicts: 1 });
    await mac.sync();
    // Dana keeps the role the Mac gave her, since the PC didn't change her.
    for (const each of [mac, pc]) {
      expect(each.tracker.calls().get('acme--staff')?.[0]).toMatchObject({
        people: [
          { name: 'Ana Ruiz', role: 'Product manager' },
          { name: 'Dana Lee', role: 'Hiring manager' },
          { name: 'Sam Ortiz', role: null },
        ],
        debrief: 'Ana asked about roadmaps.\n\nFrom Sam’s Mac:\nWent long on the migration.',
      });
    }
  });

  it('keep the statuses a newer version sets through a computer still on an earlier one', async () => {
    const globex = { ...job('globex--staff'), company: 'Globex', companyKey: 'globex' };
    mac.tracker.saveCollected([job('acme--staff'), globex], AT.now);
    mac.tracker.updateJob('acme--staff', { status: 'later', backOn: '2026-11-02' }, AT);
    mac.tracker.updateJob('globex--staff', { status: 'passed', passReason: 'pay' }, AT);
    await mac.sync();
    // The PC is on the version before them: it keeps each status as it came, and the new
    // columns only in what it synced. (An earlier version reads a status it doesn't know as
    // none, but its edits write only the columns they change, as these do.)
    pc.goBackTo(4);
    await pc.sync();
    const stored = (id: string) => pc.tracker.syncRow('jobs', id);
    expect(stored('acme--staff')).toMatchObject({ status: 'later' });
    expect(stored('acme--staff')).not.toHaveProperty('back_on');
    expect(stored('globex--staff')).toMatchObject({ status: 'passed' });
    // It changes both jobs, as an older app does: a next step on one, a note on the other.
    const later: EditContext = { today: '2026-10-13', now: '2026-10-13T09:00:00.000Z' };
    pc.tracker.updateJob('acme--staff', { nextAction: 'Ask Sam about the team' }, later);
    pc.tracker.updateJob('globex--staff', { earlierNotes: 'Pay tops out at $150k' }, later);
    // Meanwhile the Mac moves the day Acme comes back, so both changed that job.
    mac.tracker.updateJob('acme--staff', { backOn: '2026-11-09' }, later);
    await pc.sync();
    expect(await mac.sync()).toMatchObject({ conflicts: 1 });
    await pc.sync();
    expect(mac.tracker.rows()).toEqual([
      expect.objectContaining({
        id: 'acme--staff',
        status: 'later',
        backOn: '2026-11-09',
        nextAction: 'Ask Sam about the team',
      }),
      expect.objectContaining({
        id: 'globex--staff',
        status: 'passed',
        passReason: 'pay',
        earlierNotes: 'Pay tops out at $150k',
      }),
    ]);
    expect(
      mac.tracker
        .history()
        .get('acme--staff')
        ?.map((change) => change.status),
    ).toEqual(['later']);
    // Once the PC updates, it has them all too, and nothing more to send.
    pc.update();
    expect(pc.tracker.rows()).toEqual(mac.tracker.rows());
    expect(await pc.sync()).toMatchObject({ pushed: 0 });
  });

  it('keep edits to different answers from both computers, and the later of two to one', async () => {
    mac.tracker.saveCollected([job('acme--staff')], AT.now);
    mac.tracker.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys.', AT);
    mac.tracker.recordAnswer('acme--staff', 'Salary?', 0, '$180k', AT);
    await mac.sync();
    await pc.sync();
    const at = (now: string): EditContext => ({ today: '2026-10-13', now });
    mac.tracker.recordAnswer(
      'acme--staff',
      'Why Acme?',
      0,
      'Deploys, mostly.',
      at('2026-10-13T09:00:00.000Z'),
    );
    pc.tracker.recordAnswer('acme--staff', 'Salary?', 0, '$185k', at('2026-10-13T09:05:00.000Z'));
    await mac.sync();
    await pc.sync();
    await mac.sync();
    for (const each of [mac, pc]) {
      expect(
        each.tracker
          .rows()[0]
          ?.sent.map((answer) => answer.text)
          .sort(),
      ).toEqual(['$185k', 'Deploys, mostly.']);
    }
    // Both change the same answer: the later one stands on both.
    mac.tracker.recordAnswer('acme--staff', 'Salary?', 0, '$190k', at('2026-10-13T10:00:00.000Z'));
    pc.tracker.recordAnswer('acme--staff', 'Salary?', 0, '$200k', at('2026-10-13T10:30:00.000Z'));
    await mac.sync();
    await pc.sync();
    await mac.sync();
    for (const each of [mac, pc]) {
      const salary = each.tracker.rows()[0]?.sent.filter((answer) => answer.question === 'Salary?');
      expect(salary?.map((answer) => answer.text)).toEqual(['$200k']);
    }
  });

  it('bring back a file deleted on one computer while the other changed it', async () => {
    mac.write('facts/skills.md', 'first');
    await mac.sync();
    await pc.sync();
    mac.remove('facts/skills.md');
    pc.write('facts/skills.md', 'changed on the PC');
    await mac.sync();
    await pc.sync();
    await mac.sync();
    expect(mac.read('facts/skills.md')).toBe('changed on the PC');
    expect(pc.read('facts/skills.md')).toBe('changed on the PC');
  });

  // Windows can't make a file with this name in the first place.
  it.skipIf(process.platform === 'win32')(
    'leave files another computer can’t hold where they are, and don’t delete them elsewhere',
    async () => {
      mac.write('facts/what?.md', 'A name Windows can’t hold');
      mac.write('.hidden/state.json', '{}');
      const report = await mac.sync();
      expect(report.skipped).toEqual([{ path: 'facts/what?.md', reason: 'name' }]);
      expect(report.pushed).toBe(0);
      await pc.sync();
      expect(pc.has('facts/what?.md')).toBe(false);
      expect(pc.has('.hidden/state.json')).toBe(false);
    },
  );

  it('pass over a file that can never land on a computer, and keep syncing the rest', async () => {
    mac.write('saved/acme--staff/posting.md', 'Saved from the browser');
    mac.write('facts/work.md', 'Shipped things');
    await mac.sync();
    // On the PC, a file stands where the folder must go, so the posting can't land there.
    pc.write('saved', 'a file in the way');
    const report = await pc.sync();
    expect(report.unreadable).toBe(1);
    expect(pc.read('facts/work.md')).toBe('Shipped things');
    // It isn't tried again and again: the next sync goes on as usual.
    await expect(pc.sync()).resolves.toMatchObject({ unreadable: 0 });
  });

  it('send the same contents once, however many files hold them', async () => {
    mac.write('applications/a/resume.pdf', 'same');
    mac.write('applications/b/resume.pdf', 'same');
    await mac.sync();
    expect((await mac.tracker.rows()).length).toBe(0);
    await pc.sync();
    expect(pc.read('applications/b/resume.pdf')).toBe('same');
  });
});
