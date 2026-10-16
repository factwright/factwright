import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../cx.ts';
import styles from './Button.module.css';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** What the button does. It's read aloud and shown as a tooltip. */
  label: string;
  icon: ReactNode;
  variant?: 'secondary' | 'quiet';
  size?: 'md' | 'sm';
}

/** A square button that shows only an icon. */
export function IconButton({
  label,
  icon,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(styles.button, styles[variant], styles[size], styles.square, className)}
      {...rest}
    >
      {icon}
    </button>
  );
}
