import { describe, expect, it } from 'vitest';
import { lintResume, readConfidentialTerms } from './lint.ts';
import { sampleResume } from './sample.ts';

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
