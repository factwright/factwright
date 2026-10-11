import { describe, expect, it } from 'vitest';
import type { Job } from './jobs.ts';
import { journeyCsv, journeyFlowChart, journeyOf, journeySummary, journeys } from './journey.ts';
import { jobProgress } from './progress.ts';
import type { Call } from './tracker.ts';

const TODAY = '2026-10-10';

function job(extra: Partial<Job> = {}): Job {
  return {
    id: 'acme--staff',
    company: 'Acme Robotics',
    companyKey: 'acme-robotics',
    role: 'Staff Engineer',
    link: 'https://jobs.example/acme',
    links: [],
    location: null,
    pay: null,
    source: 'HN October 2026',
    fit: null,
    search: null,
    folder: null,
    stage: 'new',
    firstSeen: '2026-09-01',
    lastActivity: '2026-09-01',
    summary: null,
    events: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    files: [],
    status: null,
    statusOn: null,
    appliedOn: null,
    nextAction: null,
    nextOn: null,
    notes: null,
    questions: [],
    archived: false,
    manual: false,
    calls: [],
    statusLog: [],
    docKinds: [],
    ...extra,
  };
}

const call = (kind: Call['kind'], onDate: string, extra: Partial<Call> = {}): Call => ({
  id: `${kind}-${onDate}`,
  kind,
  onDate,
  atTime: null,
  state: 'done',
  outcome: null,
  notes: null,
  ...extra,
});

const journey = (extra: Partial<Job>) => {
  const each = job(extra);
  return journeyOf(each, jobProgress(each, TODAY));
};

/** A job that went all the way: checked, resume, applied, screen, interviews, final, offer. */
const FULL = {
  stage: 'resume' as const,
  fit: { verdict: 'Strong', score: 86, date: '2026-09-03' },
  folder: 'acme',
  files: [{ path: 'a.pdf', name: 'a.pdf', format: 'pdf' as const, size: 1, modified: '' }],
  events: [
    { id: 'f', tool: 'fit-check' as const, date: '2026-09-03', title: 'Fit check: Strong 86' },
    { id: 'r', tool: 'resume' as const, date: '2026-09-04', title: 'Resume built' },
  ],
  status: 'offer' as const,
  statusOn: '2026-10-05',
  appliedOn: '2026-09-05',
  statusLog: [
    { id: '1', status: 'applied' as const, at: '2026-09-05' },
    { id: '2', status: 'offer' as const, at: '2026-10-05' },
  ],
  calls: [
    call('screen', '2026-09-12'),
    call('technical', '2026-09-20'),
    call('final', '2026-09-28'),
    call('panel', '2026-09-24', { state: 'canceled' }),
  ],
};

describe('journeyOf', () => {
  it('dates every step a job reached', () => {
    expect(journey(FULL)).toMatchObject({
      dates: {
        found: '2026-09-01',
        checked: '2026-09-03',
        resume: '2026-09-04',
        applied: '2026-09-05',
        screen: '2026-09-12',
        interview: '2026-09-20',
        final: '2026-09-28',
        offer: '2026-10-05',
      },
      outcome: 'In progress',
      outcomeOn: null,
    });
  });

  it('notes how a job ended, and steps reached on unknown dates', () => {
    const rejected = journey({
      status: 'rejected',
      statusOn: '2026-09-20',
      statusLog: [{ id: '1', status: 'rejected', at: '2026-09-20' }],
    });
    // A job that got as far as applying counts as checked, as in the original dashboard.
    expect(rejected.stages).toEqual(['found', 'checked', 'applied']);
    expect(rejected.dates.applied).toBe('');
    expect(rejected).toMatchObject({ outcome: 'Rejected', outcomeOn: '2026-09-20' });
    expect(journey({}).outcome).toBe('Not applied');
    expect(journey({ status: 'ghosted', appliedOn: '2026-08-01' }).outcome).toBe('No response');
  });
});

describe('journeys and the summary', () => {
  const list = journeys(
    [
      job(FULL),
      job({ id: 'b', status: 'rejected', appliedOn: '2026-09-02' }),
      job({ id: 'c', stage: 'checked', fit: { verdict: 'Good', score: 70, date: '2026-09-02' } }),
      job({ id: 'd', status: 'applied', appliedOn: '2026-09-09' }),
      job({ id: 'outreach', role: '' }),
    ].map((each) => ({ job: each, progress: jobProgress(each, TODAY) })),
  );

  it('leaves out messages to a company, which aren’t jobs', () => {
    expect(list.map((each) => each.job.id)).toEqual(['acme--staff', 'b', 'c', 'd']);
  });

  it('counts how far jobs got, and how they ended', () => {
    expect(journeySummary(list)).toEqual({
      found: 4,
      checked: 4,
      resume: 1,
      applied: 3,
      heardBack: 2,
      interviewed: 1,
      offers: 1,
      outcomes: { 'In progress': 2, Rejected: 1, 'Not applied': 1 },
    });
  });

  it('writes the flow chart for SankeyMATIC', () => {
    expect(journeyFlowChart(list, TODAY).split('\n')).toEqual([
      '// Job-search journey, October 2026',
      'Jobs found [4] Checked',
      'Checked [1] Resume built',
      'Resume built [1] Applied',
      'Applied [1] Recruiter screen',
      'Recruiter screen [1] Interviews',
      'Interviews [1] Final round',
      'Final round [1] Offer',
      'Offer [1] In progress',
      'Checked [2] Applied',
      'Applied [1] Rejected',
      'Checked [1] Not applied',
      'Applied [1] In progress',
      '',
      ':Offer #23824a',
      ':Rejected #bb2d2d',
      ':Not applied #c4c2b9',
      ':In progress #2a66d0',
    ]);
  });
});

describe('journeyCsv', () => {
  it('writes a row per job, with each step’s date', () => {
    const csv = journeyCsv([journey(FULL)]);
    expect(csv.startsWith('﻿')).toBe(true);
    const [head, row] = csv.slice(1).split('\r\n');
    expect(head).toBe(
      'Company,Role,Source,Jobs found,Checked,Resume built,Applied,Recruiter screen,Interviews,Final round,Offer,Outcome,Outcome date,Link',
    );
    expect(row).toBe(
      'Acme Robotics,Staff Engineer,HN October 2026,2026-09-01,2026-09-03,2026-09-04,2026-09-05,2026-09-12,2026-09-20,2026-09-28,2026-10-05,In progress,,https://jobs.example/acme',
    );
  });

  it('quotes commas and quotes, and stops spreadsheets from running text as formulas', () => {
    const [, row] = journeyCsv([
      journey({ company: '=HYPERLINK("x")', role: 'Engineer, "Platform"' }),
    ])
      .slice(1)
      .split('\r\n');
    expect(row?.startsWith(`"'=HYPERLINK(""x"")","Engineer, ""Platform""",`)).toBe(true);
  });
});
