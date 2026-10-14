import { fileSize, localDate, payLabel, shortDate } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import {
  filterCount,
  foundOptions,
  jobRows,
  laterRows,
  NO_FILTERS,
  ofKind,
  startingView,
  stepFrom,
  viewCounts,
  viewNow,
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
    expect(companies(visibleRows(rows, { ...ALL, view: 'new' }))).toEqual([
      'Bluewave Staffing',
      'Copperleaf Energy',
      'Granite Health',
    ]);
    // A job set aside comes back up into To review on its day, at the top.
    expect(companies(visibleRows(rows, { ...ALL, view: 'review' }))).toEqual([
      'Pinecrest Software',
      'Acme Robotics',
      'Wavelength Audio',
    ]);
    // Kestrel, Meridian and Orchard last changed on the same day, so they go by name.
    expect(companies(visibleRows(rows, { ...ALL, view: 'closed' }))).toEqual([
      'Sable Systems',
      'Kestrel Robotics',
      'Meridian Freight',
      'Orchard Health',
    ]);
    expect(companies(visibleRows(rows, { ...ALL, view: 'apply' }))).toEqual([
      'Brightpath Learning',
      'Quarry Labs',
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
      'Granite Health',
    ]);
    expect(companies(visibleRows(rows, { ...ALL, query: 'role closed' }))).toEqual([
      'Kestrel Robotics',
    ]);
  });

  it('folds the jobs set aside at the bottom of To review, the soonest back first', () => {
    expect(companies(laterRows(rows, { ...ALL, view: 'review' }))).toEqual([
      'Ridgeline Analytics',
      'Saltmarsh Games',
    ]);
    expect(laterRows(rows, { ...ALL, view: 'all' })).toEqual([]);
    // Every job is in All, set aside or not.
    expect(companies(visibleRows(rows, { ...ALL, query: 'later' }))).toEqual([
      'Pinecrest Software',
      'Ridgeline Analytics',
      'Saltmarsh Games',
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
    expect(visibleRows(archived, { ...ALL, showArchived: true })).toHaveLength(19);
  });

  it('filters by fit, source, pay and resumes', () => {
    expect(companies(visibleRows(rows, { ...ALL, tiers: ['strong'] }))).toEqual([
      'Fernway',
      'Quarry Labs',
      'Northwind Labs',
      'Tidewater Analytics',
    ]);
    expect(companies(visibleRows(rows, { ...ALL, tiers: ['none'] }))).toEqual([
      'Bluewave Staffing',
      'Wavelength Audio',
      'Ridgeline Analytics',
      'Sable Systems',
      'Saltmarsh Games',
    ]);
    // The top of the range counts: Lumen's $160k–$190k pays at least $190k.
    expect(companies(visibleRows(rows, { ...ALL, minPay: 190_000 }))).toEqual([
      'Pinecrest Software',
      'Acme Robotics',
      'Fernway',
      'Quarry Labs',
      'Copperleaf Energy',
      'Northwind Labs',
      'Granite Health',
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
      'Granite Health',
    ]);
    expect(visibleRows(rows, { ...ALL, found: 'search:2026-10-hn-whos-hiring' })).toHaveLength(16);
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

describe('kinds of job', () => {
  const KINDS = [
    { id: 'developer', name: 'Developer' },
    { id: 'project-manager', name: 'Project manager' },
  ];
  const split = jobRows(
    sampleJobs().map((job) =>
      // The user put Northwind under project manager, and Fernway back under developer.
      job.company === 'Northwind Labs'
        ? { ...job, kind: 'project-manager' }
        : job.company === 'Fernway'
          ? { ...job, kind: 'developer' }
          : job,
    ),
    TODAY,
    KINDS,
  );

  it('puts each job under the kind the user picked, or found it as, or else the first', () => {
    const kindOf = (company: string) => split.find((row) => row.job.company === company)?.kind;
    expect(kindOf('Northwind Labs')).toEqual(KINDS[1]);
    expect(kindOf('Saltmarsh Games')).toEqual(KINDS[1]);
    expect(kindOf('Fernway')).toEqual(KINDS[0]);
    expect(kindOf('Acme Robotics')).toEqual(KINDS[0]);
    // With one kind, no job is under any.
    expect(rows.every((row) => row.kind === null)).toBe(true);
    expect(jobRows(sampleJobs(), TODAY, KINDS.slice(0, 1)).every((row) => !row.kind)).toBe(true);
  });

  it('narrows to one kind, and searches by its name', () => {
    expect(companies(visibleRows(split, { ...ALL, kind: 'project-manager' })).sort()).toEqual([
      'Northwind Labs',
      'Pinecrest Software',
      'Saltmarsh Games',
    ]);
    expect(companies(ofKind(split, 'project-manager'))).toEqual(
      companies(split.filter((row) => row.kind?.id === 'project-manager')),
    );
    expect(ofKind(split, null)).toBe(split);
    expect(companies(visibleRows(split, { ...ALL, query: 'project manager' })).sort()).toEqual([
      'Northwind Labs',
      'Pinecrest Software',
      'Saltmarsh Games',
    ]);
    // The views count only that kind's jobs. Saltmarsh is set aside, so To review leaves it out.
    const counts = viewCounts(split, { ...ALL, kind: 'project-manager' });
    expect([counts.all, counts.review]).toEqual([3, 1]);
    // It isn't one of the Filters button's filters: it has its own menu.
    expect(filterCount({ ...ALL, kind: 'developer' })).toBe(0);
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
      ['LinkedIn', 3],
      ['HN October 2026', 16],
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
  it('counts each view with the same search, To review without the jobs set aside', () => {
    expect(viewCounts(rows, ALL)).toEqual({
      new: 3,
      review: 3,
      apply: 2,
      applied: 2,
      interviewing: 3,
      closed: 4,
      all: 19,
    });
    expect(viewCounts(rows, { ...ALL, query: 'payments' })).toMatchObject({ applied: 1, all: 1 });
  });
});

describe('viewNow', () => {
  it('opens a view kept before New on the view that holds those jobs now', () => {
    expect(viewNow('review')).toBe('new');
    expect(viewNow('apply')).toBe('review');
    expect(viewNow('interviewing')).toBe('interviewing');
    expect(viewNow(null)).toBeNull();
  });
});

describe('startingView', () => {
  it('opens on the furthest view with jobs in it, or on the new ones', () => {
    expect(startingView(rows)).toBe('interviewing');
    const fresh = rows.filter((row) => row.progress.status === 'new');
    expect(startingView(fresh)).toBe('new');
    expect(startingView([])).toBe('new');
    // Jobs set aside, folded away, don't make it open on an empty To review.
    const aside = rows.filter((row) => ['new', 'later'].includes(row.progress.status));
    expect(startingView(aside.filter((row) => !row.progress.backFromLater))).toBe('new');
    expect(startingView(aside)).toBe('review');
    // With only jobs set aside, To review shows them, folded.
    const onlyAside = aside.filter(
      (row) => row.progress.status === 'later' && !row.progress.backFromLater,
    );
    expect(startingView(onlyAside)).toBe('review');
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

describe('stepFrom', () => {
  const order = ['a', 'b', 'c', 'd'];
  const all = () => true;

  it('steps through the order the list had, passing over jobs that have gone', () => {
    expect(stepFrom(order, 'b', 1, all)).toBe('c');
    expect(stepFrom(order, 'b', -1, all)).toBe('a');
    expect(stepFrom(order, 'b', 1, (id) => id !== 'c')).toBe('d');
  });

  it('stops at either end, and for a job not in the order', () => {
    expect(stepFrom(order, 'd', 1, all)).toBeNull();
    expect(stepFrom(order, 'a', -1, all)).toBeNull();
    expect(stepFrom(order, 'z', 1, all)).toBeNull();
  });
});

describe('foundOptions with archived jobs', () => {
  it('keeps a search whose jobs are all archived, counting none', () => {
    const archived = jobRows(
      sampleJobs().map((job) =>
        job.searches.some((run) => run.source.startsWith('LinkedIn'))
          ? { ...job, archived: true }
          : job,
      ),
      TODAY,
    );
    const linkedIn = foundOptions(archived, TODAY).searches.find((each) =>
      each.label.startsWith('LinkedIn'),
    );
    expect(linkedIn?.count).toBe(0);
  });
});
