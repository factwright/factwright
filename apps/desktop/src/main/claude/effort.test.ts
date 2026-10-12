import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_EFFORT,
  EFFORTS,
  effortFor,
  parseEffort,
  RECOMMENDED_EFFORT,
} from '../../shared/effort.ts';
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
  it('is high for most tasks and medium for lookups, until the user chooses', async () => {
    expect(await loadEffort(dataDir)).toEqual(DEFAULT_EFFORT);
    expect(effortFor(DEFAULT_EFFORT, { skill: 'focused-resume', jobId: 'acme--staff' })).toBe(
      'high',
    );
    expect(effortFor(DEFAULT_EFFORT, { skill: 'salary-check', jobId: 'acme--staff' })).toBe(
      'medium',
    );
    expect(effortFor(DEFAULT_EFFORT, { skill: 'job-search' })).toBe('medium');
    expect(effortFor(DEFAULT_EFFORT)).toBe('high');
  });

  it('recommends a level for every task the app starts, mostly high', () => {
    const levels = MODEL_TASKS.map((task) => RECOMMENDED_EFFORT[task]);
    expect(levels.every((level) => EFFORTS.includes(level))).toBe(true);
    const high = levels.filter((level) => level === 'high').length;
    expect(high).toBeGreaterThan(levels.length / 2);
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

  it('is each task’s recommended level when the file is damaged', async () => {
    writeFileSync(join(dataDir, 'claude-effort.json'), 'not json');
    expect(await loadEffort(dataDir)).toEqual(DEFAULT_EFFORT);
  });
});
