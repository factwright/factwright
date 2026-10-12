import { isIsoDate, shortDate } from '@factwright/core';
import { Input } from '@factwright/ui';
import { useState } from 'react';
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
  /** What the date is, such as "When it was marked Applied". */
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

  if (!editing) {
    return (
      <button
        type="button"
        className={`${styles.date} ${date ? '' : styles.missing}`}
        aria-label={`${label}: ${date ? longDate(date) : 'not known'}. Change it`}
        onClick={() => {
          setDraft(date ?? '');
          setEditing(true);
        }}
      >
        {date ? shortDate(date, today) : placeholder}
      </button>
    );
  }
  const save = () => {
    setEditing(false);
    // A year typed in full: "0020" on the way to "2026" isn't a date anyone means.
    if (isIsoDate(draft) && draft >= '2000-01-01' && draft !== date && (!max || draft <= max)) {
      onChange(draft);
    }
  };
  return (
    <Input
      className={styles.input}
      type="date"
      aria-label={label}
      autoFocus
      value={draft}
      max={max}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') save();
        if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(false);
        }
      }}
    />
  );
}
