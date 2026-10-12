import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, modelFor, parseModels } from '../../shared/models.ts';
import { loadModels, saveModels } from './models.ts';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-models-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('which model Claude runs on', () => {
  it('is Opus for everything until the user chooses otherwise', async () => {
    expect(await loadModels(dataDir)).toEqual(DEFAULT_MODELS);
    expect(modelFor(DEFAULT_MODELS, { skill: 'fit-check', jobId: 'acme--staff' })).toBe('opus');
    expect(modelFor(DEFAULT_MODELS)).toBe('opus');
  });

  it('keeps what the user chose, for everything and for each task', async () => {
    const choices = { main: 'sonnet' as const, tasks: { 'focused-resume': 'opus' as const } };
    await saveModels(dataDir, choices);
    expect(await loadModels(dataDir)).toEqual(choices);
    expect(modelFor(choices, { skill: 'focused-resume', jobId: 'acme--staff' })).toBe('opus');
    expect(modelFor(choices, { skill: 'job-search' })).toBe('sonnet');
    expect(modelFor(choices, null)).toBe('sonnet');
  });

  it('takes only models and tasks it knows', () => {
    expect(parseModels({ main: 'opus', tasks: {} })).toEqual(DEFAULT_MODELS);
    for (const value of [
      null,
      'opus',
      { main: 'gpt', tasks: {} },
      { main: 'opus' },
      { main: 'opus', tasks: { 'fit-check': 'fable' } },
      { main: 'opus', tasks: { 'delete-everything': 'opus' } },
      { main: '--dangerously-skip-permissions', tasks: {} },
    ]) {
      expect(parseModels(value)).toBeNull();
    }
  });

  it('is Opus for everything when the file is damaged', async () => {
    writeFileSync(join(dataDir, 'claude-models.json'), 'not json');
    expect(await loadModels(dataDir)).toEqual(DEFAULT_MODELS);
  });
});
