import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../cx.ts';
import styles from './Button.module.css';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** Primary is for the one main action in a view. Quiet is for small, secondary actions. */
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'md' | 'sm';
  /** An icon before the label. */
  icon?: ReactNode;
}

/** A button whose label says what it does. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], styles[size], className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
