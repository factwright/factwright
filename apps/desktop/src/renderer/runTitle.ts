import type { Job } from '@factwright/core';
import { REVISE_SKILL } from '../shared/revision.ts';
import {
  FACTS_SKILL,
  GET_STARTED_SKILL,
  HISTORY_SKILL,
  type RunTask,
  SEARCH_SKILL,
  TEMPLATE_SKILL,
  THANKS_SKILL,
  taskJob,
} from '../shared/runs.ts';
import { RUN_ACTIONS } from './jobs/RunActions.tsx';

/** What a task on a job is, as its button names it, such as "Tailored resume". */
export function taskLabel(task: RunTask): string | undefined {
  if (task.skill === 'ask') return 'Your question';
  if (task.skill === REVISE_SKILL) return 'Resume revision';
  if (task.skill === THANKS_SKILL) return 'Thank-you notes';
  if ('callId' in task) return 'practice' in task && task.practice ? 'Practice' : 'Call prep';
  if ('quick' in task) return 'Quick resume';
  return RUN_ACTIONS.find((action) => action.skill === task.skill)?.label;
}

/** What each task on the job hunt as a whole is called. */
const HUNT_TITLES: Readonly<Record<string, string>> = {
  [SEARCH_SKILL]: 'Job search',
  [GET_STARTED_SKILL]: 'Getting to know you',
  [FACTS_SKILL]: 'Your fact bank',
  [TEMPLATE_SKILL]: 'A template of your own',
  [HISTORY_SKILL]: 'Your work history',
};

/**
 * A run's name, as its tab, its bar and the dialogs it asks in name it: its job's company, then
 * the task, such as "Talkiatry · Tailored resume", or the task on the job hunt as a whole, such
 * as "Job search", or just "Claude" for Claude with no task, waiting for what the user types.
 */
export function runTitle(task: RunTask | null, jobs: readonly Job[]): string {
  if (!task) return 'Claude';
  const hunt = HUNT_TITLES[task.skill];
  if (hunt) return hunt;
  const job = jobs.find((each) => each.id === taskJob(task));
  const label = taskLabel(task);
  if (job && label) return `${job.company} · ${label}`;
  return label ?? 'Claude';
}
