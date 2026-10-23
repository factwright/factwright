import {
  EFFORT_NAMES,
  EFFORTS,
  type Effort,
  type EffortChoices,
  effortWithout,
} from '../shared/effort.ts';
import type { PlanLevels } from '../shared/levels.ts';
import {
  MODEL_NAMES,
  MODEL_TASKS,
  MODELS,
  type Model,
  type ModelChoices,
  type ModelTask,
  modelWithout,
} from '../shared/models.ts';

/** Each task the app starts, as a sentence names it, such as "Job searches at High". */
const TASK_NAMES: Readonly<Record<ModelTask, string>> = {
  'focused-resume': 'Tailored resumes',
  'cover-letter': 'Cover letters',
  'projects-page': 'Projects pages',
  'fit-check': 'Fit checks',
  'salary-check': 'Salary checks',
  'who-to-message': 'Who to message',
  'interview-prep': 'Interview prep',
  'answer-questions': 'Application questions',
  ask: 'Questions about a job',
  'job-search': 'Job searches',
  'get-started': 'Getting started',
  'add-facts': 'Fact bank interviews',
  'make-template': 'Making templates',
  'work-history': 'Work history',
};

/** A level Claude runs a task at: its model, and how hard it thinks. */
export interface Level {
  model: Model;
  effort: Effort;
}

/** The level each task runs at, from the user's choices, or else the plan's suggested levels. */
export function taskLevels(
  models: ModelChoices,
  effort: EffortChoices,
  levels: PlanLevels,
): Record<ModelTask, Level> {
  return Object.fromEntries(
    MODEL_TASKS.map((task) => [
      task,
      {
        model: models.tasks[task] ?? modelWithout(models, task, levels),
        effort: effort.tasks[task] ?? effortWithout(effort, task, levels),
      },
    ]),
  ) as Record<ModelTask, Level>;
}

/** A level in a few words, such as "Opus · Extra high". */
export const levelName = ({ model, effort }: Level): string =>
  `${MODEL_NAMES[model]} · ${EFFORT_NAMES[effort]}`;

const same = (one: Level, other: Level) => one.model === other.model && one.effort === other.effort;

// Higher is more careful: Opus over Sonnet over Haiku, and Max effort over the rest.
const modelRank = (model: Model) => MODELS.length - MODELS.indexOf(model);
const effortRank = (effort: Effort) => EFFORTS.indexOf(effort);

/** Whether a level is no more careful than another, in its model or its effort. */
const atMost = (level: Level, than: Level) =>
  modelRank(level.model) <= modelRank(than.model) &&
  effortRank(level.effort) <= effortRank(than.effort);

/**
 * What most tasks run at, and a few words on the ones that don't, such as "Job searches at High"
 * or "Lighter for 4 tasks". When it's a tie, the level the writing runs at counts as most.
 */
export function summarize(each: Record<ModelTask, Level>): { most: Level; others: string } {
  const all = MODEL_TASKS.map((task) => each[task]);
  const count = (level: Level) => all.filter((other) => same(other, level)).length;
  const most = all.reduce((best, level) => (count(level) > count(best) ? level : best));
  const others = MODEL_TASKS.filter((task) => !same(each[task], most));
  const [only] = others;
  if (!only) return { most, others: 'For every task' };
  if (others.length === 1) {
    const level = each[only];
    const model = level.model === most.model ? '' : ` on ${MODEL_NAMES[level.model]}`;
    const effort = level.effort === most.effort ? '' : ` at ${EFFORT_NAMES[level.effort]}`;
    return { most, others: `${TASK_NAMES[only]}${model}${effort}` };
  }
  const lighter = others.every((task) => atMost(each[task], most));
  const heavier = others.every((task) => atMost(most, each[task]));
  const kind = lighter ? 'Lighter' : heavier ? 'More careful' : 'Different';
  return { most, others: `${kind} for ${others.length} tasks` };
}
