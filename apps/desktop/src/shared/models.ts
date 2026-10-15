import type { PlanLevels } from './levels.ts';
import { HUNT_SKILLS, RUN_SKILLS, type RunTask } from './runs.ts';

/**
 * The models a run can use, by Claude Code's names for them. Each name means the newest model
 * of that kind, so the choice stays current as new ones come out.
 */
export const MODELS = ['opus', 'sonnet', 'haiku'] as const;

export type Model = (typeof MODELS)[number];

export const MODEL_NAMES: Readonly<Record<Model, string>> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

/** The tasks the app starts, each of which can have its own model. */
export const MODEL_TASKS = [...RUN_SKILLS, ...HUNT_SKILLS] as const;

export type ModelTask = (typeof MODEL_TASKS)[number];

/** Each task's model until the user chooses: Opus, the most careful, for everything. */
export const RECOMMENDED_MODELS: Readonly<Record<ModelTask, Model>> = {
  'focused-resume': 'opus',
  'cover-letter': 'opus',
  'fit-check': 'opus',
  'salary-check': 'opus',
  'who-to-message': 'opus',
  'interview-prep': 'opus',
  'answer-questions': 'opus',
  ask: 'opus',
  'job-search': 'opus',
  'get-started': 'opus',
  'add-facts': 'opus',
  'make-template': 'opus',
};

/**
 * Each task's model with Pro's levels: Sonnet, which uses less of a plan, for the checks and
 * searches, and Opus for the fact-checked writing and getting to know the user.
 */
export const PRO_MODELS: Readonly<Record<ModelTask, Model>> = {
  'focused-resume': 'opus',
  'cover-letter': 'opus',
  'fit-check': 'sonnet',
  'salary-check': 'sonnet',
  'who-to-message': 'sonnet',
  'interview-prep': 'opus',
  'answer-questions': 'opus',
  ask: 'opus',
  'job-search': 'sonnet',
  'get-started': 'opus',
  'add-facts': 'opus',
  'make-template': 'opus',
};

/**
 * The model a task gets with the plan's levels until the user chooses. A run with no task gets
 * what the writing gets.
 */
export function recommendedModel(task: ModelTask | undefined, levels: PlanLevels = 'best'): Model {
  return (levels === 'pro' ? PRO_MODELS : RECOMMENDED_MODELS)[task ?? 'focused-resume'];
}

/** Which model Claude runs on: one for everything or each task's own, and any task's choice. */
export interface ModelChoices {
  /** One model for every task, or null for each task's recommended model. */
  main: Model | null;
  tasks: Partial<Record<ModelTask, Model>>;
}

/** Each task's recommended model, until the user chooses otherwise. */
export const DEFAULT_MODELS: ModelChoices = { main: null, tasks: {} };

const isModel = (value: unknown): value is Model =>
  typeof value === 'string' && (MODELS as readonly string[]).includes(value);

/** Model choices from the window or a file, or null when they aren't ones the app knows. */
export function parseModels(value: unknown): ModelChoices | null {
  if (typeof value !== 'object' || value === null) return null;
  const { main, tasks } = value as Record<string, unknown>;
  if (main !== null && !isModel(main)) return null;
  if (typeof tasks !== 'object' || tasks === null) return null;
  const chosen: Partial<Record<ModelTask, Model>> = {};
  for (const [task, model] of Object.entries(tasks)) {
    if (!(MODEL_TASKS as readonly string[]).includes(task) || !isModel(model)) return null;
    chosen[task as ModelTask] = model;
  }
  return { main, tasks: chosen };
}

/**
 * The model a task gets when it has no choice of its own: the one for everything, or its
 * recommended model with the plan's levels.
 */
export const modelWithout = (choices: ModelChoices, task?: ModelTask, levels?: PlanLevels): Model =>
  choices.main ?? recommendedModel(task, levels);

/**
 * The model a run uses: its task's own, the one for everything, or the task's recommended model
 * with the plan's levels.
 */
export const modelFor = (
  choices: ModelChoices,
  task?: RunTask | null,
  levels?: PlanLevels,
): Model => (task && choices.tasks[task.skill]) || modelWithout(choices, task?.skill, levels);
