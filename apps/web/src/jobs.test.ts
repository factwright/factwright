import { describe, expect, it } from 'vitest';
import { ofKind, phoneRows, setAside, startingView, viewCounts, visible } from './jobs.ts';
import { job } from './testing.ts';

const TODAY = '2026-10-10';

const JOBS = [
  job({
    id: 'acme--staff',
    company: 'Acme Robotics',
    status: 'applied',
    statusOn: '2026-10-09',
    appliedOn: '2026-10-09',
    notes: [{ id: 'n1', on: '2026-10-09', text: 'Recruiter: Sam Lee', at: '2026-10-09T17:00Z' }],
  }),
  job({
    id: 'birch--lead',
    company: 'Birch Health',
    role: 'Engineering Lead',
    status: 'screen',
    statusOn: '2026-10-08',
    nextAction: 'Send references',
    nextOn: '2026-10-07',
  }),
  job({
    id: 'cobalt--senior',
    company: 'Cobalt',
    role: 'Senior Engineer',
    lastActivity: '2026-10-05',
  }),
  job({ id: 'delta--staff', company: 'Delta Freight', status: 'rejected', statusOn: '2026-10-02' }),
  job({ id: 'echo--staff', company: 'Echo Labs', status: 'applied', archived: true }),
  job({
    id: 'fable--staff',
    company: 'Fable Co',
    status: 'applied',
    statusOn: '2026-09-28',
    appliedOn: '2026-09-28',
  }),
];

const companies = (rows: { job: { company: string } }[]) => rows.map((row) => row.job.company);

describe('the phone’s job list', () => {
  it('puts what needs the user first, then what happened most recently', () => {
    const rows = phoneRows(JOBS, TODAY);
    expect(companies(rows)).toEqual([
      'Birch Health',
      'Fable Co',
      'Acme Robotics',
      'Cobalt',
      'Delta Freight',
    ]);
    expect(rows[0]?.next).toEqual({ level: 'urgent', text: 'Overdue: Send references' });
    expect(rows[1]?.next).toEqual({ level: 'action', text: 'Applied 12 days ago. Follow up?' });
    expect(rows[2]?.next).toEqual({ level: 'info', text: 'Applied yesterday' });
  });

  it('puts each job under a kind of job, for a user who wants more than one', () => {
    const kinds = [
      { id: 'developer', name: 'Developer' },
      { id: 'project-manager', name: 'Project manager' },
    ];
    const jobs = JOBS.map((each) =>
      each.id === 'birch--lead' ? { ...each, kind: 'project-manager' } : each,
    );
    const rows = phoneRows(jobs, TODAY, kinds);
    expect(companies(ofKind(rows, 'project-manager'))).toEqual(['Birch Health']);
    expect(ofKind(rows, 'developer')).toHaveLength(4);
    expect(ofKind(rows, null)).toHaveLength(5);
    expect(phoneRows(jobs, TODAY).every((row) => row.kind === null)).toBe(true);
  });

  it('leaves archived jobs out', () => {
    expect(companies(phoneRows(JOBS, TODAY))).not.toContain('Echo Labs');
  });

  it('goes by name when nothing else tells two jobs apart', () => {
    const rows = phoneRows(
      [job({ id: 'zeta--staff', company: 'Zeta' }), job({ id: 'alpha--staff', company: 'Alpha' })],
      TODAY,
    );
    expect(companies(rows)).toEqual(['Alpha', 'Zeta']);
  });

  it('shows each view’s jobs, and counts them', () => {
    const rows = phoneRows(JOBS, TODAY);
    expect(companies(visible(rows, 'applied', ''))).toEqual(['Fable Co', 'Acme Robotics']);
    expect(companies(visible(rows, 'interviewing', ''))).toEqual(['Birch Health']);
    expect(companies(visible(rows, 'new', ''))).toEqual(['Cobalt']);
    expect(companies(visible(rows, 'closed', ''))).toEqual(['Delta Freight']);
    expect(viewCounts(rows)).toEqual({
      new: 1,
      review: 0,
      apply: 0,
      applied: 2,
      interviewing: 1,
      closed: 1,
      all: 5,
    });
  });

  it('keeps the jobs set aside at the bottom of To review, outside its count, until their day', () => {
    const rows = phoneRows(
      [
        job({ id: 'kite--staff', company: 'Kite', status: 'review' }),
        job({ id: 'lark--staff', company: 'Lark', status: 'later', backOn: '2026-10-20' }),
        job({ id: 'moth--staff', company: 'Moth', status: 'later' }),
        job({ id: 'newt--staff', company: 'Newt', status: 'later', backOn: TODAY }),
      ],
      TODAY,
    );
    expect(companies(visible(rows, 'review', ''))).toEqual(['Newt', 'Kite']);
    expect(companies(setAside(rows, 'review', ''))).toEqual(['Lark', 'Moth']);
    expect(setAside(rows, 'all', '')).toEqual([]);
    expect(viewCounts(rows)).toMatchObject({ review: 2, all: 4 });
  });

  it('searches companies, roles and notes, for every word typed', () => {
    const rows = phoneRows(JOBS, TODAY);
    expect(companies(visible(rows, 'all', 'recruiter  SAM'))).toEqual(['Acme Robotics']);
    const earlier = phoneRows(
      [job({ id: 'g--s', company: 'Gale', earlierNotes: 'Met Priya' })],
      TODAY,
    );
    expect(companies(visible(earlier, 'all', 'priya'))).toEqual(['Gale']);
    expect(companies(visible(rows, 'all', 'lead'))).toEqual(['Birch Health']);
    expect(companies(visible(rows, 'all', 'acme lead'))).toEqual([]);
    expect(visible(rows, 'all', '  ')).toHaveLength(5);
  });

  it('opens on the furthest view with jobs in it, or on the new ones', () => {
    expect(startingView(phoneRows(JOBS, TODAY))).toBe('interviewing');
    expect(startingView(phoneRows([job({ id: 'cobalt--senior', company: 'Cobalt' })], TODAY))).toBe(
      'new',
    );
    // Jobs set aside, folded away, don't make it open on an empty To review.
    const aside = phoneRows(
      [
        job({ id: 'cobalt--senior', company: 'Cobalt' }),
        job({ id: 'lark--staff', company: 'Lark', status: 'later' }),
      ],
      TODAY,
    );
    expect(startingView(aside)).toBe('new');
    // With only jobs set aside, To review shows them, folded.
    expect(startingView(aside.filter((row) => row.job.status === 'later'))).toBe('review');
  });
});
