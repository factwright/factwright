import { cx } from '../cx.ts';
import styles from './RunStatus.module.css';

/** Where a Claude run can stand, as the app's panel shows it. */
export const RUN_STATES = ['working', 'needs-answer', 'done', 'stopped', 'failed'] as const;

export type RunState = (typeof RUN_STATES)[number];

const LABELS: Readonly<Record<RunState, string>> = {
  working: 'Working',
  'needs-answer': 'Needs your answer',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Didn’t finish',
};

/** A Claude run's state as a tinted label. Its dot pulses while Claude works. */
export function RunStatus({ state }: { state: RunState }) {
  return (
    <span className={cx(styles.status, styles[state])}>
      <span className={styles.dot} aria-hidden="true" />
      {LABELS[state]}
    </span>
  );
}
