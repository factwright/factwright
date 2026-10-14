import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_EFFORT,
  EFFORTS,
  effortFor,
  needsMore,
  PRO_EFFORT,
  parseEffort,
  RECOMMENDED_EFFORT,
  recommendedEffort,
} from '../../shared/effort.ts';
import { planLevels } from '../../shared/levels.ts';
import { MODEL_TASKS } from '../../shared/models.ts';
import { loadEffort, saveEffort } from './effort.ts';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-effort-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('how hard Claude thinks', () => {
  it('is extra high for most tasks, and high for job searches, until the user chooses', async () => {
    expect(await loadEffort(dataDir)).toEqual(DEFAULT_EFFORT);
    const resume = { skill: 'focused-resume' as const, jobId: 'acme--staff' };
    expect(effortFor(DEFAULT_EFFORT, resume, planLevels('max'))).toBe('xhigh');
    expect(effortFor(DEFAULT_EFFORT, { skill: 'salary-check', jobId: 'acme--staff' })).toBe(
      'xhigh',
    );
    expect(effortFor(DEFAULT_EFFORT, { skill: 'job-search' }, planLevels('max'))).toBe('high');
    expect(effortFor(DEFAULT_EFFORT, null, planLevels('team'))).toBe('xhigh');
  });

  it('asks less on a Pro plan, whose limits are tightest: high, and medium for lookups', () => {
    const pro = planLevels('pro', 'subscription');
    const resume = { skill: 'focused-resume' as const, jobId: 'acme--staff' };
    expect(effortFor(DEFAULT_EFFORT, resume, pro)).toBe('high');
    expect(effortFor(DEFAULT_EFFORT, { skill: 'salary-check', jobId: 'acme--staff' }, pro)).toBe(
      'medium',
    );
    expect(effortFor(DEFAULT_EFFORT, { skill: 'job-search' }, pro)).toBe('medium');
    expect(recommendedEffort(undefined, pro)).toBe('high');
    // A choice of the user's own counts on any plan.
    expect(effortFor({ main: 'max', tasks: {} }, resume, pro)).toBe('max');
  });

  it('asks as little with an API key, where every token is billed', () => {
    const resume = { skill: 'focused-resume' as const, jobId: 'acme--staff' };
    expect(effortFor(DEFAULT_EFFORT, resume, planLevels(undefined, 'api_key'))).toBe('high');
    expect(
      effortFor(DEFAULT_EFFORT, { skill: 'job-search' }, planLevels(undefined, 'api_key')),
    ).toBe('medium');
  });

  it('recommends a level for every task the app starts, on every plan, short of max', () => {
    for (const levels of [RECOMMENDED_EFFORT, PRO_EFFORT]) {
      const each = MODEL_TASKS.map((task) => levels[task]);
      expect(each.every((level) => EFFORTS.includes(level) && level !== 'max')).toBe(true);
    }
    const extra = MODEL_TASKS.filter((task) => RECOMMENDED_EFFORT[task] === 'xhigh').length;
    expect(extra).toBeGreaterThan(MODEL_TASKS.length / 2);
  });

  it('takes one level for everything over the recommended ones, and a task’s own over both', async () => {
    const choices = { main: 'max' as const, tasks: { 'job-search': 'low' as const } };
    await saveEffort(dataDir, choices);
    expect(await loadEffort(dataDir)).toEqual(choices);
    expect(effortFor(choices, { skill: 'salary-check', jobId: 'acme--staff' })).toBe('max');
    expect(effortFor(choices, { skill: 'job-search' })).toBe('low');
    expect(effortFor(choices, null)).toBe('max');
  });

  it('takes only levels and tasks it knows', () => {
    expect(parseEffort({ main: null, tasks: {} })).toEqual(DEFAULT_EFFORT);
    expect(parseEffort({ main: 'xhigh', tasks: { 'fit-check': 'low' } })).toEqual({
      main: 'xhigh',
      tasks: { 'fit-check': 'low' },
    });
    for (const value of [
      null,
      'high',
      { tasks: {} },
      { main: 'extreme', tasks: {} },
      { main: null },
      { main: null, tasks: { 'fit-check': 'ultra' } },
      { main: null, tasks: { 'delete-everything': 'high' } },
      { main: '--dangerously-skip-permissions', tasks: {} },
    ]) {
      expect(parseEffort(value)).toBeNull();
    }
  });

  it('starts over only for a task that needs more than the open run gives', () => {
    expect(needsMore('medium', 'high')).toBe(true);
    expect(needsMore('high', 'max')).toBe(true);
    // A salary check after a fit check runs in the same run, at high.
    expect(needsMore('high', 'medium')).toBe(false);
    expect(needsMore('high', 'high')).toBe(false);
  });

  it('is each task’s recommended level when the file is damaged', async () => {
    writeFileSync(join(dataDir, 'claude-effort.json'), 'not json');
    expect(await loadEffort(dataDir)).toEqual(DEFAULT_EFFORT);
  });
});
