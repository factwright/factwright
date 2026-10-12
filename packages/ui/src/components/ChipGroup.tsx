import { type ReactNode, useId } from 'react';
import { Chip } from './Chip.tsx';
import styles from './ChipGroup.module.css';

export interface ChipGroupProps<T extends string> {
  /** Names the group, such as "Levels". */
  label: string;
  hint?: ReactNode;
  options: readonly { value: T; label: string }[];
  /** The options that are on. */
  value: readonly T[];
  onChange: (value: T[]) => void;
}

/**
 * A few options, any of which can be on, such as the levels of job someone wants. Each is a
 * toggle button, so screen readers say whether it's on.
 */
export function ChipGroup<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
}: ChipGroupProps<T>) {
  const hintId = useId();
  const toggle = (option: T) =>
    onChange(
      value.includes(option)
        ? value.filter((each) => each !== option)
        : // Kept in the options' order, whatever order they're picked in.
          options
            .map((each) => each.value)
            .filter((each) => each === option || value.includes(each)),
    );
  return (
    <fieldset className={styles.group} aria-describedby={hint ? hintId : undefined}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.chips}>
        {options.map((option) => (
          <Chip
            key={option.value}
            pressed={value.includes(option.value)}
            onClick={() => toggle(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </fieldset>
  );
}
