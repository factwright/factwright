import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CollectedJob } from '@factwright/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type EditContext, Tracker } from './tracker.ts';

const TODAY = '2026-10-10';
const NOW = '2026-10-10T18:00:00.000Z';
const AT: EditContext = { today: TODAY, now: NOW };

function collected(id: string, extra: Partial<CollectedJob> = {}): CollectedJob {
  return {
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
    folder: null,
    stage: 'checked',
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
    ...extra,
  };
}

let tracker: Tracker;

beforeEach(() => {
  tracker = new Tracker(':memory:');
  tracker.saveCollected([collected('acme--staff')], NOW);
});

afterEach(() => tracker.close());

const row = (id = 'acme--staff') => tracker.rows().find((each) => each.id === id);
const history = (id = 'acme--staff') =>
  (tracker.history().get(id) ?? []).map((change) => [change.status, change.at]);

describe('saveCollected', () => {
  it('keeps each job’s name, links and first sighting', () => {
    expect(tracker.knownJobs()).toEqual([
      {
        id: 'acme--staff',
        company: 'Acme Robotics',
        companyKey: 'acme-robotics',
        role: 'Staff Engineer',
        links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
      },
    ]);
    expect(row()).toMatchObject({ manual: false, firstSeen: '2026-10-07', status: null });
  });

  it('follows new names and links, keeps the earliest sighting, and never blanks the role', () => {
    tracker.updateJob('acme--staff', { earlierNotes: 'Ask about on-call' }, AT);
    tracker.saveCollected(
      [
        collected('acme--staff', {
          company: 'Acme Robotics, Inc.',
          role: '',
          links: [],
          firstSeen: '2026-10-09',
        }),
      ],
      NOW,
    );
    expect(row()).toMatchObject({
      company: 'Acme Robotics, Inc.',
      role: 'Staff Engineer',
      links: [],
      firstSeen: '2026-10-07',
      earlierNotes: 'Ask about on-call',
    });
    tracker.saveCollected([collected('acme--staff', { firstSeen: '2026-10-01' })], NOW);
    expect(row()?.firstSeen).toBe('2026-10-01');
  });
});

describe('updateJob', () => {
  it('dates a new status today, logs it, and sets the applied date', () => {
    expect(tracker.updateJob('acme--staff', { status: 'applied' }, AT)).toEqual({ ok: true });
    expect(row()).toMatchObject({ status: 'applied', statusOn: TODAY, appliedOn: TODAY });
    expect(history()).toEqual([['applied', TODAY]]);
  });

  it('backdates a status, and keeps an applied date the user gave', () => {
    tracker.updateJob(
      'acme--staff',
      { status: 'applied', statusOn: '2026-10-08', appliedOn: '2026-10-06' },
      AT,
    );
    expect(row()).toMatchObject({ statusOn: '2026-10-08', appliedOn: '2026-10-06' });
    expect(history()).toEqual([['applied', '2026-10-08']]);
  });

  it('saves the other fields, and clearing the status logs nothing', () => {
    tracker.updateJob('acme--staff', { status: 'passed' }, AT);
    tracker.updateJob(
      'acme--staff',
      {
        status: null,
        nextAction: 'Follow up',
        nextOn: '2026-10-14',
        earlierNotes: 'Recruiter: Sam',
        questions: ['Why Acme?', 'Notice period?'],
        archived: true,
      },
      AT,
    );
    expect(row()).toMatchObject({
      status: null,
      statusOn: null,
      nextAction: 'Follow up',
      nextOn: '2026-10-14',
      earlierNotes: 'Recruiter: Sam',
      questions: ['Why Acme?', 'Notice period?'],
      archived: true,
    });
    expect(history()).toEqual([['passed', TODAY]]);
  });

  it('logs nothing when the status stays the same', () => {
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    expect(history()).toHaveLength(1);
  });

  it('corrects when the current status started', () => {
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    tracker.updateJob('acme--staff', { statusOn: '2026-10-03' }, AT);
    expect(row()).toMatchObject({ statusOn: '2026-10-03', appliedOn: '2026-10-03' });
    expect(history()).toEqual([['applied', '2026-10-03']]);
  });

  it('refuses to date a status that comes from the skills', () => {
    const result = tracker.updateJob('acme--staff', { statusOn: '2026-10-03' }, AT);
    expect(result).toEqual({ ok: false, message: expect.stringContaining('Claude’s work') });
  });

  it('says so when the job is gone', () => {
    expect(tracker.updateJob('gone', { earlierNotes: 'x' }, AT)).toMatchObject({ ok: false });
  });
});

