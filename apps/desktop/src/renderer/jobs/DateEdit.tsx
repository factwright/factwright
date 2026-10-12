import { isIsoDate, shortDate } from '@factwright/core';
import { Input } from '@factwright/ui';
import { useEffect, useRef, useState } from 'react';
import styles from './DateEdit.module.css';

const LONG_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "October 12, 2026", for reading aloud. */
export const longDate = (date: string) => LONG_DATE.format(new Date(`${date}T00:00:00Z`));

/**
 * A date that reads as text, such as "Oct 12", and becomes a date box when clicked, to fix it.
 * It saves once a whole date is in and the box is left, or Enter is pressed, so typing the year
 * digit by digit never saves a date on the way.
 */
export function DateEdit({
  date,
  label,
  today,
  onChange,
  max,
  placeholder = 'Add the date',
}: {
  date: string | null;
  /** What the date is, such as "When it moved to Screen". */
  label: string;
  today: string;
  onChange: (date: string) => void;
  /** The latest date it can be, such as today for something that already happened. */
  max?: string;
  /** What shows when there's no date yet. */
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(date ?? '');
  const [invalid, setInvalid] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  /** Whether the keyboard closed the box, so focus goes back to the date. */
  const refocus = useRef(false);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [editing]);

  if (!editing) {
    const shown = date ? shortDate(date, today) : placeholder;
    return (
      <button
        ref={button}
        type="button"
        className={`${styles.date} ${date ? '' : styles.missing}`}
        // The words on the button come first, so a voice command naming them finds it.
        aria-label={`${label}: ${shown}. Change it`}
        title={date ? longDate(date) : undefined}
        onClick={() => {
          setDraft(date ?? '');
          setInvalid(false);
          setEditing(true);
        }}
      >
        {shown}
      </button>
    );
  }
  // A year typed in full: "0020" on the way to "2026" isn't a date anyone means.
  const fits = isIsoDate(draft) && draft >= '2000-01-01' && (!max || draft <= max);
  const close = (save: boolean) => {
    setEditing(false);
    if (save && fits && draft !== date) onChange(draft);
  };
  return (
    <Input
      className={styles.input}
      type="date"
      aria-label={label}
      aria-invalid={invalid}
      autoFocus
      value={draft}
      min="2000-01-01"
      max={max}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={() => close(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          // A date that can't be, such as one still to come, stays open to fix.
          if (!fits) {
            setInvalid(true);
            return;
          }
          refocus.current = true;
          close(true);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          refocus.current = true;
          close(false);
        }
      }}
    />
  );
}
