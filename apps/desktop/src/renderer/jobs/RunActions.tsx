import type { RunPhase, RunView } from '../../shared/api.ts';
import {
  type RunRequestAnswer,
  type RunSkill,
  type RunTask,
  taskCall,
  taskJob,
} from '../../shared/runs.ts';

/** What each skill does for a job, as its panel offers it, in the approved order. */
export const RUN_ACTIONS: readonly { skill: RunSkill; label: string; why: string }[] = [
  {
    skill: 'focused-resume',
    label: 'Tailored resume',
    why: 'A resume for this job, every line traced to a fact',
  },
  {
    skill: 'cover-letter',
    label: 'Cover letter',
    why: 'A letter for this job, from your facts, in your voice',
  },
  {
    skill: 'projects-page',
    label: 'Projects page',
    why: 'Your projects in depth, on one page, for jobs where they help',
  },
  { skill: 'fit-check', label: 'Fit check', why: 'Score the job against your fact bank' },
  {
    skill: 'salary-check',
    label: 'Salary check',
    why: 'Estimate the pay when the posting doesn’t say',
  },
  {
    skill: 'who-to-message',
    label: 'Who to message',
    why: 'People worth contacting, with drafts you send',
  },
  {
    skill: 'interview-prep',
    label: 'Interview prep',
    why: 'A prep sheet for a call or an interview',
  },
  {
    skill: 'answer-questions',
    label: 'Application questions',
    why: 'Answers to the form, in your own voice',
  },
];

/** While a run has work going, its task's buttons say Claude is on it. */
export const BUSY: readonly RunPhase[] = ['starting', 'working', 'needs-answer'];

/** Where a task stands for Claude: it has a run going now, or it waits in line for one. */
export type TaskState = 'running' | 'in-line';

/** What the job's panel needs from Claude's panel to start and follow runs. */
export interface RunControls {
  /** Where a task stands, or null when it has no run going and isn't in line. */
  stateOf: (task: RunTask) => TaskState | null;
  /** Every task Claude has going or waiting in line on a job, and where each stands. */
  tasksOn: (jobId: string) => readonly { task: RunTask; state: TaskState }[];
  /**
   * Starts a task in a run of its own, or puts it in line for its turn, behind any other task on
   * the same job.
   */
  start: (task: RunTask) => void;
  /** Brings a task's tab forward in Claude's panel, such as when its button is clicked again. */
  show: (task: RunTask) => void;
}

/**
 * The job panel's run controls, from Claude's runs: each task by where it stands, going now or
 * waiting in line for its turn. A run that's done, stopped or failed has nothing going.
 */
export function runControlsFor(
  runs: readonly Pick<RunView, 'id' | 'task' | 'phase'>[],
  start: (task: RunTask) => void,
  show: (runId: string | undefined) => void,
): RunControls {
  const coming = runs.flatMap((run) =>
    run.task && (run.phase === 'in-line' || BUSY.includes(run.phase))
      ? [{ id: run.id, task: run.task, state: run.phase === 'in-line' ? 'in-line' : 'running' }]
      : [],
  ) as { id: string; task: RunTask; state: TaskState }[];
  return {
    stateOf: (task) => coming.find((run) => isSameRun(run.task, task))?.state ?? null,
    tasksOn: (jobId) =>
      coming
        .filter((run) => taskJob(run.task) === jobId)
        .map(({ task, state }) => ({ task, state })),
    start,
    // The run going now, or waiting, for the task, or else the last one there was for it.
    show: (task) =>
      show(
        (
          coming.find((run) => isSameRun(run.task, task)) ??
          runs.findLast((run) => run.task !== null && isSameRun(run.task, task))
        )?.id,
      ),
  };
}

/**
 * Whether a run the app asks for starts now, as when the browser extension asks for drafts of a
 * form's questions: only once Claude Code is ready, and while it can start without waiting in line.
 */
export const requestedRun = (ready: boolean, startsNow: boolean): RunRequestAnswer =>
  !ready ? 'not-ready' : startsNow ? 'started' : 'busy';

/** Whether a task is practice for a call, rather than prep for it. */
const practices = (task: RunTask | null) => Boolean(task && 'practice' in task && task.practice);

/**
 * Whether a run is this one: the same skill, on the same job and call, and practice for a call
 * only as practice. A quick resume is its job's tailored resume, made another way.
 */
export const isSameRun = (task: RunTask | null, run: RunTask) =>
  task?.skill === run.skill &&
  taskJob(task) === taskJob(run) &&
  taskCall(task) === taskCall(run) &&
  practices(task) === practices(run);

/**
 * Where a task stands for its button: running now, or waiting in line for its turn, or until
 * Claude Code is ready. A task that changes the job's files before its run starts, such as keeping
 * the version before a new one, waits while Claude has another task going on the job, or in line
 * for it (`alone`).
 */
export function runState(
  run: RunControls | undefined,
  task: RunTask,
  alone = false,
): { running: boolean; inLine: boolean; disabled: boolean } {
  const state = run ? run.stateOf(task) : null;
  const jobId = taskJob(task);
  const jobBusy = Boolean(run && jobId && run.tasksOn(jobId).length > 0);
  return {
    running: state === 'running',
    inLine: state === 'in-line',
    disabled: !run || (alone && state === null && jobBusy),
  };
}
