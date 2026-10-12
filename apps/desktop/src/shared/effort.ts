import { MODEL_TASKS, type ModelTask } from './models.ts';
import type { RunTask } from './runs.ts';

/**
 * How hard Claude thinks before it acts, by Claude Code's names for its effort levels. More is
 * more careful and slower, and uses more of the user's plan. Claude Code lowers a level a model
 * can't reach on its own.
 */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type Effort = (typeof EFFORTS)[number];

export const EFFORT_NAMES: Readonly<Record<Effort, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/**
 * Each task's effort until the user chooses: extra high, the most careful short of max, except
 * job searches, which read hundreds of postings and weigh each one lightly. Max is the user's
 * choice for a task, since it can take many minutes a run and much more of a plan.
 */
export const RECOMMENDED_EFFORT: Readonly<Record<ModelTask, Effort>> = {
  'focused-resume': 'xhigh',
  'fit-check': 'xhigh',
  'salary-check': 'xhigh',
  'who-to-message': 'xhigh',
  'interview-prep': 'xhigh',
  'answer-questions': 'xhigh',
  'job-search': 'high',
  'get-started': 'xhigh',
  'add-facts': 'xhigh',
};

/**
 * Each task's effort on a Pro plan, whose limits are the tightest: high for the writing and
 * judgment calls, and medium for salary checks and job searches.
 */
export const PRO_EFFORT: Readonly<Record<ModelTask, Effort>> = {
  'focused-resume': 'high',
  'fit-check': 'high',
  'salary-check': 'medium',
  'who-to-message': 'high',
  'interview-prep': 'high',
  'answer-questions': 'high',
  'job-search': 'medium',
  'get-started': 'high',
  'add-facts': 'high',
};

/**
 * The effort a task gets on a plan until the user chooses, by Claude Code's name for the plan,
 * such as "pro" or "max". A run with no task gets what the writing gets.
 */
export function recommendedEffort(task: ModelTask | undefined, plan?: string): Effort {
  const levels = plan === 'pro' ? PRO_EFFORT : RECOMMENDED_EFFORT;
  return levels[task ?? 'focused-resume'];
}

/** How hard Claude thinks: one level for everything or each task's own, and any task's choice. */
export interface EffortChoices {
  /** One level for every task, or null for each task's recommended level. */
  main: Effort | null;
  tasks: Partial<Record<ModelTask, Effort>>;
}

/** Each task's recommended level, until the user chooses otherwise. */
export const DEFAULT_EFFORT: EffortChoices = { main: null, tasks: {} };

const isEffort = (value: unknown): value is Effort =>
  typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);

/** Effort choices from the window or a file, or null when they aren't ones the app knows. */
export function parseEffort(value: unknown): EffortChoices | null {
  if (typeof value !== 'object' || value === null) return null;
  const { main, tasks } = value as Record<string, unknown>;
  if (main !== null && !isEffort(main)) return null;
  if (typeof tasks !== 'object' || tasks === null) return null;
  const chosen: Partial<Record<ModelTask, Effort>> = {};
  for (const [task, effort] of Object.entries(tasks)) {
    if (!(MODEL_TASKS as readonly string[]).includes(task) || !isEffort(effort)) return null;
    chosen[task as ModelTask] = effort;
  }
  return { main, tasks: chosen };
}

/**
 * The level a task gets when it has no choice of its own: the one for everything, or its
 * recommended level on the user's plan.
 */
export const effortWithout = (choices: EffortChoices, task?: ModelTask, plan?: string): Effort =>
  choices.main ?? recommendedEffort(task, plan);

/**
 * Whether a task needs more effort than the run that's open gives it. One that needs less runs in
 * the open run, at its effort, so Claude doesn't start over between tasks.
 */
export const needsMore = (open: Effort, wanted: Effort): boolean =>
  EFFORTS.indexOf(wanted) > EFFORTS.indexOf(open);

/**
 * The effort a run uses: its task's own, the one for everything, or the task's recommended level
 * on the user's plan.
 */
export const effortFor = (choices: EffortChoices, task?: RunTask | null, plan?: string): Effort =>
  (task && choices.tasks[task.skill]) || effortWithout(choices, task?.skill, plan);
