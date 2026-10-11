import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx.ts';
import styles from './NavItem.module.css';

export interface NavItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  /** A count shown at the end, such as how many jobs there are. */
  count?: number;
  /** Whether this is the page the user is on. */
  current?: boolean;
}

/** A place in the app's sidebar. */
export function NavItem({
  icon,
  label,
  count,
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
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
