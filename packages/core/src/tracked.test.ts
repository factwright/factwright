import { describe, expect, it } from 'vitest';
import type { CollectedJob } from './jobs.ts';
import {
  byJob,
  callOrder,
  changeOrder,
  jobList,
  noteOrder,
  type TrackedItems,
  trackedCall,
  trackedChange,
  trackedNote,
  trackedRow,
} from './tracked.ts';
import type { Note } from './tracker.ts';

const NOTHING_KEPT: TrackedItems = { calls: new Map(), history: new Map(), notes: new Map() };

const NOTE: Note = {
  id: 'n1',
  on: '2026-10-12',
  text: 'Screen with Sam: they want Go.',
  at: '2026-10-12T19:00:00.000Z',
};

const STORED_JOB = {
  id: 'acme--staff',
  company: 'Acme Robotics',
  company_key: 'acme-robotics',
  role: 'Staff Engineer',
  links: JSON.stringify([{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }]),
  manual: 0,
  pay_text: null,
  first_seen: '2026-10-07',
  status: 'applied',
  status_on: '2026-10-10',
  applied_on: '2026-10-10',
  next_action: null,
  next_on: null,
  notes: 'Recruiter: Sam',
  questions: JSON.stringify(['Why Acme?']),
  sent: JSON.stringify([{ question: 'Why Acme?', text: 'Deploys, mostly.', on: '2026-10-10' }]),
  asks: JSON.stringify([
    { id: '2026-10-12-what-should-i-expect', question: 'What should I expect?', on: '2026-10-12' },
  ]),
  archived: 0,
  updated_at: '2026-10-10T18:00:00.000Z',
};

describe('tracker rows', () => {
  it('read a job, a call and a change of status as stored', () => {
    expect(trackedRow(STORED_JOB)).toMatchObject({
      id: 'acme--staff',
      companyKey: 'acme-robotics',
      links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
      manual: false,
      status: 'applied',
      earlierNotes: 'Recruiter: Sam',
      questions: ['Why Acme?'],
      sent: [{ question: 'Why Acme?', text: 'Deploys, mostly.', on: '2026-10-10' }],
      asks: [
        {
          id: '2026-10-12-what-should-i-expect',
          question: 'What should I expect?',
          on: '2026-10-12',
        },
      ],
      archived: false,
    });
    expect(
      trackedCall({ id: 'c1', kind: 'screen', on_date: '2026-10-14', state: 'scheduled' }),
    ).toEqual({
      id: 'c1',
      kind: 'screen',
      onDate: '2026-10-14',
      atTime: null,
      state: 'scheduled',
      outcome: null,
      notes: null,
    });
    expect(trackedChange({ id: 's1', status: 'applied', at: '2026-10-10' })).toEqual({
      id: 's1',
      status: 'applied',
      at: '2026-10-10',
    });
  });

  it('leave out what a newer app wrote that this one doesn’t know', () => {
    expect(trackedRow({ ...STORED_JOB, status: 'something-new', links: 'not json' })).toMatchObject(
      {
        status: null,
        links: [],
      },
    );
    expect(
      trackedCall({ id: 'c1', kind: 'hologram', on_date: '2026-10-14', state: 'done' }),
    ).toBeNull();
    expect(trackedChange({ id: 's1', status: 'teleported', at: '2026-10-10' })).toBeNull();
  });

  it('read the kind of job the user put a job under, leaving out one that isn’t an id', () => {
    expect(trackedRow({ ...STORED_JOB, kind: 'project-manager' }).kind).toBe('project-manager');
    expect(trackedRow(STORED_JOB).kind).toBeNull();
    expect(trackedRow({ ...STORED_JOB, kind: '../base' }).kind).toBeNull();
  });

  it('leave out answers and questions that don’t read, keeping the rest', () => {
    const row = trackedRow({
      ...STORED_JOB,
      sent: JSON.stringify([
        { question: 'Why Acme?', text: 'Deploys.', on: 'yesterday' },
        { question: 'Start date?', text: 'Two weeks', on: '2026-10-10' },
        'Why Acme?',
      ]),
      asks: JSON.stringify([
        { id: '../../outside', question: 'Escape?', on: '2026-10-12' },
        { id: '2026-10-12-culture', question: 'What’s the culture like?', on: '2026-10-12' },
      ]),
    });
    expect(row.sent).toEqual([
      { question: 'Start date?', nth: 0, text: 'Two weeks', on: '2026-10-10', at: '2026-10-10' },
    ]);
    expect(row.asks.map((ask) => ask.id)).toEqual(['2026-10-12-culture']);
    // Two devices answered the same question: the later answer stands, and a repeated
    // question's second box keeps its own.
    const twice = trackedRow({
      ...STORED_JOB,
      sent: JSON.stringify([
        { question: 'Why Acme?', text: 'Later', on: '2026-10-11', at: '2026-10-11T10:00:00Z' },
        { question: 'Why Acme?', text: 'Earlier', on: '2026-10-11', at: '2026-10-11T09:00:00Z' },
        { question: 'If yes, explain.', nth: 1, text: 'Second box', on: '2026-10-11' },
      ]),
    });
    expect(twice.sent.map((answer) => [answer.text, answer.nth])).toEqual([
      ['Later', 0],
      ['Second box', 1],
    ]);
    expect(trackedRow({ ...STORED_JOB, sent: undefined, asks: 'not json' })).toMatchObject({
      sent: [],
      asks: [],
    });
  });

  it('group by job, in the order calls happen and statuses change', () => {
    const calls = [
      { id: 'b', job_id: 'acme', kind: 'panel', on_date: '2026-10-20', state: 'scheduled' },
      { id: 'a', job_id: 'acme', kind: 'screen', on_date: '2026-10-14', state: 'done' },
    ].sort(callOrder);
    expect(
      byJob(calls, trackedCall)
        .get('acme')
        ?.map((call) => call.id),
    ).toEqual(['a', 'b']);
    const changes = [
      { id: '2', job_id: 'acme', status: 'screen', at: '2026-10-14' },
      { id: '1', job_id: 'acme', status: 'applied', at: '2026-10-14' },
    ].sort(changeOrder);
    expect(changes.map((change) => change.status)).toEqual(['applied', 'screen']);
  });

  it('read notes by the day they’re about, then when they were written, leaving out blank ones', () => {
    const notes = [
      { id: 'c', job_id: 'acme', on_date: '2026-10-12', text: 'Later', created_at: 'T2' },
      { id: 'b', job_id: 'acme', on_date: '2026-10-12', text: 'Earlier', created_at: 'T1' },
      { id: 'a', job_id: 'acme', on_date: '2026-10-09', text: 'Before', created_at: 'T9' },
      { id: 'd', job_id: 'acme', on_date: '2026-10-12', text: '  ', created_at: 'T3' },
      { id: 'e', job_id: 'acme', on_date: 'someday', text: 'Undated', created_at: 'T4' },
    ].sort(noteOrder);
    expect(
      byJob(notes, trackedNote)
        .get('acme')
        ?.map((note) => note.text),
    ).toEqual(['Before', 'Earlier', 'Later']);
    expect(trackedNote(notes[0] as Record<string, unknown>)).toEqual({
      id: 'a',
      on: '2026-10-09',
      text: 'Before',
      at: 'T9',
    });
  });
});

