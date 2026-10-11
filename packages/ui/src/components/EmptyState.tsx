import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title: string;
  /** What will show up here, and how to get it there. */
  children?: ReactNode;
  icon?: ReactNode;
  /** The next step, usually a button. */
  action?: ReactNode;
}

/** What a view shows while it has nothing in it yet, with the next step. */
export function EmptyState({ title, children, icon, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      {icon && (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      )}
      <p className={styles.title}>{title}</p>
      {children && <div className={styles.body}>{children}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
