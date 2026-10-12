import { describe, expect, it } from 'vitest';
import { NO_ANSWERS, pagesFor, parseAnswerChanges, readAnswers, wordCount } from './about.ts';

describe('readAnswers', () => {
  it('starts with nothing told', () => {
    expect(readAnswers(undefined)).toEqual(NO_ANSWERS);
    expect(readAnswers('not answers')).toEqual(NO_ANSWERS);
  });

  it('keeps each answer that holds up, and drops each one that doesn’t, alone', () => {
    const answers = readAnswers({
      you: { name: 'Jordan Avery', email: 'jordan@example.com' },
      roles: ['Product Manager', ' product manager ', '', 'Product Lead'],
      levels: ['senior', 'wizard'],
      workplaces: ['onsite', 'remote'],
      looks: [
        { layout: 'classic', for: 'public' },
        { layout: 'classic', for: 'startup' },
        { layout: 'timeline', for: 'any' },
      ],
      pages: 3,
      quiet: true,
      step: 4,
    });
    expect(answers.you).toEqual({
      ...NO_ANSWERS.you,
      name: 'Jordan Avery',
      email: 'jordan@example.com',
    });
    // Blanks and repeats go; the rest keep the user's own words.
    expect(answers.roles).toEqual(['Product Manager', 'Product Lead']);
    // One unknown level spoils that answer only.
    expect(answers.levels).toEqual([]);
    // Choices keep the options' order, whatever order they were picked in.
    expect(answers.workplaces).toEqual(['remote', 'onsite']);
    expect(answers.looks).toEqual([
      { layout: 'classic', for: 'public' },
      { layout: 'timeline', for: 'any' },
    ]);
    expect(answers.pages).toBeNull();
    expect(answers.quiet).toBe(true);
    expect(answers.step).toBe(4);
  });

  it('keeps shared files only inside about-me/files', () => {
    const file = {
      path: 'about-me/files/2026-10-12-resume.pdf',
      name: 'Resume.pdf',
      kind: 'resume',
      added: '2026-10-12',
      textFile: 'about-me/files/2026-10-12-resume.pdf.md',
    };
    expect(readAnswers({ files: [file] }).files).toEqual([file]);
    for (const bad of [
      { ...file, path: '../facts/profile.md' },
      { ...file, path: 'about-me/files/../../secret' },
      { ...file, kind: 'virus' },
      { ...file, textFile: 'facts/profile.md' },
    ]) {
      expect(readAnswers({ files: [bad] }).files).toEqual([]);
    }
  });
});

describe('parseAnswerChanges', () => {
  it('takes changes that hold up, all of them or none', () => {
    expect(parseAnswerChanges({ roles: ['Designer'], quiet: true })).toEqual({
      roles: ['Designer'],
      quiet: true,
    });
    expect(parseAnswerChanges({ roles: ['Designer'], quiet: 'yes' })).toBeNull();
    expect(parseAnswerChanges({ minPay: 'x'.repeat(500) })).toBeNull();
    expect(parseAnswerChanges([])).toBeNull();
  });

  it('never takes the shared files or when Claude started, which only the app sets', () => {
    expect(parseAnswerChanges({ files: [] })).toBeNull();
    expect(parseAnswerChanges({ startedOn: '2026-10-12' })).toBeNull();
    expect(parseAnswerChanges({ isAdmin: true })).toBeNull();
  });
});

describe('pagesFor', () => {
  it('goes by the user’s choice, or by their level', () => {
    expect(pagesFor({ pages: 1, levels: ['director'] })).toBe(1);
    expect(pagesFor({ pages: null, levels: ['entry', 'mid'] })).toBe(1);
    expect(pagesFor({ pages: null, levels: ['mid', 'senior'] })).toBe(2);
    expect(pagesFor({ pages: null, levels: [] })).toBe(2);
  });
});

it('counts the words in the notes', () => {
  expect(wordCount('')).toBe(0);
  expect(wordCount('  I lead\nthe platform team. ')).toBe(5);
});