describe('jobList', () => {
  const found = {
    id: 'acme--staff',
    company: 'Acme Robotics',
    role: 'Staff Engineer',
    docs: { posting: 'applications/acme/posting.md' },
    pay: null,
    source: 'Fit check',
  } as unknown as CollectedJob;

  it('joins each tracked job with what the workspace says about it', () => {
    const [job] = jobList([trackedRow(STORED_JOB)], new Map([['acme--staff', found]]), {
      ...NOTHING_KEPT,
      notes: new Map([['acme--staff', [NOTE]]]),
    });
    expect(job).toMatchObject({
      id: 'acme--staff',
      status: 'applied',
      earlierNotes: 'Recruiter: Sam',
      notes: [NOTE],
      source: 'Fit check',
      docKinds: ['posting'],
    });
  });

  it('keeps a job whose files are gone only while something about it is tracked', () => {
    const untracked = trackedRow({
      ...STORED_JOB,
      status: null,
      applied_on: null,
      notes: null,
      questions: '[]',
      sent: '[]',
      asks: '[]',
    });
    expect(jobList([untracked], new Map(), NOTHING_KEPT)).toEqual([]);
    // A dated note keeps it, as a call does.
    expect(
      jobList([untracked], new Map(), {
        ...NOTHING_KEPT,
        notes: new Map([['acme--staff', [NOTE]]]),
      }),
    ).toHaveLength(1);
    for (const kept of [{ sent: STORED_JOB.sent }, { asks: STORED_JOB.asks }, { kind: 'pm' }]) {
      const row = trackedRow({
        ...STORED_JOB,
        status: null,
        applied_on: null,
        notes: null,
        questions: '[]',
        sent: '[]',
        asks: '[]',
        ...kept,
      });
      expect(jobList([row], new Map(), NOTHING_KEPT)).toHaveLength(1);
    }
    const [kept] = jobList([trackedRow(STORED_JOB)], new Map(), NOTHING_KEPT);
    expect(kept).toMatchObject({
      id: 'acme--staff',
      folder: null,
      link: 'https://jobs.ashbyhq.com/acme/7f3a',
    });
  });

  it('shows a job added by hand with the pay the user typed', () => {
    const typed = trackedRow({ ...STORED_JOB, manual: 1, pay_text: '$150k–$180k' });
    const [job] = jobList([typed], new Map(), NOTHING_KEPT);
    expect(job).toMatchObject({ source: 'Added by hand', pay: { min: 150000, max: 180000 } });
  });
});
