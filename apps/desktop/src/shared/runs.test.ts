import { describe, expect, it } from 'vitest';
import {
  AT_ONCE,
  atOnceFrom,
  lanesOf,
  sharesLane,
  startedOnItsOwn,
  taskJob,
  taskJobs,
} from './runs.ts';

describe('what a task works on', () => {
  it('is its job, the user’s facts and Profile, the job searches, or the templates', () => {
    expect(lanesOf({ skill: 'cover-letter', jobId: 'acme--staff' })).toEqual(['job:acme--staff']);
    expect(lanesOf({ skill: 'interview-prep', jobId: 'acme--staff', callId: 'c1' })).toEqual([
      'job:acme--staff',
    ]);
    for (const skill of ['get-started', 'work-history'] as const) {
      expect(lanesOf({ skill })).toEqual(['profile']);
    }
    expect(lanesOf({ skill: 'add-facts', mode: 'new' })).toEqual(['profile']);
    expect(lanesOf({ skill: 'job-search' })).toEqual(['job-search']);
    expect(lanesOf({ skill: 'make-template', source: '2026-10-25-1.pdf' })).toEqual([
      'make-template',
    ]);
    expect(lanesOf(null)).toEqual([]);
  });

  it('is each of the jobs a task analyzing several works on', () => {
    const several = { skill: 'analyze-job', jobIds: ['acme--staff', 'globex--pm'] } as const;
    expect(lanesOf({ ...several, jobIds: [...several.jobIds] })).toEqual([
      'job:acme--staff',
      'job:globex--pm',
    ]);
    expect(taskJobs({ ...several, jobIds: [...several.jobIds] })).toEqual([
      'acme--staff',
      'globex--pm',
    ]);
    // No one job of its own.
    expect(taskJob({ ...several, jobIds: [...several.jobIds] })).toBeNull();
    expect(taskJobs({ skill: 'cover-letter', jobId: 'acme--staff' })).toEqual(['acme--staff']);
    expect(taskJobs({ skill: 'job-search' })).toEqual([]);
    expect(
      sharesLane(
        { skill: 'analyze-job', jobIds: ['acme--staff', 'globex--pm'] },
        { skill: 'cover-letter', jobId: 'globex--pm' },
      ),
    ).toBe(true);
    // Only one Claude starts by itself steps aside for the user's tasks.
    expect(startedOnItsOwn({ skill: 'analyze-job', jobIds: ['acme--staff'], auto: true })).toBe(
      true,
    );
    expect(startedOnItsOwn({ skill: 'analyze-job', jobIds: ['acme--staff'] })).toBe(false);
    expect(startedOnItsOwn(null)).toBe(false);
  });

  it('keeps two tasks apart when they share one, and Claude with no task apart from none', () => {
    const resume = { skill: 'focused-resume', jobId: 'acme--staff' } as const;
    expect(sharesLane(resume, { skill: 'cover-letter', jobId: 'acme--staff' })).toBe(true);
    expect(sharesLane(resume, { skill: 'cover-letter', jobId: 'globex--pm' })).toBe(false);
    expect(sharesLane({ skill: 'get-started' }, { skill: 'add-facts', mode: 'interview' })).toBe(
      true,
    );
    expect(sharesLane(null, null)).toBe(false);
  });
});

describe('how many runs go at once', () => {
  it('takes a whole number from one to five', () => {
    expect(AT_ONCE.usual).toBe(3);
    expect([1, 3, 5].map(atOnceFrom)).toEqual([1, 3, 5]);
    expect([0, 6, 2.5, '3', null].map(atOnceFrom)).toEqual([null, null, null, null, null]);
  });
});
