import { CALL_KIND_LABELS, type Job, type JobView, payLabel } from '@factwright/core';
import { FIT_TIER_DISPLAY } from '@factwright/ui';
import type { RunStep } from '../shared/activity.ts';
import { REVISE_SKILL } from '../shared/revision.ts';
import {
  FACTS_SKILL,
  GET_STARTED_SKILL,
  HISTORY_SKILL,
  type RunTask,
  SEARCH_SKILL,
  TEMPLATE_SKILL,
  THANKS_SKILL,
  taskCall,
  taskJob,
} from '../shared/runs.ts';
import type { JobRow } from './jobs/rows.ts';

/** What a job's work looked like, to tell once a run is done what it made. */
interface JobMarks {
  /** Each resume, letter and Projects page file, and each call's documents, by path and time. */
  files: string[];
  letters: string[];
  projectPages: string[];
  callDocs: string[];
  docKinds: string[];
  fit: string | null;
  pay: string | null;
  outreach: string[];
}

/** What the jobs looked like when a task started: every job, and the task's own in more detail. */
export interface RunBefore {
  task: RunTask | null;
  jobIds: readonly string[];
  job: JobMarks | null;
  /** For a run analyzing several jobs, each one's fit check as it started, by the job's ID. */
  fits: Readonly<Record<string, string | null>>;
}

/** Where a run's work is: a job, and the section of its panel, a view of the jobs, or a page. */
export type RunPlace =
  | { jobId: string; section: string | null }
  | { view: JobView }
  | { page: 'facts' | 'profile' };

/** What a finished task made, in a sentence, and where it is. */
export interface RunOutcome {
  text: string;
  place: RunPlace | null;
}

const stamped = (files: readonly { path: string; modified: string }[]) =>
  files.map(({ path, modified }) => `${path}@${modified}`);

function marksOf(job: Job): JobMarks {
  return {
    files: stamped(job.files),
    letters: stamped(job.letters),
    projectPages: stamped(job.projectPages),
    callDocs: job.callDocs.map((doc) => `${doc.callId}/${doc.kind}@${doc.modified}`),
    docKinds: [...job.docKinds],
    fit: job.fit ? JSON.stringify(job.fit) : null,
    pay: job.pay ? JSON.stringify(job.pay) : null,
    outreach: [...job.outreach],
  };
}

/** The jobs as a task starts, to tell later what it made. */
export function runBefore(task: RunTask | null, rows: readonly JobRow[]): RunBefore {
  const jobId = taskJob(task);
  const job = rows.find((row) => row.job.id === jobId)?.job;
  const several = task && 'jobIds' in task ? task.jobIds : [];
  const fits = Object.fromEntries(
    rows
      .filter((row) => several.includes(row.job.id))
      .map((row) => [row.job.id, marksOf(row.job).fit]),
  );
  return { task, jobIds: rows.map((row) => row.job.id), job: job ? marksOf(job) : null, fits };
}

/** Whether a list has something the earlier one didn't, such as a resume built again. */
const gained = (now: readonly string[], was: readonly string[]) =>
  now.some((each) => !was.includes(each));

/** Whether a done step wrote a job's file of this name, for work no other mark shows. */
const wrote = (steps: readonly RunStep[], name: string) =>
  steps.some(
    (step) =>
      step.state === 'done' &&
      ['Write', 'Edit', 'MultiEdit'].includes(step.tool) &&
      (step.detail ?? '').endsWith(`/${name}`),
  );

/** Whether a done step called one of Factwright's tools. */
const called = (steps: readonly RunStep[], tool: string) =>
  steps.some((step) => step.state === 'done' && step.tool === `mcp__factwright__${tool}`);

/**
 * What a finished task made, from how its job, or the jobs, changed since it started, and from
 * what Claude did: a resume, a letter, a job analyzed and so on, said in a sentence with where it
 * is. Null when there's nothing to show for it yet, such as when Claude stopped to ask the user
 * something, or for a task that makes nothing of its own to show. `analyzed` is the jobs its tab
 * counts as done, by their IDs, which include one merged into another of its jobs.
 */
