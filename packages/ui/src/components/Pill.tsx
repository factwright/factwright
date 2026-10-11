import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import type { Tone } from '../tokens.ts';
import styles from './Pill.module.css';

export interface PillProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

/** A short label on a tinted background, such as a job's status. */
export function Pill({ tone = 'gray', children, className }: PillProps) {
  return <span className={cx(styles.pill, styles[tone], className)}>{children}</span>;
}
