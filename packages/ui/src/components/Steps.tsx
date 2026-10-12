import { Check } from 'lucide-react';
import a11y from '../a11y.module.css';
import { cx } from '../cx.ts';
import styles from './Steps.module.css';

export interface StepsProps {
  /** Names the steps for screen readers, such as "Getting started". */
  label: string;
  steps: readonly string[];
  /** The step showing, counted from 0. */
  current: number;
  /** The furthest step reached. Steps up to it can be revisited. */
  reached: number;
  onSelect: (step: number) => void;
}

/** Where someone is in a few steps: the ones done, the one showing, and the ones ahead. */
export function Steps({ label, steps, current, reached, onSelect }: StepsProps) {
  return (
    <nav aria-label={label} className={styles.nav}>
      <ol className={styles.steps}>
        {steps.map((step, index) => {
          const done = index < reached && index !== current;
          return (
            <li key={step} className={styles.item}>
              <button
                type="button"
                className={cx(
                  styles.step,
                  index === current && styles.current,
                  done && styles.done,
                )}
                aria-current={index === current ? 'step' : undefined}
                disabled={index > reached}
                onClick={() => onSelect(index)}
              >
                <span className={styles.mark} aria-hidden="true">
                  {done ? <Check size={12} strokeWidth={2.8} /> : index + 1}
                </span>
                <span className={styles.name}>
                  {step}
                  {done && <span className={a11y.srOnly}> (done)</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