export function runOutcome(
  before: RunBefore,
  rows: readonly JobRow[],
  steps: readonly RunStep[],
  analyzed: readonly string[] = [],
): RunOutcome | null {
  const { task } = before;
  if (!task) return null;
  if (task.skill === SEARCH_SKILL) {
    const found = rows.filter((row) => !before.jobIds.includes(row.job.id)).length;
    return found > 0
      ? {
          text:
            found === 1
              ? 'The job search found a new job.'
              : `The job search found ${found} new jobs.`,
          place: { view: 'new' },
        }
      : null;
  }
  if (task.skill === TEMPLATE_SKILL) {
    return called(steps, 'save_template')
      ? { text: 'Your new template is saved.', place: { page: 'profile' } }
      : null;
  }
  // Several jobs analyzed: each one with a fit check new since the run started, which moves it
  // to To review, and each its tab counts, as one merged into another of them is.
  if ('jobIds' in task) {
    const count = task.jobIds.length;
    const checked = rows.filter(
      ({ job }) =>
        task.jobIds.includes(job.id) &&
        job.fit !== null &&
        marksOf(job).fit !== before.fits[job.id],
    );
    const [first] = checked;
    if (!first) return null;
    const done = new Set([
      ...checked.map(({ job }) => job.id),
      ...analyzed.filter((id) => task.jobIds.includes(id)),
    ]).size;
    const jobs = task.auto ? 'new jobs' : 'jobs';
    const text =
      count === 1
        ? `${first.job.company} is analyzed.`
        : done === count
          ? `All ${count} ${jobs} are analyzed.`
          : `${done} of ${count} ${jobs} are analyzed.`;
    return { text, place: { view: 'review' } };
  }
  const jobId = taskJob(task);
  const was = before.job;
  const row = rows.find((each) => each.job.id === jobId);
  if (!jobId || !was || !row) return null;
  const { job, progress } = row;
  const now = marksOf(job);
  const at = (section: string | null): RunPlace => ({ jobId, section });
  const { company } = job;
  switch (task.skill) {
    case 'focused-resume':
      return gained(now.files, was.files)
        ? {
            text: `Your ${'quick' in task ? 'quick' : 'tailored'} resume for ${company} is ready.`,
            place: at('files'),
          }
        : null;
    case REVISE_SKILL:
      return gained(now.files, was.files)
        ? { text: `Your revised resume for ${company} is ready.`, place: at('files') }
        : null;
    case 'cover-letter':
      return gained(now.letters, was.letters)
        ? { text: `Your cover letter for ${company} is ready.`, place: at('files') }
        : null;
    case 'projects-page':
      return gained(now.projectPages, was.projectPages)
        ? { text: `Your Projects page for ${company} is ready.`, place: at('files') }
        : null;
    case 'analyze-job': {
      if (now.fit === was.fit || !job.fit) return null;
      const score = job.fit.score;
      return {
        text:
          score !== null && progress.tier
            ? `${company} is analyzed: ${score}, ${FIT_TIER_DISPLAY[progress.tier].label}.`
            : `${company} is analyzed.`,
        place: at('fit'),
      };
    }
    case 'salary-check':
      return now.pay !== was.pay && job.pay
        ? {
            text: `The salary check for ${company} is done: ${payLabel(job.pay) ?? job.pay.text}.`,
            place: at('fit'),
          }
        : null;
    case 'who-to-message':
      return gained(now.outreach, was.outreach)
        ? { text: `Messages for people at ${company} are drafted.`, place: at('people') }
        : null;
    case 'answer-questions':
      return gained(now.docKinds, was.docKinds) || wrote(steps, 'answers.md')
        ? { text: `Answers to ${company}’s questions are ready.`, place: at('application') }
        : null;
    case 'ask':
      return called(steps, 'save_answer')
        ? { text: `Claude answered your question about ${company}.`, place: at('asks') }
        : null;
    case THANKS_SKILL:
    case 'interview-prep': {
      const callId = taskCall(task);
      if (!callId) {
        return gained(now.docKinds, was.docKinds) || wrote(steps, 'prep.md')
          ? { text: `Your interview prep for ${company} is ready.`, place: at('calls') }
          : null;
      }
      const kind = task.skill === THANKS_SKILL ? 'thanks' : 'prep';
      const mine = (marks: JobMarks) =>
        marks.callDocs.filter((doc) => doc.startsWith(`${callId}/${kind}@`));
      if (!gained(mine(now), mine(was))) return null;
      const call = job.calls.find((each) => each.id === callId);
      const name = call ? CALL_KIND_LABELS[call.kind].toLowerCase() : 'call';
      return {
        text:
          kind === 'thanks'
            ? `Thank-you notes for your ${name} at ${company} are ready.`
            : `Your prep sheet for the ${name} at ${company} is ready.`,
        place: at('calls'),
      };
    }
    default:
      return null;
  }
}

/**
 * Whether a task makes something to show once it's done, so a run that stops short says so,
 * rather than that Claude is done.
 */
export function makesSomething(task: RunTask | null): boolean {
  if (!task) return false;
  if (task.skill === 'interview-prep' && 'practice' in task && task.practice) return false;
  return ![
    GET_STARTED_SKILL,
    FACTS_SKILL,
    HISTORY_SKILL,
    'who-to-message',
    'salary-check',
  ].includes(task.skill);
}
