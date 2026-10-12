import { describe, expect, it } from 'vitest';
import { phoneRows, startingView, viewCounts, visible } from './jobs.ts';
import { job } from './testing.ts';

const TODAY = '2026-10-10';

const JOBS = [
  job({
    id: 'acme--staff',
    company: 'Acme Robotics',
    status: 'applied',
    statusOn: '2026-10-09',
    appliedOn: '2026-10-09',
    notes: 'Recruiter: Sam Lee',
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
    expect(companies(visible(rows, 'active', ''))).toEqual([
      'Birch Health',
      'Fable Co',
      'Acme Robotics',
    ]);
    expect(companies(visible(rows, 'review', ''))).toEqual(['Cobalt']);
    expect(companies(visible(rows, 'closed', ''))).toEqual(['Delta Freight']);
    expect(viewCounts(rows)).toEqual({ active: 3, review: 1, applied: 3, closed: 1, all: 5 });
  });

  it('searches companies, roles and notes, for every word typed', () => {
    const rows = phoneRows(JOBS, TODAY);
    expect(companies(visible(rows, 'all', 'recruiter  SAM'))).toEqual(['Acme Robotics']);
    expect(companies(visible(rows, 'all', 'lead'))).toEqual(['Birch Health']);
    expect(companies(visible(rows, 'all', 'acme lead'))).toEqual([]);
    expect(visible(rows, 'all', '  ')).toHaveLength(5);
  });

  it('opens on the active jobs, or on those to review before any are active', () => {
    expect(startingView(phoneRows(JOBS, TODAY))).toBe('active');
    expect(startingView(phoneRows([job({ id: 'cobalt--senior', company: 'Cobalt' })], TODAY))).toBe(
      'review',
    );
  });
});
