import type { Job } from '@factwright/core';
import { Tooltip, VisuallyHidden } from '@factwright/ui';
import { Check, LoaderCircle } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { type RunSkill, type RunTask, taskCall, taskJob } from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import { AskDialog } from './AskSection.tsx';
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

/** Where a skill stands on a job: running, just done, or made or run before. */
type State = 'running' | 'done' | 'ready' | 'ran';

const STATE_WORDS: Readonly<Record<State, string>> = {
  running: 'running',
  done: 'done',
  ready: 'ready',
  ran: 'ran before',
};

function stateOf(job: Job, skill: RunSkill, running: boolean, done: boolean): State | null {
  if (running) return 'running';
  if (done) return 'done';
  if (skill === 'fit-check' && job.fit) return 'ran';
  if (skill === 'answer-questions' && job.docKinds.includes('answers')) return 'ran';
  if (skill === 'focused-resume' && job.files.length > 0) return 'ready';
  if (skill === 'cover-letter' && job.letters.length > 0) return 'ready';
  if (skill === 'projects-page' && job.projectPages.length > 0) return 'ready';
  return null;
}

/** One button in the row: its name, a mark for where it stands, and what it does on hover. */
function ActionButton({
  label,
  why,
  state,
  disabled,
  onClick,
}: {
  label: string;
  why: ReactNode;
  state: State | null;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={why}>
      {(trigger) => (
        <button
          type="button"
          {...trigger}
          className={`${styles.action} ${state ? styles[state] : ''}`}
          disabled={disabled}
          onClick={onClick}
        >
          {state === 'running' ? (
            <LoaderCircle className={styles.spin} size={14} aria-hidden="true" />
          ) : (
            state && (
              <Check className={styles.mark} size={14} strokeWidth={2.6} aria-hidden="true" />
            )
          )}
          {label}
          {state && <VisuallyHidden>, {STATE_WORDS[state]}</VisuallyHidden>}
        </button>
      )}
    </Tooltip>
  );
}

/**
 * Everything Claude can do for this job, in one row at the top of its panel: each skill, with a
 * mark once it's running or has run, and what it does on hover, then a question about the job.
 * The application's questions get pasted in first, and so does the question.
 */
export function RunActions({ job, run, api }: { job: Job; run: RunControls; api: FactwrightApi }) {
  const busy = BUSY.includes(run.phase);
  const [pasting, setPasting] = useState(false);
  const [asking, setAsking] = useState(false);
  const begin = (skill: RunSkill) =>
    skill === 'answer-questions' ? setPasting(true) : run.start({ skill, jobId: job.id });
  // A run for one of the job's calls, such as its prep, has a button of its own there.
  const mine = (skill: string) =>
    run.task?.skill === skill && taskJob(run.task) === job.id && taskCall(run.task) === null;
  const asked = mine('ask');
  return (
    <div className={styles.section}>
      <fieldset className={styles.actions}>
        <legend className={styles.legend}>Run with your Claude</legend>
        <div className={styles.row}>
          {RUN_ACTIONS.map(({ skill, label, why }) => {
            const running = mine(skill) && busy;
            const done = mine(skill) && run.phase === 'done';
            return (
              <ActionButton
                key={skill}
                label={label}
                why={why}
                state={stateOf(job, skill, running, done)}
                disabled={busy && !running}
                onClick={() => (running ? run.show() : begin(skill))}
              />
            );
          })}
          <ActionButton
            label="Ask a question"
            why="Anything about this job, such as what to expect from a call. The answer stays here."
            state={asked && busy ? 'running' : asked && run.phase === 'done' ? 'done' : null}
            disabled={busy && !asked}
            onClick={() => (asked && busy ? run.show() : setAsking(true))}
          />
        </div>
      </fieldset>
      {pasting && (
        <QuestionsDialog
          job={job}
          api={api}
          onAnswer={() => run.start({ skill: 'answer-questions', jobId: job.id })}
          onClose={() => setPasting(false)}
        />
      )}
      {asking && (
        <AskDialog
          job={job}
          api={api}
          onAsked={(askId) => run.start({ skill: 'ask', jobId: job.id, askId })}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  );
}
