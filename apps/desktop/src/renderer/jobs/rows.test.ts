import { localDate } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import { fileSize, payLabel, shortDate } from './format.ts';
import {
  filterCount,
  jobRows,
  NO_FILTERS,
  sources,
  startingView,
  viewCounts,
  visibleRows,
} from './rows.ts';
import { sampleJobs } from './sample-jobs.ts';

const TODAY = localDate();
const rows = jobRows(sampleJobs(), TODAY);
const ALL = { view: 'all', query: '', needsYou: false, ...NO_FILTERS } as const;
const companies = (list: readonly { job: { company: string } }[]) =>
  list.map((row) => row.job.company);

describe('visibleRows', () => {
  it('shows each view’s jobs, most recent activity first', () => {
    expect(companies(visibleRows(rows, { ...ALL, view: 'review' }))).toEqual([
      'Bluewave Staffing',
      'Copperleaf Energy',
    ]);
    // Meridian and Orchard last changed on the same day, so they go by name.
    expect(companies(visibleRows(rows, { ...ALL, view: 'closed' }))).toEqual([
      'Sable Systems',
      'Meridian Freight',
      'Orchard Health',
    ]);
    const active = visibleRows(rows, { ...ALL, view: 'active' });
    const dates = active.map((row) => row.progress.lastActivity ?? '');
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('searches company, role, notes and status, every word', () => {
    expect(companies(visibleRows(rows, { ...ALL, query: 'payments' }))).toEqual(['Harbor & Pine']);
    expect(companies(visibleRows(rows, { ...ALL, query: 'referred TEAMMATE' }))).toEqual([
      'Harbor & Pine',
    ]);
    expect(companies(visibleRows(rows, { ...ALL, query: 'no reply' }))).toEqual(['Sable Systems']);
    expect(visibleRows(rows, { ...ALL, query: 'payments zebra' })).toEqual([]);
  });

  it('narrows to the jobs that need the user', () => {
    const needed = visibleRows(rows, { ...ALL, needsYou: true });
    expect(needed.length).toBeGreaterThan(0);
    expect(needed.every((row) => row.progress.attention)).toBe(true);
  });

  it('leaves archived jobs out, unless the filters show them', () => {
    const archived = jobRows(
      sampleJobs().map((job) => ({ ...job, archived: true })),
      TODAY,
    );
    expect(visibleRows(archived, ALL)).toEqual([]);
    expect(visibleRows(archived, { ...ALL, showArchived: true })).toHaveLength(12);
  });

  it('filters by fit, source, pay and resumes', () => {
    expect(companies(visibleRows(rows, { ...ALL, tiers: ['strong'] }))).toEqual([
      'Fernway',
      'Northwind Labs',
      'Tidewater Analytics',
    ]);
    expect(companies(visibleRows(rows, { ...ALL, tiers: ['none'] }))).toEqual([
      'Bluewave Staffing',
      'Sable Systems',
    ]);
    // The top of the range counts: Lumen's $160k–$190k pays at least $190k.
    expect(companies(visibleRows(rows, { ...ALL, minPay: 190_000 }))).toEqual([
      'Acme Robotics',
      'Fernway',
      'Copperleaf Energy',
      'Northwind Labs',
      'Lumen Health',
    ]);
    expect(visibleRows(rows, { ...ALL, hasResume: true })).toHaveLength(5);
    expect(visibleRows(rows, { ...ALL, source: 'Added by hand' })).toEqual([]);
  });
});

describe('filterCount and sources', () => {
  it('counts the filters that are on, and lists where jobs came from', () => {
    expect(filterCount(ALL)).toBe(0);
    expect(filterCount({ ...ALL, tiers: ['strong', 'good'], minPay: 150_000 })).toBe(3);
    expect(sources(rows)).toEqual(['HN October 2026']);
  });
});

describe('viewCounts', () => {
  it('counts each view with the same search', () => {
    expect(viewCounts(rows, ALL)).toEqual({ active: 7, review: 2, applied: 5, closed: 3, all: 12 });
    expect(viewCounts(rows, { ...ALL, query: 'payments' })).toMatchObject({ active: 1, all: 1 });
  });
});

describe('startingView', () => {
  it('opens on active jobs, or on the ones to review when nothing is active', () => {
    expect(startingView(rows)).toBe('active');
    const fresh = rows.filter((row) => row.progress.status === 'new');
    expect(startingView(fresh)).toBe('review');
    expect(startingView([])).toBe('active');
  });
});

describe('format', () => {
  it('writes pay as a range, marking estimates', () => {
    expect(payLabel({ text: 'x', min: 185_000, max: 215_000, source: 'listed' })).toBe(
      '$185k–$215k',
    );
    expect(payLabel({ text: 'x', min: 150_000, max: 150_000, source: 'estimate' })).toBe(
      '$150k est.',
    );
    expect(payLabel({ text: 'Competitive', min: null, max: null, source: 'listed' })).toBeNull();
    expect(payLabel(null)).toBeNull();
  });

  it('writes sizes and dates', () => {
    expect(fileSize(52_400)).toBe('52 KB');
    expect(fileSize(1_400_000)).toBe('1.4 MB');
    expect(shortDate('2026-10-07', '2026-10-10')).toBe('Oct 7');
    expect(shortDate('2025-12-30', '2026-10-10')).toBe('Dec 30, 2025');
    // A file's time goes on the user's calendar, not by its UTC date.
    const lateEvening = new Date(2026, 9, 10, 23, 30);
    expect(shortDate(lateEvening.toISOString(), '2026-10-10')).toBe('Oct 10');
  });
});
