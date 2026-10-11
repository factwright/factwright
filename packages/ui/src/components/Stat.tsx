import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import styles from './Stat.module.css';

export interface StatProps {
  label: string;
  value: ReactNode;
  /** A short line under the value, such as "2 this week". */
  detail?: string;
  /** "need" colors the value, for numbers that ask something of the user. */
  tone?: 'default' | 'need';
}

/** A number worth seeing at a glance, such as how many applications heard back. */
export function Stat({ label, value, detail, tone = 'default' }: StatProps) {
  return (
    <div className={styles.stat}>
      <p className={styles.label}>{label}</p>
      <p className={cx(styles.value, tone === 'need' && styles.need)}>{value}</p>
      {detail && <p className={styles.detail}>{detail}</p>}
    </div>
  );
}
