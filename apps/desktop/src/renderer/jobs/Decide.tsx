import {
  addDays,
  type Job,
  type JobStatus,
  PASS_REASON_LABELS,
  PASS_REASONS,
  type PassReason,
  type StatusChange,
} from '@factwright/core';
import { Button, Chip, JOB_STATUS_DISPLAY } from '@factwright/ui';
import { useId } from 'react';
import { DateEdit } from './DateEdit.tsx';
import styles from './Decide.module.css';

/** The quick ways to sort a job not decided on yet: a closer look, apply, not now, or no. */
export const SORT_MOVES: readonly { status: JobStatus; label: string }[] = [
  { status: 'review', label: 'To review' },
  { status: 'apply', label: 'To apply' },
  { status: 'later', label: 'Later' },
  { status: 'passed', label: 'Pass' },
];

/** How far off a job set aside can come back, in a click. */
const BACK_IN: readonly { days: number; label: string }[] = [
  { days: 7, label: 'In a week' },
  { days: 14, label: 'In 2 weeks' },
  { days: 30, label: 'In a month' },
];

/**
 * Marks the control the keyboard's focus goes to once a quick choice has taken away the button
 * that made it, such as the first reason to give after passing.
 */
export const FOCUS_NEXT = { 'data-focus-next': true } as const;

/**
 * Puts the keyboard's focus on the control marked to take it, inside an element: the marked one
 * itself, or the first control in it, when that can take focus. False when there's none.
 */
export function focusNext(within: HTMLElement | null): boolean {
  const controls = 'button:not(:disabled), input:not(:disabled), select:not(:disabled)';
  for (const marked of within?.querySelectorAll<HTMLElement>('[data-focus-next]') ?? []) {
    const next = marked.matches(controls) ? marked : marked.querySelector<HTMLElement>(controls);
    if (next) {
      next.focus();
      return true;
    }
  }
  return false;
}

/** The days a job set aside can come back on, as a click each, from today. */
export function BackInChoices({
  today,
  onPick,
}: {
  today: string;
  onPick: (backOn: string) => void;
}) {
  return (
    <>
      {BACK_IN.map(({ days, label }, i) => (
        <Button
          key={days}
          size="sm"
          className={styles.backIn}
          onClick={() => onPick(addDays(today, days))}
          {...(i === 0 && FOCUS_NEXT)}
        >
          {label}
        </Button>
      ))}
    </>
  );
}

/** Why the user passed, as one click: picking the chosen one again clears it. */
export function ReasonChips({
  reason,
  onPick,
}: {
  reason: PassReason | null;
  onPick: (reason: PassReason | null) => void;
}) {
  return (
    <>
      {PASS_REASONS.map((each, i) => (
        <Chip
          key={each}
          pressed={reason === each}
          tone="slate"
          onClick={() => onPick(reason === each ? null : each)}
          {...(i === 0 && FOCUS_NEXT)}
        >
          {PASS_REASON_LABELS[each]}
        </Chip>
      ))}
    </>
  );
}

/** Undoes the change that set the job's status, when it's the latest. */
function UndoButton({ change, onUndo }: { change: StatusChange; onUndo: (id: string) => void }) {
  return (
    <Button
      variant="quiet"
      size="sm"
      className={styles.undo}
      aria-label={`Undo “Marked ${JOB_STATUS_DISPLAY[change.status].label}”`}
      onClick={() => onUndo(change.id)}
    >
      Undo
    </Button>
  );
}

/** The latest change of status, when it's the one that set where the job is. */
export function undoable(job: Job): StatusChange | null {
  const latest = job.statusLog.at(-1);
  return latest && latest.status === job.status ? latest : null;
}

/** A job set aside for later: the day it comes back to To review, which can change or go. */
export function SetAsideBox({
  job,
  today,
  onBackOn,
  onUndo,
}: {
  job: Job;
  today: string;
  onBackOn: (backOn: string | null) => void;
  onUndo: (changeId: string) => void;
}) {
  const titleId = useId();
  const change = undoable(job);
  return (
    <section className={styles.box} aria-labelledby={titleId}>
      <div className={styles.boxHead}>
        <h3 id={titleId} className={styles.title}>
          Set aside for later
        </h3>
        {change && <UndoButton change={change} onUndo={onUndo} />}
      </div>
      {job.backOn ? (
        <div className={styles.backOn}>
          <p className={styles.line}>
            Back in To review on{' '}
            <span {...FOCUS_NEXT}>
              <DateEdit
                date={job.backOn}
                label="When it comes back"
                today={today}
                onChange={(date) => onBackOn(date)}
              />
            </span>
          </p>
          <Button variant="quiet" size="sm" className={styles.noDay} onClick={() => onBackOn(null)}>
            No day
          </Button>
        </div>
      ) : (
        <>
          <p className={styles.line}>It waits under Later until you move it, or a day you pick.</p>
          <div className={styles.chips}>
            <BackInChoices today={today} onPick={onBackOn} />
            <DateEdit
              date={null}
              label="When it comes back"
              today={today}
              placeholder="Pick a day"
              onChange={(date) => onBackOn(date)}
            />
          </div>
        </>
      )}
    </section>
  );
}

/** A job passed on: why, as one click, for the job searches to read. */
export function PassedBox({
  job,
  onReason,
  onUndo,
}: {
  job: Job;
  onReason: (reason: PassReason | null) => void;
  onUndo: (changeId: string) => void;
}) {
  const titleId = useId();
  const hintId = useId();
  const change = undoable(job);
  return (
    <section className={styles.box} aria-labelledby={titleId} aria-describedby={hintId}>
      <div className={styles.boxHead}>
        <h3 id={titleId} className={styles.title}>
          Why did you pass?
        </h3>
        {change && <UndoButton change={change} onUndo={onUndo} />}
      </div>
      <div className={styles.chips}>
        <ReasonChips reason={job.passReason} onPick={onReason} />
      </div>
      <p id={hintId} className={styles.hint}>
        Optional. Your Claude reads it in job searches, and may suggest a deal-breaker.
      </p>
    </section>
  );
}
