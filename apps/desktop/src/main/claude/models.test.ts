import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planLevels } from '../../shared/levels.ts';
import {
  DEFAULT_MODELS,
  MODEL_TASKS,
  modelFor,
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

const job = (skill: 'analyze-job' | 'salary-check' | 'who-to-message' | 'focused-resume') => ({
  skill,
  jobId: 'acme--staff',
});

describe('which model Claude runs on', () => {
  it('is Opus for everything on Max, Team and Enterprise, until the user chooses', async () => {
    expect(await loadModels(dataDir)).toEqual(DEFAULT_MODELS);
    for (const plan of ['max', 'team', 'enterprise', undefined]) {
      expect(modelFor(DEFAULT_MODELS, job('analyze-job'), planLevels(plan))).toBe('opus');
      expect(modelFor(DEFAULT_MODELS, { skill: 'job-search' }, planLevels(plan))).toBe('opus');
    }
    expect(modelFor(DEFAULT_MODELS)).toBe('opus');
  });

  it('starts the checks and searches on Sonnet on a Pro plan or an API key, and the writing on Opus', () => {
    for (const levels of [planLevels('pro', 'subscription'), planLevels(undefined, 'api_key')]) {
      expect(modelFor(DEFAULT_MODELS, job('analyze-job'), levels)).toBe('sonnet');
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
      'analyze-job',
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
    // A revision is writing a resume, at a tailored resume's levels.
    const revision = {
      skill: 'revise-resume' as const,
      jobId: 'acme--staff',
      resume: 'Resume.pdf',
      findings: ['term-go'],
    };
    expect(modelFor(choices, revision, pro)).toBe('sonnet');
    // So is a quick resume, a first one or a new version.
    for (const quick of [
      { skill: 'focused-resume' as const, jobId: 'acme--staff', quick: true as const },
      {
        skill: 'focused-resume' as const,
        jobId: 'acme--staff',
        again: true as const,
        quick: true as const,
      },
    ]) {
      expect(modelFor(choices, quick, pro)).toBe('sonnet');
    }
    expect(modelFor(choices, { skill: 'job-search' }, pro)).toBe('haiku');
    expect(modelFor(choices, null, pro)).toBe('haiku');
    // Opus picked for everything stays Opus, even where the plan suggests Sonnet.
    await saveModels(dataDir, { main: 'opus', tasks: {} });
    const opus = await loadModels(dataDir);
    expect(opus).toEqual({ main: 'opus', tasks: {} });
    expect(modelFor(opus, job('analyze-job'), pro)).toBe('opus');
  });

  it('reads Opus for everything, from before there was a recommended model, as recommended', async () => {
    const file = join(dataDir, 'claude-models.json');
    writeFileSync(file, JSON.stringify({ main: 'opus', tasks: { 'fit-check': 'haiku' } }));
    // A fit check's choice, from before it was Analyze job, is Analyze job's.
    expect(await loadModels(dataDir)).toEqual({ main: null, tasks: { 'analyze-job': 'haiku' } });
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
    expect(await loadModels(dataDir)).toEqual({ main: null, tasks: { 'analyze-job': 'sonnet' } });
    // Saved again, it says so.
    await saveModels(dataDir, { main: null, tasks: {} });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 2, main: null, tasks: {} });
  });

  it('takes only models and tasks it knows', () => {
    expect(parseModels({ main: null, tasks: {} })).toEqual(DEFAULT_MODELS);
    expect(parseModels({ main: 'opus', tasks: { 'analyze-job': 'sonnet' } })).toEqual({
      main: 'opus',
      tasks: { 'analyze-job': 'sonnet' },
    });
    // A fit check's choice, saved before it was Analyze job, is Analyze job's, unless the file
    // has one by its name now.
    expect(parseModels({ main: null, tasks: { 'fit-check': 'haiku' } })).toEqual({
      main: null,
      tasks: { 'analyze-job': 'haiku' },
    });
    for (const tasks of [
      { 'fit-check': 'haiku', 'analyze-job': 'sonnet' },
      { 'analyze-job': 'sonnet', 'fit-check': 'haiku' },
    ]) {
      expect(parseModels({ main: null, tasks })?.tasks).toEqual({ 'analyze-job': 'sonnet' });
    }
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
