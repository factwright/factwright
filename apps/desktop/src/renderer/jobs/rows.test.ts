import { fileSize, localDate, payLabel, shortDate } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import {
  filterCount,
  foundOptions,
  jobRows,
  NO_FILTERS,
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
    expect(companies(visibleRows(rows, { ...ALL, view: 'apply' }))).toEqual([
      'Acme Robotics',
      'Brightpath Learning',
    ]);
    const all = visibleRows(rows, ALL);
    const dates = all.map((row) => row.progress.lastActivity ?? '');
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('searches company, role, notes and status, every word', () => {
    expect(companies(visibleRows(rows, { ...ALL, query: 'payments' }))).toEqual(['Harbor & Pine']);
    expect(companies(visibleRows(rows, { ...ALL, query: 'referred TEAMMATE' }))).toEqual([
      'Harbor & Pine',
    ]);
    expect(companies(visibleRows(rows, { ...ALL, query: 'no reply' }))).toEqual(['Sable Systems']);
    expect(visibleRows(rows, { ...ALL, query: 'payments zebra' })).toEqual([]);
    // Dated notes, and the search that found a job, are searched too.
    expect(companies(visibleRows(rows, { ...ALL, query: 'cost-tooling' }))).toEqual([
      'Northwind Labs',
    ]);
    // Acme's How to apply mentions LinkedIn too.
    expect(companies(visibleRows(rows, { ...ALL, query: 'linkedin' }))).toEqual([
      'Acme Robotics',
      'Bluewave Staffing',
      'Brightpath Learning',
    ]);
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
  });

  it('narrows to the jobs one search found, or that came another way', () => {
    const [linkedIn] = rows.flatMap((row) =>
      row.job.searches.filter((run) => run.source.startsWith('LinkedIn')),
    );
    expect(companies(visibleRows(rows, { ...ALL, found: `search:${linkedIn?.folder}` }))).toEqual([
      'Bluewave Staffing',
      'Brightpath Learning',
    ]);
    expect(visibleRows(rows, { ...ALL, found: 'search:2026-10-hn-whos-hiring' })).toHaveLength(10);
    expect(visibleRows(rows, { ...ALL, found: 'from:Added by hand' })).toEqual([]);
    const byHand = jobRows(
      sampleJobs().map((job, i) =>
        i === 0 ? { ...job, searches: [], source: 'Added by hand' } : job,
      ),
      TODAY,
    );
    expect(companies(visibleRows(byHand, { ...ALL, found: 'from:Added by hand' }))).toEqual([
      'Northwind Labs',
    ]);
  });
});

describe('filterCount and foundOptions', () => {
  it('counts the filters that are on, apart from where jobs came from', () => {
    expect(filterCount(ALL)).toBe(0);
    expect(filterCount({ ...ALL, tiers: ['strong', 'good'], minPay: 150_000 })).toBe(3);
    expect(filterCount({ ...ALL, found: 'search:2026-10-hn-whos-hiring' })).toBe(0);
  });

  it('lists each search, newest first, with how many jobs it found', () => {
    const { searches, others } = foundOptions(rows, TODAY);
    expect(
      searches.map(({ label, count }) => [label.replace(/^LinkedIn .+/, 'LinkedIn'), count]),
    ).toEqual([
      ['LinkedIn', 2],
      ['HN October 2026', 10],
    ]);
    expect(others).toEqual([]);
    // Two searches of the same place say when each was.
    const twice = jobRows(
      sampleJobs().map((job) =>
        job.company === 'Fernway'
          ? {
              ...job,
              searches: [
                { folder: '2026-09-hn-whos-hiring', source: 'HN October 2026', date: '2026-09-02' },
              ],
            }
          : job,
      ),
      '2026-10-12',
    );
    expect(foundOptions(twice, '2026-10-12').searches.map((each) => each.label)).toContain(
      'HN October 2026 · Sep 2',
    );
  });
});

describe('viewCounts', () => {
  it('counts each view with the same search', () => {
    expect(viewCounts(rows, ALL)).toEqual({
      review: 2,
      apply: 2,
      applied: 2,
      interviewing: 3,
      closed: 3,
      all: 12,
    });
    expect(viewCounts(rows, { ...ALL, query: 'payments' })).toMatchObject({ applied: 1, all: 1 });
  });
});

describe('startingView', () => {
  it('opens on the furthest view with jobs in it, or on the ones to review', () => {
    expect(startingView(rows)).toBe('interviewing');
    const fresh = rows.filter((row) => row.progress.status === 'new');
    expect(startingView(fresh)).toBe('review');
    expect(startingView([])).toBe('review');
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
