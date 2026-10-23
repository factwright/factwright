import {
  type RunRequestAnswer,
  type RunSkill,
  type RunTask,
  taskCall,
  taskJob,
} from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';

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

/** What the job's panel needs from Claude's panel to start and follow runs. */
export interface RunControls {
  phase: RunPhase;
  task: RunTask | null;
  start: (task: RunTask) => void;
  /** Brings Claude's panel back, such as when its run is clicked again. */
  show: () => void;
}

/** While Claude is busy, other runs wait. */
export const BUSY: readonly RunPhase[] = ['starting', 'working', 'needs-answer'];

/**
 * Whether a run the app asks for starts now, as when the browser extension asks for drafts of a
 * form's questions: only once Claude Code is ready, and while Claude isn't busy.
 */
export const requestedRun = (ready: boolean, phase: RunPhase): RunRequestAnswer =>
  !ready ? 'not-ready' : BUSY.includes(phase) ? 'busy' : 'started';

/** Whether a run is this one: the same skill, on the same job and call. */
export const isSameRun = (task: RunTask | null, run: RunTask) =>
  task?.skill === run.skill && taskJob(task) === taskJob(run) && taskCall(task) === taskCall(run);

/**
 * Where a task stands for its button: running now, or waiting while Claude does another, or
 * until Claude Code is ready.
 */
export function runState(
  run: RunControls | undefined,
  task: RunTask,
): { running: boolean; disabled: boolean } {
  const busy = run ? BUSY.includes(run.phase) : false;
  const running = Boolean(run && busy && isSameRun(run.task, task));
  return { running, disabled: !run || (busy && !running) };
}
