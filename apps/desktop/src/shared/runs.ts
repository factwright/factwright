/**
 * The skills a job's panel can run on it, by their names in Factwright's plugin: its Run buttons,
 * then answering the user's own questions about the job.
 */
export const RUN_SKILLS = [
  'focused-resume',
  'fit-check',
  'salary-check',
  'who-to-message',
  'interview-prep',
  'answer-questions',
  'ask',
] as const;

export type RunSkill = (typeof RUN_SKILLS)[number];

/** The skill the jobs page runs to find new jobs, on no job in particular. */
export const SEARCH_SKILL = 'job-search';

/** The skill that gets to know a new user: their fact bank, then their starting resumes. */
export const GET_STARTED_SKILL = 'get-started';

/** The skill that adds to the fact bank, from an interview or from what the user shared. */
export const FACTS_SKILL = 'add-facts';

/** The skill that makes a resume template in the look of a resume the user likes. */
export const TEMPLATE_SKILL = 'make-template';

/**
 * A resume the user wants a template copied from, by the name the app gave it when it kept it
 * in templates/sources: the day it was added, and a number.
 */
export const TEMPLATE_SOURCE = /^\d{4}-\d{2}-\d{2}-\d{1,3}\.(?:pdf|png|jpg|webp)$/;

/**
 * What the window asks the app to run: a skill on one job, or one of the user's questions about
 * it, a job search, getting started (or only its starting resumes), more facts, from an
 * interview or from new files and notes, or a template in the look of a resume the user likes.
 */
export type RunTask =
  | { skill: RunSkill; jobId: string }
  | { skill: 'ask'; jobId: string; askId: string }
  | { skill: typeof SEARCH_SKILL }
  | { skill: typeof GET_STARTED_SKILL; mode?: 'resumes' }
  | { skill: typeof FACTS_SKILL; mode: 'interview' | 'new' }
  | { skill: typeof TEMPLATE_SKILL; source: string };

/** The skills the app starts that aren't for one job. */
export const HUNT_SKILLS = [SEARCH_SKILL, GET_STARTED_SKILL, FACTS_SKILL, TEMPLATE_SKILL] as const;

/**
 * What a run may change without asking. A run started to get to know the user, or to add facts,
 * may save their facts, starting resumes and guide. A run started to make a template may save
 * templates, and nothing else: the resume it copies came from anywhere. Every other run asks
 * first. Neither reads the web.
 */
export type RunScope = 'hunt' | 'profile' | 'template';

export function scopeOf(task: RunTask | null | undefined): RunScope {
  if (task?.skill === GET_STARTED_SKILL || task?.skill === FACTS_SKILL) return 'profile';
  return task?.skill === TEMPLATE_SKILL ? 'template' : 'hunt';
}

/** The job a task runs on, or null for one on the whole job hunt. */
export const taskJob = (task: RunTask | null): string | null =>
  task && 'jobId' in task ? task.jobId : null;
