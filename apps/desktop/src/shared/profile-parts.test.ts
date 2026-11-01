import { describe, expect, it } from 'vitest';
import { PROFILE_PARTS, parseProfileChanges } from './profile-parts.ts';
import { lanesOf, partOf, scopeOf, sharesLane } from './runs.ts';
import { MAX_CHANGES } from './versions.ts';

describe('parseProfileChanges', () => {
  it('takes a part and the user’s words, trimmed', () => {
    for (const part of PROFILE_PARTS.filter((each) => each !== 'kind')) {
      expect(parseProfileChanges({ part, changes: '  Use my new email\n' })).toEqual({
        part,
        changes: 'Use my new email',
      });
    }
  });

  it('takes a kind of job’s id for that part, and only that part', () => {
    expect(parseProfileChanges({ part: 'kind', kind: 'design', changes: 'Add UX' })).toEqual({
      part: 'kind',
      kind: 'design',
      changes: 'Add UX',
    });
    expect(parseProfileChanges({ part: 'kind', changes: 'Add UX' })).toBeNull();
    expect(parseProfileChanges({ part: 'kind', kind: 'Not An Id!', changes: 'Add UX' })).toBeNull();
    expect(parseProfileChanges({ part: 'wants', kind: 'design', changes: 'Add UX' })).toBeNull();
  });

  it.each([
    null,
    'about',
    [],
    {},
    { part: 'about' },
    { part: 'about', changes: '   ' },
    { part: 'about', changes: 'x'.repeat(MAX_CHANGES + 1) },
    { part: 'street', changes: 'Add it' },
    { part: 'about', changes: 'Add it', extra: true },
  ])('refuses %j', (value) => {
    expect(parseProfileChanges(value)).toBeNull();
  });
});

describe('a task on a part of Profile', () => {
  const REQUEST = '0123456789abcdef';
  const task = { skill: 'update-profile', part: 'about', request: REQUEST } as const;

  it('has that part’s scope, and any other scope has no part', () => {
    expect(partOf(scopeOf(task))).toBe('about');
    for (const scope of ['hunt', 'profile', 'history', 'template', 'revise'] as const) {
      expect(partOf(scope)).toBeNull();
    }
  });

  it('waits for any other task on the user’s facts and Profile', () => {
    expect(lanesOf(task)).toEqual(['profile']);
    expect(sharesLane(task, { skill: 'add-facts', mode: 'interview' })).toBe(true);
    expect(sharesLane(task, { skill: 'work-history' })).toBe(true);
    expect(sharesLane(task, { skill: 'update-profile', part: 'wants', request: REQUEST })).toBe(
      true,
    );
    expect(sharesLane(task, { skill: 'job-search' })).toBe(false);
  });

  it('waits for a template’s run too, when it’s on the templates', () => {
    const templates = { skill: 'update-profile', part: 'templates', request: REQUEST } as const;
    expect(sharesLane(templates, { skill: 'make-template', source: '2026-10-12-1.pdf' })).toBe(
      true,
    );
    expect(sharesLane(task, { skill: 'make-template', source: '2026-10-12-1.pdf' })).toBe(false);
  });
});
