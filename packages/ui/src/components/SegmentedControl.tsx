import { useId } from 'react';
import a11y from '../a11y.module.css';
import { cx } from '../cx.ts';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** A count shown after the label, such as how many jobs a view holds. */
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  /** Names the group for screen readers, such as "Views". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Picks one of a few options, such as which jobs to show. It's a group of real radio buttons,
 * so the arrow keys move between options.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className={styles.group}>
      <legend className={a11y.srOnly}>{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(styles.option, option.value === value && styles.selected)}
        >
          <input
            type="radio"
            className={styles.input}
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
          {/* The space keeps "Active 7" from reading aloud as "Active7"; flex layout doesn't show it. */}{' '}
          {option.count !== undefined && <span className={styles.count}>{option.count}</span>}
        </label>
      ))}
    </fieldset>
  );
}
