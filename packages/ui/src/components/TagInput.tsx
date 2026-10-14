import { X } from 'lucide-react';
import { type ClipboardEvent, type KeyboardEvent, useState } from 'react';
import { cx } from '../cx.ts';
import type { FieldControl } from './Form.tsx';
import styles from './TagInput.module.css';

export interface TagInputProps extends FieldControl {
  /** The entries so far. */
  value: readonly string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** The most entries it takes. */
  max?: number;
  /** The longest an entry can be, in characters. */
  maxLength?: number;
  /** Takes the focus when it appears, as when it's the next thing to fill in. */
  autoFocus?: boolean;
  className?: string;
}

/** Entries from text, split on commas and new lines, without blanks. */
const entriesIn = (text: string, maxLength: number) =>
  text
    .split(/[,\n]/)
    .map((each) => each.trim().slice(0, maxLength))
    .filter(Boolean);

/**
 * A short list typed one entry at a time, such as job titles or cities. Enter or a comma adds
 * what's typed, a pasted list adds each entry, and Backspace in the empty box takes the last one
 * back. It goes inside a Field, which labels its box.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  max = 30,
  maxLength = 120,
  autoFocus,
  className,
  ...control
}: TagInputProps) {
  const [draft, setDraft] = useState('');

  const add = (text: string) => {
    const next = [...value];
    for (const entry of entriesIn(text, maxLength)) {
      const known = next.some((each) => each.toLowerCase() === entry.toLowerCase());
      if (!known && next.length < max) next.push(entry);
    }
    setDraft('');
    if (next.length !== value.length) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'Enter' || event.key === ',') && draft.trim()) {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/[,\n]/.test(text)) return;
    event.preventDefault();
    add(`${draft},${text}`);
  };

  return (
    <div className={cx(styles.box, className)}>
      {value.length > 0 && (
        <ul className={styles.tags}>
          {value.map((entry) => (
            <li key={entry} className={styles.tag}>
              {entry}
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${entry}`}
                onClick={() => onChange(value.filter((each) => each !== entry))}
              >
                <X size={12} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        {...control}
        // biome-ignore lint/a11y/noAutofocus: only when asked, as for the next thing to fill in.
        autoFocus={autoFocus}
        className={styles.input}
        value={draft}
        placeholder={value.length >= max ? undefined : placeholder}
        disabled={value.length >= max}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        // What's typed counts even when the user moves on without pressing Enter.
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}
