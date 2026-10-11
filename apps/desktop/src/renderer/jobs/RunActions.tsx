import type { Job, JobStatus } from '@factwright/core';
import { type RunSkill, type RunTask, taskJob } from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import styles from './RunActions.module.css';

/** What each skill does for a job, as its panel offers it, in the approved order. */
export const RUN_ACTIONS: readonly { skill: RunSkill; label: string; why: string }[] = [
  {
    skill: 'focused-resume',
    label: 'Tailored resume',
    why: 'A resume for this job, every line traced to a fact',
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

type Tone = 'run' | 'ok' | 'quiet';

function stateOf(job: Job, skill: RunSkill, running: boolean, done: boolean): [string, Tone] {
  if (running) return ['Running', 'run'];
  if (done) return ['Done', 'ok'];
  if (skill === 'fit-check' && job.fit) return ['Ran', 'quiet'];
  if (skill === 'focused-resume' && job.files.length > 0) return ['Ready', 'ok'];
  return ['Run', 'run'];
}

/** The skills Claude can run on this job, with where each stands, and the one to do next. */
export function RunActions({
  job,
  status,
  run,
}: {
  job: Job;
  status: JobStatus;
  run: RunControls;
}) {
  const busy = BUSY.includes(run.phase);
  return (
    <section className={styles.section} aria-labelledby={`run-heading-${job.id}`}>
      <h3 id={`run-heading-${job.id}`} className={styles.heading}>
        Run with your Claude
      </h3>
      <div className={styles.actions}>
        {RUN_ACTIONS.map(({ skill, label, why }) => {
          const mine = run.task?.skill === skill && taskJob(run.task) === job.id;
          const running = mine && busy;
          const done = mine && run.phase === 'done';
          const [state, tone] = stateOf(job, skill, running, done);
          const suggested =
            running ||
            (!done &&
              ((status === 'new' && skill === 'fit-check') ||
                (status === 'checked' && skill === 'focused-resume')));
          return (
            <button
              key={skill}
              type="button"
              className={`${styles.action} ${suggested ? styles.suggested : ''}`}
              disabled={busy && !running}
              onClick={() => (running ? run.show() : run.start({ skill, jobId: job.id }))}
            >
              <span className={styles.text}>
                <span className={styles.label}>{label}</span>
                <span className={styles.why}>{why}</span>
              </span>
              <span className={`${styles.state} ${styles[tone]}`}>{state}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