describe('addJob', () => {
  it('adds a job by hand with an ID from its company and role', () => {
    const first = tracker.addJob(
      {
        company: 'Harbor & Pine',
        role: 'Senior Engineer, Payments',
        link: 'https://harborpine.example/jobs/42',
        pay: '$155k–$185k',
        status: 'applied',
        notes: '  Referred by a friend  ',
      },
      AT,
    );
    expect(first).toEqual({ ok: true, jobId: 'harbor-and-pine--senior-engineer-payments' });
    expect(row('harbor-and-pine--senior-engineer-payments')).toMatchObject({
      manual: true,
      links: [{ url: 'https://harborpine.example/jobs/42', label: 'Posting' }],
      payText: '$155k–$185k',
      firstSeen: TODAY,
      status: 'applied',
      appliedOn: TODAY,
      earlierNotes: null,
    });
    expect(history('harbor-and-pine--senior-engineer-payments')).toEqual([['applied', TODAY]]);
    // What the user typed about it becomes its first note, dated today.
    expect(tracker.notes().get('harbor-and-pine--senior-engineer-payments')).toEqual([
      { id: expect.any(String), on: TODAY, text: 'Referred by a friend', at: NOW },
    ]);
    const second = tracker.addJob(
      { company: 'Harbor & Pine', role: 'Senior Engineer, Payments' },
      AT,
    );
    expect(second).toEqual({ ok: true, jobId: 'harbor-and-pine--senior-engineer-payments-2' });
  });

  it('needs a company, and a link that starts with http', () => {
    expect(tracker.addJob({ company: '  ' }, AT)).toMatchObject({ ok: false });
    expect(tracker.addJob({ company: 'Acme', link: 'javascript:alert(1)' }, AT)).toMatchObject({
      ok: false,
    });
  });
});

describe('calls', () => {
  it('moves the job forward when a call is booked', () => {
    tracker.updateJob('acme--staff', { status: 'applied', statusOn: '2026-10-01' }, AT);
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-13', atTime: '10:30' }, AT);
    expect(row()).toMatchObject({ status: 'screen', statusOn: TODAY });
    expect(tracker.calls().get('acme--staff')).toEqual([
      {
        id: expect.any(String),
        kind: 'screen',
        onDate: '2026-10-13',
        atTime: '10:30',
        state: 'scheduled',
        outcome: null,
        notes: null,
      },
    ]);
  });

  it('dates the move on the call’s own day when it’s logged afterward', () => {
    tracker.addCall('acme--staff', { kind: 'technical', onDate: '2026-10-08' }, AT);
    expect(row()).toMatchObject({ status: 'interview', statusOn: '2026-10-08' });
    expect(tracker.calls().get('acme--staff')?.[0]?.state).toBe('done');
  });

  it('never moves a job back, or out of a settled outcome', () => {
    tracker.updateJob('acme--staff', { status: 'offer' }, AT);
    tracker.addCall('acme--staff', { kind: 'screen', onDate: TODAY }, AT);
    expect(row()?.status).toBe('offer');
    tracker.updateJob('acme--staff', { status: 'rejected' }, AT);
    tracker.addCall('acme--staff', { kind: 'offer', onDate: TODAY }, AT);
    expect(row()?.status).toBe('rejected');
  });

  it('leaves the status alone for other kinds of calls', () => {
    tracker.addCall('acme--staff', { kind: 'other', onDate: TODAY }, AT);
    expect(row()?.status).toBeNull();
    expect(tracker.calls().get('acme--staff')).toHaveLength(1);
  });

  it('closes the job when a call’s outcome is "rejected", and deletes calls', () => {
    tracker.addCall('acme--staff', { kind: 'screen', onDate: TODAY }, AT);
    const [call] = tracker.calls().get('acme--staff') ?? [];
    const id = call?.id ?? '';
    tracker.updateCall(id, { state: 'done', outcome: 'rejected', notes: 'Wanted Rust' }, AT);
    expect(row()).toMatchObject({ status: 'rejected', statusOn: TODAY });
    expect(tracker.calls().get('acme--staff')?.[0]).toMatchObject({
      state: 'done',
      outcome: 'rejected',
      notes: 'Wanted Rust',
    });
    expect(history().map(([status]) => status)).toEqual(['screen', 'rejected']);
    tracker.deleteCall(id);
    expect(tracker.calls().get('acme--staff')).toBeUndefined();
    expect(tracker.updateCall(id, { state: 'done' }, AT)).toMatchObject({ ok: false });
  });
});

