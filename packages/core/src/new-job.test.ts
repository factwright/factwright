import { describe, expect, it } from 'vitest';
import { JOB_LIMITS, jobIdFor, newJobRows } from './new-job.ts';

describe('a new job', () => {
  it('takes its ID from its company and role, as Add job does', () => {
    expect(jobIdFor('Acme Robotics, Inc.', 'Staff Engineer (Remote)')).toBe(
      'acme-robotics--staff-engineer',
    );
    expect(jobIdFor('Acme', '')).toBe('acme--general');
    expect(jobIdFor('', '')).toBe('job--general');
  });

  it('starts with every column the app’s tracker keeps, and its history', () => {
    const rows = newJobRows({
      id: 'acme--staff-engineer',
      company: ' Acme ',
      role: 'Staff Engineer',
      link: 'https://acme.example/jobs/42',
      pay: '$200k',
      status: 'new',
      today: '2026-10-15',
      now: '2026-10-15T20:00:00.000Z',
      statusId: 'status-1',
    });
    expect(rows.job).toEqual({
      id: 'acme--staff-engineer',
      company: 'Acme',
      company_key: 'acme',
      role: 'Staff Engineer',
      links: '[{"url":"https://acme.example/jobs/42","label":"Posting"}]',
      manual: 1,
      pay_text: '$200k',
      first_seen: '2026-10-15',
      status: 'new',
      status_on: '2026-10-15',
      applied_on: null,
      next_action: null,
      next_on: null,
      notes: null,
      archived: 0,
      updated_at: '2026-10-15T20:00:00.000Z',
      questions: '[]',
      sent: '[]',
      asks: '[]',
      back_on: null,
      pass_reason: null,
      kind: null,
    });
    expect(rows.status).toEqual({
      id: 'status-1',
      job_id: 'acme--staff-engineer',
      status: 'new',
      at: '2026-10-15',
    });
  });

  it('keeps each field within what the app takes', () => {
    const rows = newJobRows({
      id: 'x--y',
      company: 'c'.repeat(500),
      role: 'r'.repeat(500),
      link: `https://a.example/${'l'.repeat(3000)}`,
      pay: '',
      status: 'new',
      today: '2026-10-15',
      now: '2026-10-15T20:00:00.000Z',
      statusId: 's',
    });
    expect(String(rows.job.company)).toHaveLength(JOB_LIMITS.company);
    expect(String(rows.job.role)).toHaveLength(JOB_LIMITS.role);
    expect(JSON.parse(String(rows.job.links))[0].url).toHaveLength(JOB_LIMITS.link);
    expect(rows.job.pay_text).toBeNull();
  });
});
