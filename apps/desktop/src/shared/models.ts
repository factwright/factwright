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

/** Which model Claude runs on: one for everything, and any task that's chosen its own. */
export interface ModelChoices {
  main: Model;
  tasks: Partial<Record<ModelTask, Model>>;
}

/** Opus for everything, until the user chooses otherwise. */
export const DEFAULT_MODELS: ModelChoices = { main: 'opus', tasks: {} };

const isModel = (value: unknown): value is Model =>
  typeof value === 'string' && (MODELS as readonly string[]).includes(value);

/** Model choices from the window or a file, or null when they aren't ones the app knows. */
export function parseModels(value: unknown): ModelChoices | null {
  if (typeof value !== 'object' || value === null) return null;
  const { main, tasks } = value as Record<string, unknown>;
  if (!isModel(main) || typeof tasks !== 'object' || tasks === null) return null;
  const chosen: Partial<Record<ModelTask, Model>> = {};
  for (const [task, model] of Object.entries(tasks)) {
    if (!(MODEL_TASKS as readonly string[]).includes(task) || !isModel(model)) return null;
    chosen[task as ModelTask] = model;
  }
  return { main, tasks: chosen };
}

/** The model a run uses: its task's own, or the one for everything. */
export const modelFor = (choices: ModelChoices, task?: RunTask | null): Model =>
  (task && choices.tasks[task.skill]) || choices.main;
