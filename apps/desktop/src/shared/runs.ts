/** The skills a job's panel can run on it, by their names in Factwright's plugin. */
export const RUN_SKILLS = [
  'focused-resume',
  'fit-check',
  'salary-check',
  'who-to-message',
  'interview-prep',
  'answer-questions',
] as const;

export type RunSkill = (typeof RUN_SKILLS)[number];

/** The skill the jobs page runs to find new jobs, on no job in particular. */
export const SEARCH_SKILL = 'job-search';

/** The skill that gets to know a new user: their fact bank, then their starting resumes. */
export const GET_STARTED_SKILL = 'get-started';

/** The skill that adds to the fact bank, from an interview or from what the user shared. */
export const FACTS_SKILL = 'add-facts';

/**
 * What the window asks the app to run: a skill on one job, a job search, getting started (or
 * only its starting resumes), or more facts, from an interview or from new files and notes.
 */
export type RunTask =
  | { skill: RunSkill; jobId: string }
  | { skill: typeof SEARCH_SKILL }
  | { skill: typeof GET_STARTED_SKILL; mode?: 'resumes' }
  | { skill: typeof FACTS_SKILL; mode: 'interview' | 'new' };

/** The skills the app starts that work on the whole job hunt rather than one job. */
export const HUNT_SKILLS = [SEARCH_SKILL, GET_STARTED_SKILL, FACTS_SKILL] as const;

/**
 * What a run may change without asking. A run started to get to know the user, or to add facts,
 * may save their facts, starting resumes and guide; every other run asks first.
 */
export type RunScope = 'hunt' | 'profile';

export const scopeOf = (task: RunTask | null | undefined): RunScope =>
  task?.skill === GET_STARTED_SKILL || task?.skill === FACTS_SKILL ? 'profile' : 'hunt';

/** The job a task runs on, or null for one on the whole job hunt. */
export const taskJob = (task: RunTask | null): string | null =>
  task && 'jobId' in task ? task.jobId : null;