describe('history', () => {
  it('corrects when a change happened, and the dates that follow from it', () => {
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    const [change] = tracker.history().get('acme--staff') ?? [];
    tracker.redateChange(change?.id ?? '', '2026-10-02', NOW);
    expect(row()).toMatchObject({ statusOn: '2026-10-02', appliedOn: '2026-10-02' });
  });

  it('undoes the latest change, putting the job back where it was', () => {
    tracker.updateJob('acme--staff', { status: 'applied', statusOn: '2026-10-05' }, AT);
    tracker.updateJob('acme--staff', { status: 'ghosted' }, AT);
    const changes = tracker.history().get('acme--staff') ?? [];
    tracker.undoChange(changes[1]?.id ?? '', NOW);
    expect(row()).toMatchObject({ status: 'applied', statusOn: '2026-10-05' });
    tracker.undoChange(changes[0]?.id ?? '', NOW);
    expect(row()).toMatchObject({ status: null, statusOn: null, appliedOn: null });
    expect(tracker.undoChange('gone', NOW)).toMatchObject({ ok: false });
  });

  it('orders changes on the same day by when they were made', () => {
    tracker.updateJob('acme--staff', { status: 'applied' }, AT);
    tracker.updateJob('acme--staff', { status: 'screen' }, AT);
    const changes = tracker.history().get('acme--staff') ?? [];
    tracker.undoChange(changes[1]?.id ?? '', NOW);
    expect(row()?.status).toBe('applied');
  });
});

describe('the database file', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'factwright-tracker-'));
  });

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('keeps what the user tracked between openings', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { earlierNotes: 'Kept' }, AT);
    first.close();
    const second = new Tracker(file);
    expect(second.rows()[0]?.earlierNotes).toBe('Kept');
    expect(second.gainedColumns().size).toBe(0);
    second.close();
  });

  it('adds application questions to a tracker from before them, keeping the rest', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { earlierNotes: 'Kept' }, AT);
    first.close();
    // Back to the first version: no questions yet, nor anything since.
    const old = new DatabaseSync(file);
    old.exec(
      'DROP TABLE notes; ALTER TABLE jobs DROP COLUMN questions; ALTER TABLE jobs DROP COLUMN sent; ALTER TABLE jobs DROP COLUMN asks; PRAGMA user_version = 1;',
    );
    old.close();
    const second = new Tracker(file);
    expect(second.rows()[0]).toMatchObject({ earlierNotes: 'Kept', questions: [] });
    second.updateJob('acme--staff', { questions: ['Why Acme?'] }, AT);
    expect(second.rows()[0]?.questions).toEqual(['Why Acme?']);
    second.close();
  });

  it('adds answers sent and questions for Claude to a tracker from before them', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { questions: ['Why Acme?'] }, AT);
    first.close();
    const old = new DatabaseSync(file);
    old.exec(
      'DROP TABLE notes; ALTER TABLE jobs DROP COLUMN sent; ALTER TABLE jobs DROP COLUMN asks; PRAGMA user_version = 2;',
    );
    old.close();
    const second = new Tracker(file);
    expect(second.rows()[0]).toMatchObject({ questions: ['Why Acme?'], sent: [], asks: [] });
    second.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys, mostly.', AT);
    expect(second.rows()[0]?.sent).toEqual([
      { question: 'Why Acme?', nth: 0, text: 'Deploys, mostly.', on: TODAY, at: NOW },
    ]);
    // Sync fills the columns it gained from what other devices sent before, and reads every
    // change again for a table it made, such as notes.
    expect(second.gainedColumns()).toEqual(new Map([['jobs', ['sent', 'asks']]]));
    expect(second.gainedTables()).toEqual(['notes']);
    second.close();
  });

  it('adds dated notes to a tracker from before them, keeping the earlier notes', () => {
    const file = join(folder, 'tracker.db');
    const first = new Tracker(file);
    first.saveCollected([collected('acme--staff')], NOW);
    first.updateJob('acme--staff', { earlierNotes: 'From the old box' }, AT);
    first.close();
    const old = new DatabaseSync(file);
    old.exec('DROP TABLE notes; PRAGMA user_version = 3;');
    old.close();
    const second = new Tracker(file);
    expect(second.notes()).toEqual(new Map());
    expect(second.addNote('acme--staff', { text: 'Screen went well' }, AT)).toEqual({ ok: true });
    expect(second.rows()[0]?.earlierNotes).toBe('From the old box');
    expect(
      second
        .notes()
        .get('acme--staff')
        ?.map((note) => note.text),
    ).toEqual(['Screen went well']);
    expect(second.gainedColumns().size).toBe(0);
    expect(second.gainedTables()).toEqual(['notes']);
    second.close();
    // A tracker that's up to date, or new, made nothing.
    const third = new Tracker(file);
    expect(third.gainedTables()).toEqual([]);
    third.close();
    expect(new Tracker(':memory:').gainedTables()).toEqual([]);
  });
});

