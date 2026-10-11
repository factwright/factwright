import type { ReactNode } from 'react';
import styles from './ScoreBar.module.css';

export interface ScoreBarProps {
  /** What the points are for, such as "Work". */
  label: string;
  points: number;
  max: number;
  /** The reason for the points, under the bar. */
  children?: ReactNode;
}

/** Points out of a total, with a bar that fills to match, such as "33 of 40". */
export function ScoreBar({ label, points, max, children }: ScoreBarProps) {
  const share = max > 0 ? Math.max(0, Math.min(1, points / max)) : 0;
  return (
    <div className={styles.score}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.points}>
          {points} of {max}
        </span>
      </div>
      <div className={styles.track} aria-hidden="true">
        <div className={styles.fill} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      {children && <div className={styles.why}>{children}</div>}
    </div>
  );
}
