import { asksForCoverLetter, type Job, type JobStatus } from '@factwright/core';
import { useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { type RunSkill, type RunTask, taskJob } from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import { QuestionsDialog } from './QuestionsDialog.tsx';
import styles from './RunActions.module.css';

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
    why: 'A letter for this job, from your facts, in your words',
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
  if (skill === 'answer-questions' && job.docKinds.includes('answers')) return ['Ran', 'quiet'];
  if (skill === 'focused-resume' && job.files.length > 0) return ['Ready', 'ok'];
  if (skill === 'cover-letter' && job.letters.length > 0) return ['Ready', 'ok'];
  return ['Run', 'run'];
}

/**
 * The skills Claude can run on this job, with where each stands, and the one to do next. The
 * application's questions get pasted in first.
 */
export function RunActions({
  job,
  status,
  run,
  api,
}: {
  job: Job;
  status: JobStatus;
  run: RunControls;
  api: FactwrightApi;
}) {
  const busy = BUSY.includes(run.phase);
  const [asking, setAsking] = useState(false);
  const begin = (skill: RunSkill) =>
    skill === 'answer-questions' ? setAsking(true) : run.start({ skill, jobId: job.id });
  return (
    <div className={styles.section}>
      <fieldset className={styles.actions}>
        <legend className={styles.legend}>Run with your Claude</legend>
        {RUN_ACTIONS.map(({ skill, label, why }) => {
          const mine = run.task?.skill === skill && taskJob(run.task) === job.id;
          const running = mine && busy;
          const done = mine && run.phase === 'done';
          const [state, tone] = stateOf(job, skill, running, done);
          // A fit check helps decide on a job, and a resume comes once the user will apply, with
          // a cover letter when the posting asks for one.
          const suggested =
            running ||
            (!done &&
              ((skill === 'fit-check' && !job.fit && (status === 'new' || status === 'review')) ||
                (skill === 'focused-resume' && status === 'apply' && job.files.length === 0) ||
                (skill === 'cover-letter' &&
                  status === 'apply' &&
                  job.letters.length === 0 &&
                  asksForCoverLetter(job))));
          return (
            <button
              key={skill}
              type="button"
              className={`${styles.action} ${suggested ? styles.suggested : ''}`}
              disabled={busy && !running}
              onClick={() => (running ? run.show() : begin(skill))}
            >
              <span className={styles.text}>
                <span className={styles.label}>{label}</span>
                <span className={styles.why}>{why}</span>
              </span>
              <span className={`${styles.state} ${styles[tone]}`}>{state}</span>
            </button>
          );
        })}
      </fieldset>
      {asking && (
        <QuestionsDialog
          job={job}
          api={api}
          onAnswer={() => run.start({ skill: 'answer-questions', jobId: job.id })}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  );
}
