import { Button, type RunState, RunStatus, VisuallyHidden } from '@factwright/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './ClaudePanel.module.css';
import type { RunPhase } from './useClaudeRun.ts';

/** The run's state as the status chip shows it. A run that couldn't start counts as failed. */
export function chipState(phase: RunPhase, problem: string | undefined): RunState {
  if (phase === 'idle') return problem ? 'failed' : 'stopped';
  return phase;
}

/** Whether Claude Code is still open, and so can be stopped. */
export function isRunning(phase: RunPhase): boolean {
  return (
    phase === 'starting' ||
    phase === 'ready' ||
    phase === 'working' ||
    phase === 'needs-answer' ||
    phase === 'done'
  );
}

/**
 * The bar along the bottom of the window while Claude has a task: where the run stands, what
 * Claude is doing or what it made, how long it's been, whose Claude it is, and what you can do,
 * such as open what it made, or see Claude's work, the terminal under the bar.
 */
export function PanelHeader({
  title = 'Claude',
  phase,
  plan,
  problem,
  text,
  elapsed = null,
  action = null,
  workShown,
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
  /** Whether Claude's work, the terminal, shows under the bar. */
  workShown: boolean;
  onShowWork: (shown: boolean) => void;
  onStop: () => void;
  onClose: () => void;
  /** The task is done, with something to show for it. */
  finished?: boolean;
  /** Claude's turn ended in an error, such as a rate limit, though Claude Code is still open. */
  failed?: boolean;
}) {
  const running = isRunning(phase);
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
      {running ? (
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
