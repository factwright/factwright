import { Button } from '@factwright/ui';
import { LoaderCircle, Plus, Sparkles } from 'lucide-react';
import type { RunTask } from '../../shared/runs.ts';
import styles from './ClaudeButton.module.css';
import { FOCUS_NEXT } from './Decide.tsx';
import { type RunControls, runState } from './RunActions.tsx';

/**
 * A button that starts Claude on a task, such as Tailor a resume, or that says Claude is on it
 * while it runs. It waits while Claude does another task, or until Claude Code is ready. Some
 * tasks ask the user something first, such as the application's questions, so they pass their
 * own way to start.
 */
export function ClaudeButton({
  run,
  task,
  label,
  adds = false,
  primary = false,
  onStart,
}: {
  run: RunControls | undefined;
  task: RunTask;
  label: string;
  /** Makes something new for the job, such as its first resume, which a plus says. */
  adds?: boolean;
  /** The one main thing to do, such as the step up next. */
  primary?: boolean;
  /** Starts it another way, such as by asking for the application's questions first. */
  onStart?: () => void;
}) {
  const { running, disabled } = runState(run, task);
  if (running) {
    return (
      <span className={styles.running}>
        <LoaderCircle className={styles.spin} size={14} aria-hidden="true" />
        Claude is on it
      </span>
    );
  }
  const Icon = adds ? Plus : Sparkles;
  return (
    <Button
      size="sm"
      variant={primary ? 'primary' : 'secondary'}
      icon={<Icon size={14} aria-hidden="true" />}
      disabled={disabled}
      onClick={onStart ?? (() => run?.start(task))}
      {...(primary && FOCUS_NEXT)}
    >
      {label}
    </Button>
  );
}

/** Whether Claude is running this task now, such as writing the letter that shows. */
export const isRunning = (run: RunControls | undefined, task: RunTask) =>
  runState(run, task).running;
