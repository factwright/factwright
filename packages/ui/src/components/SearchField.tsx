import { Search } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';
import { cx } from '../cx.ts';
import styles from './SearchField.module.css';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** What the field searches. It's read aloud, and shown until the user types. */
  label: string;
  /** A keyboard shortcut that jumps to the field, shown at its end, such as "⌘K". */
  shortcut?: string;
}

/** A search box with an icon and an optional shortcut hint. */
export function SearchField({
  label,
  shortcut,
  placeholder,
  className,
  ...rest
}: SearchFieldProps) {
  return (
    <div className={cx(styles.field, className)}>
      <Search className={styles.icon} size={16} aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        className={cx(styles.input, shortcut && styles.withShortcut)}
        {...rest}
      />
      {shortcut && (
        <span className={styles.shortcut} aria-hidden="true">
          {shortcut}
        </span>
      )}
    </div>
  );
}