describe('notes', () => {
  const texts = () =>
    (tracker.notes().get('acme--staff') ?? []).map((note) => [note.on, note.text]);

  it('keeps each note dated today, or on the day given, oldest first', () => {
    tracker.addNote('acme--staff', { text: '  Screen with Sam: they want Go.  ' }, AT);
    tracker.addNote('acme--staff', { text: 'Applied through a referral', on: '2026-10-02' }, AT);
    tracker.addNote('acme--staff', { text: 'Asked about the band' }, AT);
    expect(texts()).toEqual([
      ['2026-10-02', 'Applied through a referral'],
      [TODAY, 'Screen with Sam: they want Go.'],
      [TODAY, 'Asked about the band'],
    ]);
  });

  it('changes a note’s words or day, and deletes one', () => {
    tracker.addNote('acme--staff', { text: 'Fist draft' }, AT);
    const [note] = tracker.notes().get('acme--staff') ?? [];
    const later = { today: TODAY, now: '2026-10-10T19:00:00.000Z' };
    expect(tracker.updateNote(note?.id ?? '', { text: 'First draft' }, later)).toEqual({
      ok: true,
    });
    expect(tracker.updateNote(note?.id ?? '', { on: '2026-10-08' }, later)).toEqual({ ok: true });
    expect(texts()).toEqual([['2026-10-08', 'First draft']]);
    // When it was written stays, and the row says when it last changed, for sync.
    expect(tracker.notes().get('acme--staff')?.[0]?.at).toBe(NOW);
    expect(tracker.syncRow('notes', note?.id ?? '')).toMatchObject({ updated_at: later.now });
    expect(tracker.deleteNote(note?.id ?? '')).toEqual({ ok: true });
    expect(texts()).toEqual([]);
  });

  it('refuses a blank note, and one for a job or note that’s gone', () => {
    expect(tracker.addNote('acme--staff', { text: '   ' }, AT)).toMatchObject({ ok: false });
    expect(tracker.addNote('gone', { text: 'Hi' }, AT)).toMatchObject({ ok: false });
    expect(tracker.updateNote('gone', { text: 'Hi' }, AT)).toMatchObject({ ok: false });
    tracker.addNote('acme--staff', { text: 'Keep me' }, AT);
    const [note] = tracker.notes().get('acme--staff') ?? [];
    expect(tracker.updateNote(note?.id ?? '', { text: ' ' }, AT)).toMatchObject({ ok: false });
    expect(texts()).toEqual([[TODAY, 'Keep me']]);
  });
});

describe('answers the user sent', () => {
  it('keeps each one, and replaces it in place when it changes', () => {
    tracker.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys.', AT);
    tracker.recordAnswer('acme--staff', 'Start date?', 0, 'Two weeks', AT);
    tracker.recordAnswer('acme--staff', '1. Why Acme? *', 0, 'Deploys, mostly.', {
      today: '2026-10-11',
      now: '2026-10-11T09:00:00.000Z',
    });
    expect(row()?.sent).toEqual([
      {
        question: '1. Why Acme? *',
        nth: 0,
        text: 'Deploys, mostly.',
        on: '2026-10-11',
        at: '2026-10-11T09:00:00.000Z',
      },
      { question: 'Start date?', nth: 0, text: 'Two weeks', on: TODAY, at: NOW },
    ]);
    // The second time a form asks a question, it keeps its own answer.
    tracker.recordAnswer('acme--staff', 'Start date?', 1, 'Monday', AT);
    expect(row()?.sent.map((answer) => [answer.text, answer.nth])).toEqual([
      ['Deploys, mostly.', 0],
      ['Two weeks', 0],
      ['Monday', 1],
    ]);
  });

  it('forgets one when its text is cleared', () => {
    tracker.recordAnswer('acme--staff', 'Why Acme?', 0, 'Deploys.', AT);
    tracker.recordAnswer('acme--staff', 'Why Acme?', 0, '  ', AT);
    expect(row()?.sent).toEqual([]);
  });

  it('says so when the job is gone, or the question has no words', () => {
    expect(tracker.recordAnswer('nope', 'Why?', 0, 'Because.', AT)).toMatchObject({ ok: false });
    expect(tracker.recordAnswer('acme--staff', '???', 0, 'Because.', AT)).toMatchObject({
      ok: false,
    });
  });
});

