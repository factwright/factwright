import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import styles from './Notice.module.css';

export interface NoticeProps {
  title: string;
  children: ReactNode;
  /** "need" for something the user must act on, "info" for something good to know. */
  tone?: 'need' | 'info';
}

/** A short note that stands out, such as how to apply for a job. */
export function Notice({ title, children, tone = 'need' }: NoticeProps) {
  return (
    <div role="note" className={cx(styles.notice, styles[tone])}>
      <p className={styles.title}>{title}</p>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
