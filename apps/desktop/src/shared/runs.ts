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

/** What the window asks the app to run: a skill on one job, or a job search. */
export type RunTask = { skill: RunSkill; jobId: string } | { skill: typeof SEARCH_SKILL };

/** The job a task runs on, or null for a job search. */
export const taskJob = (task: RunTask | null): string | null =>
  task && 'jobId' in task ? task.jobId : null;
