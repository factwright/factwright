import { describe, expect, it } from 'vitest';
import type { CollectedJob } from './jobs.ts';
import {
  byJob,
  callOrder,
  changeOrder,
  jobList,
  trackedCall,
  trackedChange,
  trackedRow,
} from './tracked.ts';

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
      notes: 'Recruiter: Sam',
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
    expect(row.sent).toEqual([{ question: 'Start date?', text: 'Two weeks', on: '2026-10-10' }]);
    expect(row.asks.map((ask) => ask.id)).toEqual(['2026-10-12-culture']);
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
    const [job] = jobList(
      [trackedRow(STORED_JOB)],
      new Map([['acme--staff', found]]),
      new Map(),
      new Map(),
    );
    expect(job).toMatchObject({
      id: 'acme--staff',
      status: 'applied',
      notes: 'Recruiter: Sam',
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
    expect(jobList([untracked], new Map(), new Map(), new Map())).toEqual([]);
    for (const kept of [{ sent: STORED_JOB.sent }, { asks: STORED_JOB.asks }]) {
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
      expect(jobList([row], new Map(), new Map(), new Map())).toHaveLength(1);
    }
    const [kept] = jobList([trackedRow(STORED_JOB)], new Map(), new Map(), new Map());
    expect(kept).toMatchObject({
      id: 'acme--staff',
      folder: null,
      link: 'https://jobs.ashbyhq.com/acme/7f3a',
    });
  });

  it('shows a job added by hand with the pay the user typed', () => {
    const typed = trackedRow({ ...STORED_JOB, manual: 1, pay_text: '$150k–$180k' });
    const [job] = jobList([typed], new Map(), new Map(), new Map());
    expect(job).toMatchObject({ source: 'Added by hand', pay: { min: 150000, max: 180000 } });
  });
});
