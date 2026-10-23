import { describe, expect, it } from 'vitest';
import { lintResume, readConfidentialTerms } from './lint.ts';
import { sampleResume } from './sample.ts';
import type { Resume } from './schema.ts';

/** How long something takes, in milliseconds. */
function timed(work: () => unknown): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

describe('lintResume', () => {
  it('passes a resume that keeps the rules', () => {
    expect(lintResume(sampleResume(), { maxPages: 2, skillsLines: 1, systemsCards: 1 })).toEqual(
      [],
    );
  });

  it('catches placeholders, banned wording and confidential terms', () => {
    const resume = {
      ...sampleResume(),
      summary: 'Led [[team size]] engineers on a HIPAA-certified Bluebird rollout.',
    };
    expect(
      lintResume(
        resume,
        { banned: [{ pattern: 'HIPAA[- ]certified', why: 'no certification exists' }] },
        ['bluebird'],
      ),
    ).toEqual([
      'A [[placeholder]] is still in the resume.',
      '"HIPAA-certified" isn\'t allowed: no certification exists.',
      'A confidential term matching "bluebird" is in the resume.',
    ]);
  });

  it('lets an allowed match through, and says when a rule is broken itself', () => {
    const resume = { ...sampleResume(), summary: 'Ran 500+ tenants, then 40 customers.' };
    const banned = [
      {
        pattern: '\\b\\d[\\d,]*\\+? (customers|tenants)\\b',
        why: 'no counts',
        allow: '^500\\+ tenants$',
      },
      { pattern: '(unclosed', why: 'typo' },
    ];
    expect(lintResume(resume, { banned })).toEqual([
      '"40 customers" isn\'t allowed: no counts.',
      'The rule "(unclosed" in guide/lint.json isn\'t a valid pattern.',
    ]);
  });

  it('says when a confidential term won’t read, so it can’t quietly protect nothing', () => {
    expect(lintResume(sampleResume(), {}, ['Acme (US', 'Acme \\(US\\)'])).toEqual([
      'The confidential term "Acme (US" in guide/confidential-terms.txt isn\'t a valid pattern. Put a \\ before any of . ( ) [ ] + ? * | in it.',
    ]);
  });

  it('skips the history and notes the resume never shows', () => {
    const resume = {
      ...sampleResume(),
      change_log: ['Was [[draft]]'],
      notes: ['Bluebird asked for this'],
      confirm_with_user: ['[[check]]'],
    };
    expect(lintResume(resume, {}, ['bluebird'])).toEqual([]);
  });

  it('checks titles, line and card counts, and card length', () => {
    expect(
      lintResume(sampleResume(), {
        titles: { 'Tidewater Analytics': 'Principal Engineer' },
        skillsLines: 4,
        systemsCards: 6,
        cardWords: [16, 26],
      }),
    ).toEqual([
      'The title at Tidewater Analytics must be exactly "Principal Engineer", not "Staff Engineer".',
      'The skills need exactly 4 lines, not 1.',
      'The systems need exactly 6 cards, not 1.',
      'The "Deploy pipeline" card has 11 words; keep it to 16–26.',
    ]);
  });

  describe('with more than one title at a company', () => {
    // Three roles at Tidewater, newest first, each its own job on the resume.
    const promoted: Resume = {
      ...sampleResume(),
      experience: [
        ['Staff Engineer', '03/2022', 'Present'],
        ['Senior Engineer', '06/2019', '02/2022'],
        ['Engineer', '08/2017', '05/2019'],
      ].map(([title = '', start = '', end = '']) => ({
        title,
        company: 'Tidewater Analytics',
        start,
        end,
      })),
    };
    // A rule file is JSON anyone can edit, so a company's titles can be anything.
    const titles = (exact: unknown) => ({
      titles: { 'Tidewater Analytics': exact } as Record<string, string | string[]>,
    });

    it('checks each job there against every title held there', () => {
      expect(
        lintResume(promoted, titles(['Staff Engineer', 'Senior Engineer', 'Engineer'])),
      ).toEqual([]);
      const wrong = {
        ...promoted,
        experience: promoted.experience.map((job, i) =>
          i === 1 ? { ...job, title: 'Principal Engineer' } : job,
        ),
      };
      expect(lintResume(wrong, titles(['Staff Engineer', 'Senior Engineer', 'Engineer']))).toEqual([
        'The title at Tidewater Analytics must be exactly one of "Staff Engineer", "Senior Engineer" or "Engineer", not "Principal Engineer".',
      ]);
      expect(lintResume(promoted, titles(['Staff Engineer']))).toEqual([
        'The title at Tidewater Analytics must be exactly "Staff Engineer", not "Senior Engineer".',
        'The title at Tidewater Analytics must be exactly "Staff Engineer", not "Engineer".',
      ]);
    });

    it('reads a single title, as older rules give it, as one job’s title there', () => {
      // The newest title is right, whichever title the rule names.
      expect(lintResume(promoted, titles('Staff Engineer'))).toEqual([]);
      expect(lintResume(promoted, titles('Senior Engineer'))).toEqual([]);
      expect(lintResume(promoted, titles('Principal Engineer'))).toEqual([
        'The title at Tidewater Analytics must be exactly "Principal Engineer", not "Staff Engineer".',
      ]);
    });

    it('says when a company’s titles aren’t a title or a list of them', () => {
      for (const exact of [[], [3], 42, null, {}]) {
        expect(lintResume(promoted, titles(exact))).toEqual([
          'The titles for Tidewater Analytics in guide/lint.json should be a title, or a list of every title held there.',
        ]);
      }
      // A company the resume doesn't have is never checked.
      expect(lintResume(promoted, { titles: { Acme: ['Director'] } })).toEqual([]);
    });
  });
});

describe('readConfidentialTerms', () => {
  it('reads one pattern a line, skipping blanks and comments', () => {
    expect(readConfidentialTerms('# customers\nbluebird\n\n  acme\\s+health  \n')).toEqual([
      'bluebird',
      'acme\\s+health',
    ]);
    expect(readConfidentialTerms(null)).toEqual([]);
  });
});

describe('a resume made to keep the app busy', () => {
  it('is checked in a moment, however many "[[" are left open', () => {
    const resume = { ...sampleResume(), summary: '[['.repeat(50_000) };
    let issues: string[] = [];
    expect(timed(() => (issues = lintResume(resume)))).toBeLessThan(1000);
    expect(issues).toEqual([]);
  });
});