describe('questions for Claude', () => {
  it('keeps each question under an ID for its answer, unique on the same day', () => {
    const question = '  I have a 15 minute recruiter call. What should I expect?  ';
    expect(tracker.addAsk('acme--staff', question, AT)).toEqual({
      ok: true,
      askId: '2026-10-10-i-have-a-15-minute-recruiter',
    });
    expect(tracker.addAsk('acme--staff', question, AT)).toEqual({
      ok: true,
      askId: '2026-10-10-i-have-a-15-minute-recruiter-2',
    });
    expect(row()?.asks).toEqual([
      {
        id: '2026-10-10-i-have-a-15-minute-recruiter',
        question: 'I have a 15 minute recruiter call. What should I expect?',
        on: TODAY,
      },
      {
        id: '2026-10-10-i-have-a-15-minute-recruiter-2',
        question: 'I have a 15 minute recruiter call. What should I expect?',
        on: TODAY,
      },
    ]);
  });

  it('forgets a question, and needs one to keep', () => {
    tracker.addAsk('acme--staff', 'What’s their stack?', AT);
    tracker.removeAsk('acme--staff', '2026-10-10-what-s-their-stack', AT);
    expect(row()?.asks).toEqual([]);
    expect(tracker.addAsk('acme--staff', '   ', AT)).toEqual({
      ok: false,
      message: 'Type your question first.',
    });
    expect(tracker.addAsk('nope', 'Why?', AT)).toMatchObject({ ok: false });
  });
});

describe('sync', () => {
  it('lists every row of the tables that sync, as stored', () => {
    tracker.updateJob('acme--staff', { status: 'applied', earlierNotes: 'Sent' }, AT);
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-12' }, AT);
    const rows = tracker.syncRows();
    expect(rows.map((each) => each.table)).toEqual(['jobs', 'status_log', 'status_log', 'calls']);
    expect(rows[0]).toMatchObject({
      id: 'acme--staff',
      row: { company: 'Acme Robotics', status: 'screen', notes: 'Sent', archived: 0 },
    });
    expect(tracker.syncRow('jobs', 'acme--staff')).toEqual(rows[0]?.row);
    expect(tracker.syncRow('jobs', 'nobody')).toBeNull();
  });

  it('puts rows as another device left them, jobs before their calls', () => {
    tracker.updateJob('acme--staff', { status: 'applied', earlierNotes: 'Sent' }, AT);
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-12' }, AT);
    tracker.addNote('acme--staff', { text: 'Screen went well' }, AT);
    const other = new Tracker(':memory:');
    for (const { table, id, row } of tracker.syncRows()) other.applySyncRow(table, id, row);
    expect(other.rows()).toEqual(tracker.rows());
    expect(other.calls()).toEqual(tracker.calls());
    expect(other.history()).toEqual(tracker.history());
    expect(other.notes()).toEqual(tracker.notes());
    other.close();
  });

  it('writes only the columns this version knows, and keeps those a row lacks', () => {
    tracker.updateJob('acme--staff', { questions: ['Why Acme?'], earlierNotes: 'Before' }, AT);
    const stored = tracker.syncRow('jobs', 'acme--staff') ?? {};
    const { questions: _, ...fromOlderApp } = stored;
    tracker.applySyncRow('jobs', 'acme--staff', {
      ...fromOlderApp,
      notes: 'After',
      salary_band: 'From a newer app',
    });
    expect(row()).toMatchObject({ earlierNotes: 'After', questions: ['Why Acme?'] });
  });

  it('removes a row, and a job’s calls and history go with it', () => {
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-12' }, AT);
    const [call] = tracker.calls().get('acme--staff') ?? [];
    tracker.applySyncRow('calls', call?.id ?? '', null);
    expect(tracker.calls().get('acme--staff')).toBeUndefined();
    tracker.addCall('acme--staff', { kind: 'screen', onDate: '2026-10-12' }, AT);
    tracker.applySyncRow('jobs', 'acme--staff', null);
    expect(tracker.rows()).toEqual([]);
    expect(tracker.syncRows()).toEqual([]);
  });

  it('refuses a call for a job it doesn’t have yet', () => {
    expect(() =>
      tracker.applySyncRow('calls', 'call-1', {
        id: 'call-1',
        job_id: 'nobody',
        kind: 'screen',
        on_date: '2026-10-12',
        state: 'scheduled',
        created_at: NOW,
      }),
    ).toThrow();
  });
});
