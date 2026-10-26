import { describe, expect, it } from 'vitest';
import { conflictCopyPath, type MergeRules, mergeRows, mergeText, sameRow } from './merge.ts';

const JOBS: MergeRules = {
  lists: {
    links: (link) => String((link as { url?: unknown })?.url),
    questions: (question) => String(question),
  },
  texts: ['notes'],
  stamp: 'updated_at',
};

const base = {
  status: 'screen',
  notes: 'Recruiter: Sam',
  next_on: null,
  links: JSON.stringify([{ url: 'https://acme.example/jobs/1', label: 'Posting' }]),
  questions: '[]',
  updated_at: '2026-10-10T10:00:00.000Z',
};

describe('mergeRows', () => {
  it('takes each side’s changes to different columns', () => {
    const mine = { ...base, status: 'interview', updated_at: '2026-10-11T10:00:00.000Z' };
    const theirs = { ...base, next_on: '2026-10-20', updated_at: '2026-10-11T09:00:00.000Z' };
    expect(mergeRows(base, mine, theirs, JOBS, 'the other computer')).toEqual({
      ...base,
      status: 'interview',
      next_on: '2026-10-20',
      updated_at: '2026-10-11T10:00:00.000Z',
    });
  });

  it('lets the later change win a clash, by when each changed', () => {
    const mine = { ...base, status: 'offer', updated_at: '2026-10-11T08:00:00.000Z' };
    const theirs = { ...base, status: 'rejected', updated_at: '2026-10-11T09:00:00.000Z' };
    expect(mergeRows(base, mine, theirs, JOBS, 'PC').status).toBe('rejected');
    const later = { ...mine, updated_at: '2026-10-11T10:00:00.000Z' };
    expect(mergeRows(base, later, theirs, JOBS, 'PC').status).toBe('offer');
  });

  it('lets the other device’s change stand when the row doesn’t say when', () => {
    const call = { kind: 'screen', on_date: '2026-10-20', notes: null };
    const merged = mergeRows(
      call,
      { ...call, on_date: '2026-10-21' },
      { ...call, on_date: '2026-10-22' },
      { texts: ['notes'] },
      'PC',
    );
    expect(merged.on_date).toBe('2026-10-22');
  });

  it('keeps a row the server took first whole, never one column from each', () => {
    // A computer took over a claim that had lapsed, as its owner came back and renewed it.
    const claim = { device: 'mac', until: '2026-10-26T10:10:00.000Z', own: 1 };
    const mine = { device: 'pc', until: '2026-10-26T10:22:00.000Z', own: 1 };
    const theirs = { ...claim, until: '2026-10-26T10:20:00.000Z' };
    expect(mergeRows(claim, mine, theirs, { whole: true }, 'Mac')).toEqual(theirs);
    expect(mergeRows(null, mine, theirs, { whole: true }, 'Mac')).toEqual(theirs);
  });

  it('keeps both notes when both changed them', () => {
    const mine = { ...base, notes: 'Recruiter: Sam. Salary band shared.' };
    const theirs = { ...base, notes: 'Referred by Priya' };
    expect(mergeRows(base, mine, theirs, JOBS, 'Sam’s PC').notes).toBe(
      'Recruiter: Sam. Salary band shared.\n\nFrom Sam’s PC:\nReferred by Priya',
    );
  });

  it('keeps links and questions either side added, and drops what either removed', () => {
    const added = (url: string) => ({ url, label: 'Posting' });
    const mine = {
      ...base,
      links: JSON.stringify([
        added('https://acme.example/jobs/1'),
        added('https://acme.example/b'),
      ]),
      questions: JSON.stringify(['Why Acme?']),
    };
    const theirs = {
      ...base,
      links: JSON.stringify([added('https://acme.example/c')]),
      questions: JSON.stringify(['Salary?']),
    };
    const merged = mergeRows(base, mine, theirs, JOBS, 'PC');
    // The first link was in the base, and the other device removed it.
    expect(JSON.parse(String(merged.links))).toEqual([
      added('https://acme.example/b'),
      added('https://acme.example/c'),
    ]);
    expect(JSON.parse(String(merged.questions))).toEqual(['Why Acme?', 'Salary?']);
  });

  it('fills in blanks when both devices added the same row', () => {
    const found = { company: 'Acme', status: null, notes: null, updated_at: '2026-10-11T08:00Z' };
    const tracked = { company: 'Acme', status: 'applied', notes: 'Sent', updated_at: '2026-10-10' };
    expect(mergeRows(null, found, tracked, JOBS, 'PC')).toEqual({
      company: 'Acme',
      status: 'applied',
      notes: 'Sent',
      updated_at: '2026-10-11T08:00Z',
    });
  });

  it('keeps columns only one device knows, such as from a newer version of the app', () => {
    const mine = { ...base, status: 'interview' };
    const theirs = { ...base, salary: '180000' };
    expect(mergeRows(base, mine, theirs, JOBS, 'PC')).toMatchObject({
      status: 'interview',
      salary: '180000',
    });
  });
});

describe('conflictCopyPath', () => {
  const when = new Date(2026, 9, 24, 9, 30);

  it('names a device’s copy beside the file, numbered once that’s taken', () => {
    const taken = new Set(['about-me/answers (Factwright in Chrome, Oct 24).json']);
    const free = (candidate: string) => !taken.has(candidate);
    expect(conflictCopyPath('about-me/notes.md', 'Sam’s Mac', when, free)).toBe(
      'about-me/notes (Sam’s Mac, Oct 24).md',
    );
    expect(conflictCopyPath('about-me/answers.json', 'Factwright in Chrome', when, free)).toBe(
      'about-me/answers (Factwright in Chrome, Oct 24 2).json',
    );
    expect(conflictCopyPath('README', 'PC', when, free)).toBe('README (PC, Oct 24)');
  });

  it('names it by number where the device can’t hold the name, the first that’s free', () => {
    const taken = new Set(['facts/skills (conflict 1).md']);
    const free = (candidate: string) => (candidate.includes('Sam:') ? null : !taken.has(candidate));
    expect(conflictCopyPath('facts/skills.md', 'Sam:', when, free)).toBe(
      'facts/skills (conflict 2).md',
    );
  });
});

describe('mergeText', () => {
  it('needs only one text when it already holds the other', () => {
    expect(mergeText('Recruiter: Sam', 'Recruiter: Sam. Then a call.', 'PC')).toBe(
      'Recruiter: Sam. Then a call.',
    );
    expect(mergeText('All of it', 'All', 'PC')).toBe('All of it');
    expect(mergeText('', 'Theirs', 'PC')).toBe('Theirs');
    expect(mergeText('Mine', '', 'PC')).toBe('Mine');
  });
});

describe('sameRow', () => {
  it('compares what rows say, leaving out the columns asked', () => {
    expect(sameRow(base, { ...base, updated_at: 'later' }, ['updated_at'])).toBe(true);
    expect(sameRow(base, { ...base, status: 'offer' }, ['updated_at'])).toBe(false);
    expect(sameRow({ a: null }, {})).toBe(true);
  });
});
