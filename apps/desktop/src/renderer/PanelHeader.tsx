import { Button, type RunState, RunStatus } from '@factwright/ui';
import styles from './ClaudePanel.module.css';
import type { RunPhase } from './useClaudeRun.ts';

const HINTS: Readonly<Record<RunPhase, string>> = {
  idle: '',
  starting:
    'If Claude Code asks whether to trust this folder, choose Yes. Then type what you’d like.',
  working: 'Keep working. You’ll hear when Claude needs you.',
  'needs-answer': 'Claude has a question. Answer it in the panel below.',
  done: 'Claude is done. Type to keep going, or close the panel.',
  stopped: 'Claude Code has closed.',
  failed: 'Claude Code stopped before it finished.',
};

/** The run's state as the status chip shows it. A run that couldn't start counts as failed. */
export function chipState(phase: RunPhase, problem: string | undefined): RunState {
  if (phase === 'idle') return problem ? 'failed' : 'stopped';
  return phase;
}

/** Whether Claude Code is still open, and so can be stopped or tucked away. */
export function isRunning(phase: RunPhase): boolean {
  return (
    phase === 'starting' || phase === 'working' || phase === 'needs-answer' || phase === 'done'
  );
}

/** The top of Claude's panel: where the run stands, whose Claude it is, and what you can do. */
export function PanelHeader({
  title = 'Claude',
  phase,
  plan,
  problem,
  onStop,
  onHide,
  onClose,
}: {
  /** What the run is, such as "Fit check · Acme". */
  title?: string;
  phase: RunPhase;
  plan: string | undefined;
  problem: string | undefined;
  onStop: () => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const running = isRunning(phase);
  return (
    <div className={styles.header}>
      <span role="status">
        <RunStatus state={chipState(phase, problem)} />
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.hint} title={problem ?? HINTS[phase]}>
        {problem ?? HINTS[phase]}
      </span>
      <span className={styles.plan}>
        <span className={styles.planDot} aria-hidden="true" />
        {plan ? `Runs on your own Claude · ${plan}` : 'Runs on your own Claude'}
      </span>
      {running && (
        <Button variant="quiet" size="sm" onClick={onStop}>
          Stop
        </Button>
      )}
      {running ? (
        <Button size="sm" onClick={onHide}>
          Hide
        </Button>
      ) : (
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      )}
    </div>
  );
}
