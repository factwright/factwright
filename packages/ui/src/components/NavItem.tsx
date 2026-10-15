import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx.ts';
import styles from './NavItem.module.css';
import { VisuallyHidden } from './VisuallyHidden.tsx';

export interface NavItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  /** A count shown at the end, such as how many jobs there are. */
  count?: number;
  /**
   * Something waiting for the user, shown in place of the count while there is some: how many,
   * and what they are, which only screen readers read, such as "to verify".
   */
  waiting?: { count: number; label: string };
  /** Whether this is the page the user is on. */
  current?: boolean;
}

/** A place in the app's sidebar. */
export function NavItem({
  icon,
  label,
  count,
  waiting,
  current = false,
  type = 'button',
  className,
  ...rest
}: NavItemProps) {
  return (
    <button
      type={type}
      aria-current={current ? 'page' : undefined}
      className={cx(styles.item, current && styles.current, className)}
      {...rest}
    >
      {icon}
      <span className={styles.label}>{label}</span>
      {/* The space keeps "Jobs 18" from reading aloud as "Jobs18"; flex layout doesn't show it. */}{' '}
      {waiting && waiting.count > 0 ? (
        <span className={styles.waiting}>
          <span aria-hidden="true">{waiting.count}</span>
          <VisuallyHidden>{`${waiting.count} ${waiting.label}`}</VisuallyHidden>
        </span>
      ) : (
        count !== undefined && <span className={styles.count}>{count}</span>
      )}
    </button>
  );
}
