import { Button, type RunState, RunStatus, VisuallyHidden } from '@factwright/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RunPhase } from '../shared/api.ts';
import styles from './ClaudePanel.module.css';
import { BUSY } from './jobs/RunActions.tsx';

/** The run's state as the status chip shows it. A run that couldn't start counts as failed. */
export function chipState(phase: RunPhase, problem: string | undefined): RunState {
  return problem ? 'failed' : phase;
}

/**
 * The bar of the run Claude's panel shows: where it stands, what Claude is doing or what it made,
 * how long it's been, whose Claude it is, and what you can do, such as open what it made, or see
 * Claude's work, the terminal under the bar. Stop is for a run that's starting, working or waiting
 * on the user. Otherwise it's Close, which quits Claude Code that's done, or ready with nothing to
 * do, and closes the run's tab in one click, or takes a task waiting in line out of it.
 */
export function PanelHeader({
  title = 'Claude',
  phase,
  plan,
  problem,
  text,
  elapsed = null,
  action = null,
  workShown = false,
  onShowWork,
  onStop,
  onClose,
  finished = false,
  failed = false,
}: {
  /** What the run is, such as "Fit check · Acme". */
  title?: string;
  phase: RunPhase;
  plan: string | undefined;
  problem: string | undefined;
  /** What Claude is doing, what it's waiting for, or what it made. */
  text: ReactNode;
  /** How long the task has taken so far, such as "1:24", while it runs. */
  elapsed?: string | null;
  /** What to do next, such as answering Claude or opening what it made. */
  action?: ReactNode;
  /** Whether Claude's work, the terminal, shows under the bar, for a run that has one. */
  workShown?: boolean;
  onShowWork?: (shown: boolean) => void;
  onStop: () => void;
  /** Closes the run's tab, quitting Claude Code first while it's open. */
  onClose: () => void;
  /** The task is done, with something to show for it. */
  finished?: boolean;
  /** Claude's turn ended in an error, such as a rate limit, though Claude Code is still open. */
  failed?: boolean;
}) {
  const stoppable = BUSY.includes(phase);
  const busy = phase === 'starting' || phase === 'working';
  return (
    <div
      className={`${styles.header} ${busy ? styles.busy : ''} ${finished ? styles.finished : ''}`}
    >
      <span role="status">
        <RunStatus state={failed ? 'failed' : chipState(phase, problem)} />
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.hint}>{problem ?? text}</span>
      {elapsed && (
        <span className={styles.elapsed}>
          <VisuallyHidden>Running for </VisuallyHidden>
          {elapsed}
        </span>
      )}
      <span className={styles.plan}>
        <span className={styles.planDot} aria-hidden="true" />
        {plan ? `Runs on your own Claude · ${plan}` : 'Runs on your own Claude'}
      </span>
      {action}
      {onShowWork && (
        <Button
          size="sm"
          variant="quiet"
          aria-expanded={workShown}
          icon={
            workShown ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronUp size={14} aria-hidden="true" />
            )
          }
          onClick={() => onShowWork(!workShown)}
        >
          {workShown ? 'Hide Claude’s work' : 'Show Claude’s work'}
        </Button>
      )}
      {stoppable ? (
        <Button variant="quiet" size="sm" onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      )}
    </div>
  );
}
