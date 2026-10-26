import { Button, type RunState, RunStatus, VisuallyHidden } from '@factwright/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StepKind } from '../shared/activity.ts';
import type { RunPhase } from '../shared/api.ts';
import styles from './ClaudePanel.module.css';
import { BUSY } from './jobs/RunActions.tsx';
import { WorkingScene } from './WorkingScene.tsx';

/** The picture of what Claude is on, while it works: the kind of step, and how many helpers. */
export interface Scene {
  kind: StepKind;
  lanes: number;
}

/** The run's state as the status chip shows it. A run that couldn't start counts as failed. */
export function chipState(phase: RunPhase, problem: string | undefined): RunState {
  return problem ? 'failed' : phase;
}

/**
 * The bar of the run Claude's panel shows: where it stands, what Claude is doing or what it made,
 * how long it's been, whose Claude it is, and what you can do, such as open what it made, or see
 * Claude's work, the terminal under the bar. While Claude works, the bar is a taller strip, with
 * a small picture of the step it's on beside two lines of what it's doing. Stop is for a run
 * that's starting, working or waiting on the user. Otherwise it's Close, which quits Claude Code
 * that's done, or ready with nothing to do, and closes the run's tab in one click, or takes a
 * task waiting in line out of it.
 */
export function PanelHeader({
  title = 'Claude',
  phase,
  plan,
  problem,
  text,
  scene = null,
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
  /** The picture of the step Claude is on, while it works, which makes the bar a working strip. */
  scene?: Scene | null;
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
  const strip = busy && scene && !problem ? scene : null;
  return (
    <div
      className={`${styles.header} ${strip ? styles.strip : ''} ${finished ? styles.finished : ''}`}
    >
      <span role="status">
        <RunStatus state={failed ? 'failed' : chipState(phase, problem)} />
      </span>
      <span className={styles.title}>{title}</span>
      {strip && <WorkingScene kind={strip.kind} lanes={strip.lanes} />}
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
