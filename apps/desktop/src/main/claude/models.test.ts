import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planLevels } from '../../shared/levels.ts';
import {
  DEFAULT_MODELS,
  MODEL_TASKS,
  modelFor,
  needsModel,
  PRO_MODELS,
  parseModels,
  RECOMMENDED_MODELS,
} from '../../shared/models.ts';
import { loadModels, saveModels } from './models.ts';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-models-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const job = (skill: 'fit-check' | 'salary-check' | 'who-to-message' | 'focused-resume') => ({
  skill,
  jobId: 'acme--staff',
});

describe('which model Claude runs on', () => {
  it('is Opus for everything on Max, Team and Enterprise, until the user chooses', async () => {
    expect(await loadModels(dataDir)).toEqual(DEFAULT_MODELS);
    for (const plan of ['max', 'team', 'enterprise', undefined]) {
      expect(modelFor(DEFAULT_MODELS, job('fit-check'), planLevels(plan))).toBe('opus');
      expect(modelFor(DEFAULT_MODELS, { skill: 'job-search' }, planLevels(plan))).toBe('opus');
    }
    expect(modelFor(DEFAULT_MODELS)).toBe('opus');
  });

  it('starts the checks and searches on Sonnet on a Pro plan or an API key, and the writing on Opus', () => {
    for (const levels of [planLevels('pro', 'subscription'), planLevels(undefined, 'api_key')]) {
      expect(modelFor(DEFAULT_MODELS, job('fit-check'), levels)).toBe('sonnet');
      expect(modelFor(DEFAULT_MODELS, job('salary-check'), levels)).toBe('sonnet');
      expect(modelFor(DEFAULT_MODELS, job('who-to-message'), levels)).toBe('sonnet');
      expect(modelFor(DEFAULT_MODELS, { skill: 'job-search' }, levels)).toBe('sonnet');
      expect(modelFor(DEFAULT_MODELS, job('focused-resume'), levels)).toBe('opus');
      expect(modelFor(DEFAULT_MODELS, { skill: 'get-started' }, levels)).toBe('opus');
      expect(modelFor(DEFAULT_MODELS, null, levels)).toBe('opus');
    }
  });

  it('recommends a model for every task, and Sonnet only for the checks and searches', () => {
    expect(MODEL_TASKS.every((task) => RECOMMENDED_MODELS[task] === 'opus')).toBe(true);
    expect(MODEL_TASKS.filter((task) => PRO_MODELS[task] === 'sonnet')).toEqual([
      'fit-check',
      'salary-check',
      'who-to-message',
      'job-search',
    ]);
  });

  it('keeps what the user chose, for everything and for each task, on any plan', async () => {
    const pro = planLevels('pro');
    const choices = { main: 'haiku' as const, tasks: { 'focused-resume': 'sonnet' as const } };
    await saveModels(dataDir, choices);
    expect(await loadModels(dataDir)).toEqual(choices);
    expect(modelFor(choices, job('focused-resume'), pro)).toBe('sonnet');
    expect(modelFor(choices, { skill: 'job-search' }, pro)).toBe('haiku');
    expect(modelFor(choices, null, pro)).toBe('haiku');
    // Opus picked for everything stays Opus, even where the plan suggests Sonnet.
    await saveModels(dataDir, { main: 'opus', tasks: {} });
    const opus = await loadModels(dataDir);
    expect(opus).toEqual({ main: 'opus', tasks: {} });
    expect(modelFor(opus, job('fit-check'), pro)).toBe('opus');
  });

  it('reads Opus for everything, from before there was a recommended model, as recommended', async () => {
    const file = join(dataDir, 'claude-models.json');
    writeFileSync(file, JSON.stringify({ main: 'opus', tasks: { 'fit-check': 'haiku' } }));
    expect(await loadModels(dataDir)).toEqual({ main: null, tasks: { 'fit-check': 'haiku' } });
    // Another model was the user's own choice, since Opus was the default.
    writeFileSync(file, JSON.stringify({ main: 'sonnet', tasks: {} }));
    expect(await loadModels(dataDir)).toEqual({ main: 'sonnet', tasks: {} });
    // The four tasks 0.1's button for Pro plans put on Sonnet follow the plan now, while other
    // tasks' picks stay.
    writeFileSync(
      file,
      JSON.stringify({
        main: 'opus',
        tasks: {
          'fit-check': 'sonnet',
          'salary-check': 'sonnet',
          'job-search': 'sonnet',
          'who-to-message': 'sonnet',
          'focused-resume': 'haiku',
        },
      }),
    );
    expect(await loadModels(dataDir)).toEqual({ main: null, tasks: { 'focused-resume': 'haiku' } });
    // Only some of them on Sonnet was the user's own doing.
    writeFileSync(file, JSON.stringify({ main: 'opus', tasks: { 'fit-check': 'sonnet' } }));
    expect(await loadModels(dataDir)).toEqual({ main: null, tasks: { 'fit-check': 'sonnet' } });
    // Saved again, it says so.
    await saveModels(dataDir, { main: null, tasks: {} });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 2, main: null, tasks: {} });
  });

  it('starts Claude again for a model the user chose or a more careful one, but not a lighter one it only recommends', () => {
    const pro = planLevels('pro');
    const fit = job('fit-check');
    // Open on Opus, as for a resume, a fit check recommended Sonnet runs in the open run.
    expect(needsModel('opus', DEFAULT_MODELS, fit, pro)).toBe(false);
    expect(needsModel('opus', DEFAULT_MODELS, fit, planLevels('max'))).toBe(false);
    // Open on Sonnet, as for a fit check, a resume needs Opus.
    expect(needsModel('sonnet', DEFAULT_MODELS, job('focused-resume'), pro)).toBe(true);
    // A model the user chose, for the task or for everything, gets a run of its own.
    expect(needsModel('opus', { main: null, tasks: { 'fit-check': 'sonnet' } }, fit, pro)).toBe(
      true,
    );
    expect(needsModel('opus', { main: 'haiku', tasks: {} }, fit, pro)).toBe(true);
    expect(needsModel('haiku', { main: 'haiku', tasks: {} }, fit, pro)).toBe(false);
  });

  it('takes only models and tasks it knows', () => {
    expect(parseModels({ main: null, tasks: {} })).toEqual(DEFAULT_MODELS);
    expect(parseModels({ main: 'opus', tasks: { 'fit-check': 'sonnet' } })).toEqual({
      main: 'opus',
      tasks: { 'fit-check': 'sonnet' },
    });
    for (const value of [
      null,
      'opus',
      { main: 'gpt', tasks: {} },
      { main: 'opus' },
      { main: null },
      { main: 'opus', tasks: { 'fit-check': 'fable' } },
      { main: 'opus', tasks: { 'delete-everything': 'opus' } },
      { main: '--dangerously-skip-permissions', tasks: {} },
    ]) {
      expect(parseModels(value)).toBeNull();
    }
  });

  it('is each task’s recommended model when the file is damaged', async () => {
    writeFileSync(join(dataDir, 'claude-models.json'), 'not json');
    expect(await loadModels(dataDir)).toEqual(DEFAULT_MODELS);
  });
});
