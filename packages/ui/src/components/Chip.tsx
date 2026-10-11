import { Check } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../cx.ts';
import type { Tone } from '../tokens.ts';
import styles from './Chip.module.css';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  /** Whether it's on. */
  pressed: boolean;
  /** The tint when it's on, such as the fit tier's own color. */
  tone?: Tone;
}

/** An option that turns on and off, such as one fit level in the filters. */
export function Chip({
  pressed,
  tone = 'blue',
  className,
  children,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cx(styles.chip, pressed && styles.on, className)}
      // The tone's own tint, set here so it always wins over the chip's resting colors.
      style={
        pressed
          ? { background: `var(--fw-tone-${tone}-bg)`, color: `var(--fw-tone-${tone}-fg)` }
          : undefined
      }
      {...rest}
    >
      {pressed && <Check size={12} strokeWidth={2.6} aria-hidden="true" />}
      {children}
    </button>
  );
}
