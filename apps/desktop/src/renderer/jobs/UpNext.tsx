import type { Job, StepAction } from '@factwright/core';
import { Button } from '@factwright/ui';
import { Check, LoaderCircle, Sparkles } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { type RunSkill, type RunTask, taskCall, taskJob } from '../../shared/runs.ts';
import { FOCUS_NEXT } from './Decide.tsx';
import { showSection } from './PanelSection.tsx';
import { BUSY, type RunControls } from './RunActions.tsx';
import type { JobRow } from './rows.ts';
import styles from './UpNext.module.css';

const TONE = { urgent: styles.urgent, action: styles.action, info: styles.info } as const;

/** The skill that does each step Claude does. */
const CLAUDE_STEPS: Readonly<Partial<Record<StepAction['kind'], RunSkill>>> = {
  'fit-check': 'fit-check',
  resume: 'focused-resume',
  letter: 'cover-letter',
  projects: 'projects-page',
};

/** The run that does a step, when it's Claude's to do. */
function runFor(job: Job, action: StepAction): RunTask | null {
  if (action.kind === 'prep') {
    return { skill: 'interview-prep', jobId: job.id, callId: action.callId };
  }
  const skill = CLAUDE_STEPS[action.kind];
  return skill ? { skill, jobId: job.id } : null;
}

/** Whether a run is this one: the same skill, on the same job and call. */
const isRun = (task: RunTask | null, run: RunTask) =>
  task?.skill === run.skill && taskJob(task) === taskJob(run) && taskCall(task) === taskCall(run);

/**
 * What to do next for a job, at the top of its panel: the step the list shows for it, in the same
 * words, and the button that does it: Start with Claude for what Claude does, such as tailoring a
 * resume, or Mark as applied, or Done for the user's own reminder. A job not sorted yet has its
 * quick choices here too.
 */
export function UpNext({
  row,
  api,
  run,
  onApplied,
  children,
}: {
  row: JobRow;
  api: FactwrightApi;
  /** Claude's panel, once Claude is ready, for the steps Claude does. */
  run?: RunControls | undefined;
  onApplied: () => void;
  /** What goes under the step, such as where to sort a new job. */
  children?: ReactNode;
}) {
  const headingId = useId();
  const [problem, setProblem] = useState<{ jobId: string; message: string } | null>(null);
  const { job, next } = row;
  if (!next && !children) return null;
  const action = next?.action;
  const claude = action ? runFor(job, action) : null;
  const busy = run ? BUSY.includes(run.phase) : false;
  const running = Boolean(claude && busy && isRun(run?.task ?? null, claude));

  const clearReminder = async () => {
    const result = await api.updateJob(job.id, { nextAction: null, nextOn: null });
    setProblem(result.ok ? null : { jobId: job.id, message: result.message });
  };

  let button: ReactNode = null;
  if (claude && running) {
    button = (
      <span className={styles.running}>
        <LoaderCircle className={styles.spin} size={14} aria-hidden="true" />
        Claude is on it
      </span>
    );
  } else if (claude) {
    button = (
      <Button
        size="sm"
        variant="primary"
        icon={<Sparkles size={14} aria-hidden="true" />}
        disabled={!run || busy}
        onClick={() => run?.start(claude)}
        {...FOCUS_NEXT}
      >
        Start with Claude
      </Button>
    );
  } else if (action?.kind === 'apply') {
    button = (
      <Button size="sm" variant="primary" onClick={onApplied} {...FOCUS_NEXT}>
        Mark as applied
      </Button>
    );
  } else if (action?.kind === 'debrief') {
    button = (
      <Button size="sm" variant="primary" onClick={() => showSection('calls')}>
        Say how it went
      </Button>
    );
  } else if (action?.kind === 'reminder') {
    button = (
      <Button
        size="sm"
        icon={<Check size={14} aria-hidden="true" />}
        aria-label="Done: clear the reminder"
        onClick={() => void clearReminder()}
      >
        Done
      </Button>
    );
  }

  return (
    <section
      className={`${styles.box} ${next ? TONE[next.level] : ''}`}
      aria-labelledby={headingId}
    >
      <h3 id={headingId} className={styles.kicker}>
        Up next
      </h3>
      {next && (
        <div className={styles.stepRow}>
          <p className={styles.step}>{next.text}</p>
          {button}
        </div>
      )}
      {claude && !run && (
        <p className={styles.hint}>
          Your Claude isn’t ready yet. The card in the sidebar says what to do.
        </p>
      )}
      {children}
      {problem?.jobId === job.id && (
        <p className={styles.problem} role="alert">
          {problem.message}
        </p>
      )}
    </section>
  );
}
