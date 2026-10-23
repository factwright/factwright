import { REVISE_SKILL, type TemplateChoice } from './revision.ts';

/**
 * The skills a job's panel can run on it, by their names in Factwright's plugin: its Run buttons,
 * then answering the user's own questions about the job.
 */
export const RUN_SKILLS = [
  'focused-resume',
  'cover-letter',
  'projects-page',
  'fit-check',
  'salary-check',
  'who-to-message',
  'interview-prep',
  'answer-questions',
  'ask',
] as const;

export type RunSkill = (typeof RUN_SKILLS)[number];

/** The skills that make what the user sends, of which a job keeps versions. */
export const VERSION_SKILLS = ['focused-resume', 'cover-letter', 'projects-page'] as const;

export type VersionSkill = (typeof VERSION_SKILLS)[number];

/** The skill that drafts thank-you notes after one of a job's calls, for the user to send. */
export const THANKS_SKILL = 'thank-you';

/** The skill the jobs page runs to find new jobs, on no job in particular. */
export const SEARCH_SKILL = 'job-search';

/**
 * The places Find jobs offers to search: Hacker News's monthly "Who is hiring?" thread,
 * LinkedIn's and Indeed's listings, and companies' own job boards on the applicant systems.
 * Claude finds LinkedIn's and Indeed's through web search and reads each job on the employer's
 * own site. It never opens LinkedIn.
 */
export const SEARCH_SITES = ['hn', 'linkedin', 'indeed', 'boards'] as const;

export type SearchSite = (typeof SEARCH_SITES)[number];

/**
 * Where a job search looks, and for what: the places picked, a company the user has in mind,
 * one kind of job, when the user wants more than one, and a focus for this search alone.
 */
export interface SearchSources {
  sites: SearchSite[];
  /** Which month's HN thread, as YYYY-MM. Without one, the newest. */
  month?: string;
  /** A company's name, or a link to its careers page or job board. */
  company?: string;
  /** The kind of job to look for, by its id. Without one, every kind. */
  kind?: string;
  /**
   * What this search alone looks for, on top of what the user wants in Profile, by the ID the
   * app kept it under: searches/focus/<id>.json, which the search reads with search_focus.
   */
  focus?: string;
}

/** A month as YYYY-MM. */
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Marks Windows' command line would act on, even in quotes, when it starts Claude Code. */
export const COMMAND_LINE_MARKS = /[%!]/;

/**
 * A company's name or a link to its jobs, as the user typed it, in a form that's safe to type
 * into Claude: an https link, or a name of up to 80 letters, digits and common marks. Anything
 * else, such as a line break, is null. So is a link with % or !, which Windows' command line
 * would fill in when it starts Claude Code with the search.
 */
export function searchCompany(text: string): string | null {
  const typed = text.trim();
  if (/^[a-z]+:/i.test(typed)) {
    if (typed.length > 500 || /[\s\p{C}]/u.test(typed)) return null;
    try {
      const url = new URL(typed);
      const safe = url.protocol === 'https:' && !url.username && !url.password;
      return safe && !COMMAND_LINE_MARKS.test(url.href) ? url.href : null;
    } catch {
      return null;
    }
  }
  return /^[\p{L}\p{N}][\p{L}\p{N} &.,'’()+-]{0,79}$/u.test(typed) ? typed : null;
}

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
 * it, prep for one of its calls or practice for it, thank-you notes after one, a job search
 * (where the user picked, or wherever Claude asks), getting started (or only its starting
 * resumes), more facts, from an interview or from new files and notes, a template in the look of
 * a resume the user likes, or a revision of a job's resume for what its ATS X-ray found. A new
 * version of a job's resume, cover letter or Projects page comes once the app has kept the one
 * before, and changes the user asked for in their own words reach the run through a tool.
 */
export type RunTask =
  | { skill: RunSkill; jobId: string }
  | { skill: VersionSkill; jobId: string; again: true }
  | { skill: typeof REVISE_SKILL | 'cover-letter'; jobId: string; changes: true }
  | { skill: 'ask'; jobId: string; askId: string }
  | { skill: 'interview-prep'; jobId: string; callId: string; practice?: true }
  | { skill: typeof THANKS_SKILL; jobId: string; callId: string }
  | { skill: typeof SEARCH_SKILL; sources?: SearchSources }
  | { skill: typeof GET_STARTED_SKILL; mode?: 'resumes' }
  | { skill: typeof FACTS_SKILL; mode: 'interview' | 'new' }
  | { skill: typeof TEMPLATE_SKILL; source: string }
  | {
      skill: typeof REVISE_SKILL;
      jobId: string;
      /** The resume's file in the job's folder. */
      resume: string;
      /** The IDs of the findings to fix, as the X-ray gave them. */
      findings: string[];
      template?: TemplateChoice;
    };

/** The skills the app starts that aren't for one job. */
export const HUNT_SKILLS = [SEARCH_SKILL, GET_STARTED_SKILL, FACTS_SKILL, TEMPLATE_SKILL] as const;

/**
 * What a run may change without asking. A run started to get to know the user, or to add facts,
 * may save their facts, starting resumes and guide. A run started to make a template may read
 * and save templates, and nothing else, and may replace only the ones it saved: the resume it
 * copies came from anywhere. A revision may do what a run on the job hunt does, but reads what
 * the X-ray found in a posting, and needs nothing from the web, so it can't reach it. Every
 * other run asks first. None of the last three reads the web.
 */
export type RunScope = 'hunt' | 'profile' | 'template' | 'revise';

export function scopeOf(task: RunTask | null | undefined): RunScope {
  if (task?.skill === GET_STARTED_SKILL || task?.skill === FACTS_SKILL) return 'profile';
  if (task?.skill === REVISE_SKILL) return 'revise';
  return task?.skill === TEMPLATE_SKILL ? 'template' : 'hunt';
}

/** The job a task runs on, or null for one on the whole job hunt. */
export const taskJob = (task: RunTask | null): string | null =>
  task && 'jobId' in task ? task.jobId : null;

/** The call a task works on, such as prep for it, or null for one on no call in particular. */
export const taskCall = (task: RunTask | null): string | null =>
  task && 'callId' in task ? task.callId : null;
