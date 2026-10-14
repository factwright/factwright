import { type Call, type CallKind, dayFrom, type JobView, payLabel } from '@factwright/core';
import { FitBadge, StatusPill, VisuallyHidden } from '@factwright/ui';
import { Check, ChevronRight } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import styles from './JobList.module.css';
import type { JobRow } from './rows.ts';

/** Each kind of call in a word or two, for a row's line of steps. */
const STEP_NAMES: Readonly<Record<CallKind, string>> = {
  screen: 'Screen',
  manager: 'Hiring manager',
  technical: 'Technical',
  takehome: 'Take-home',
  panel: 'Panel',
  final: 'Final round',
  offer: 'Offer call',
  other: 'Call',
};

/** The calls and interviews so far, in order: the ones done, then what's booked and when. */
function CallSteps({ calls, today }: { calls: readonly Call[]; today: string }) {
  const steps = calls.filter((call) => call.state !== 'canceled');
  if (steps.length === 0) return null;
  return (
    <span className={styles.steps}>
      {steps.map((call) => (
        <span
          key={call.id}
          className={`${styles.step} ${call.state === 'done' ? styles.stepDone : ''}`}
        >
          {call.state === 'done' && <Check size={11} strokeWidth={3} aria-hidden="true" />}
          {STEP_NAMES[call.kind]}
          {call.state === 'done' ? (
            <VisuallyHidden> (done)</VisuallyHidden>
          ) : (
            ` ${dayFrom(call.onDate, today)}`
          )}
        </span>
      ))}
    </span>
  );
}

const NEXT_TONE = { urgent: styles.urgent, action: styles.action, info: undefined } as const;

/** Moves between rows with the arrow keys, and to the first or last with Home and End. */
function moveFocus(event: KeyboardEvent<HTMLUListElement>) {
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[event.key];
  if (to === undefined || at < 0) return;
  event.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
}

/** Selecting jobs to move several at once: which are picked, and how that changes. */
export interface ListPicks {
  picked: ReadonlySet<string>;
  /** Picks a job or leaves it out. With Shift, every job from the last one picked does too. */
  onPick: (jobId: string, on: boolean, range: boolean) => void;
  /** Picks every job in the list, or none. */
  onPickAll: (on: boolean) => void;
  /** Names the list for the box that selects them all, such as "To review". */
  label: string;
}

/** The jobs set aside for later, folded at the bottom of the list until opened. */
export interface LaterGroup {
  rows: readonly JobRow[];
  open: boolean;
  onToggle: () => void;
}

const name = (row: JobRow) => `${row.job.company}, ${row.job.role || 'Company outreach'}`;

/**
 * The jobs, one row each: company and role, status, fit, pay and the next step. Jobs in
 * interviews show their calls so far, and jobs to review say which search found them. Each row
 * can be picked, to move several at once, and To review ends with the jobs set aside.
 */
export function JobList({
  rows,
  view,
  today,
  showFound = view === 'new',
  showKind = false,
  selectedId,
  onSelect,
  picks,
  later,
}: {
  rows: readonly JobRow[];
  view: JobView;
  today: string;
  /** Whether each job says which search found it. */
  showFound?: boolean;
  /** Whether each job says which kind of job it's under. */
  showKind?: boolean;
  selectedId: string | null;
  onSelect: (jobId: string) => void;
  picks?: ListPicks;
  later?: LaterGroup;
}) {
  const pickedHere = picks ? rows.filter((row) => picks.picked.has(row.job.id)).length : 0;
  const allPicked = rows.length > 0 && pickedHere === rows.length;
  const item = (row: JobRow) => {
    const { job, progress, next } = row;
    const pay = payLabel(job.pay);
    const selected = job.id === selectedId;
    const picked = picks?.picked.has(job.id) ?? false;
    return (
      <li
        key={job.id}
        className={`${styles.item} ${selected ? styles.selected : ''} ${picked ? styles.picked : ''}`}
      >
        {picks && (
          <span className={styles.pick}>
            <input
              type="checkbox"
              aria-label={`Select ${name(row)}`}
              checked={picked}
              // A click says whether Shift was held, to pick a run of jobs. The box follows it.
              readOnly
              onClick={(event: MouseEvent<HTMLInputElement>) =>
                picks.onPick(job.id, event.currentTarget.checked, event.shiftKey)
              }
            />
          </span>
        )}
        <button
          type="button"
          className={styles.row}
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelect(job.id)}
        >
          <span className={styles.job}>
            <span className={styles.companyLine}>
              <span className={styles.company}>{job.company}</span>
              {showFound && job.searches[0] && (
                <span className={styles.found}>{job.searches[0].source}</span>
              )}
            </span>
            <span className={styles.roleLine}>
              <span className={styles.role}>{job.role || 'Company outreach'}</span>
              {showKind && row.kind && (
                <span className={styles.kind}>
                  <VisuallyHidden>, </VisuallyHidden>
                  {row.kind.name}
                </span>
              )}
            </span>
            {view === 'interviewing' && <CallSteps calls={job.calls} today={today} />}
          </span>
          <span className={styles.status}>
            <StatusPill status={progress.status} />
          </span>
          <span className={styles.fit}>
            <FitBadge score={progress.score} tier={progress.tier} />
          </span>
          <span className={styles.pay}>
            {pay ?? (
              <>
                <span aria-hidden="true">—</span>
                <VisuallyHidden>No pay listed</VisuallyHidden>
              </>
            )}
          </span>
          <span className={`${styles.next} ${next ? (NEXT_TONE[next.level] ?? '') : ''}`}>
            {next?.text}
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className={`${styles.table} ${picks ? styles.pickable : ''}`}>
      <div>
        {rows.length > 0 && (
          <div className={styles.headRow}>
            {picks && (
              <span className={styles.pick}>
                <input
                  type="checkbox"
                  data-select-all
                  aria-label={`Select every job in ${picks.label}`}
                  checked={allPicked}
                  ref={(box) => {
                    if (box) box.indeterminate = pickedHere > 0 && !allPicked;
                  }}
                  onChange={() => picks.onPickAll(!allPicked)}
                />
              </span>
            )}
            <div className={styles.head} aria-hidden="true">
              <span className={styles.job}>Job</span>
              <span className={styles.status}>Status</span>
              <span className={styles.fit}>Fit</span>
              <span className={styles.pay}>Pay</span>
              <span className={styles.next}>Next step</span>
            </div>
          </div>
        )}
        {rows.length > 0 && (
          <ul className={styles.rows} aria-label="Jobs" onKeyDown={moveFocus}>
            {rows.map(item)}
          </ul>
        )}
        {later && later.rows.length > 0 && (
          <div className={`${styles.later} ${rows.length > 0 ? '' : styles.laterOnly}`}>
            <button
              type="button"
              className={styles.laterToggle}
              aria-expanded={later.open}
              onClick={later.onToggle}
            >
              <ChevronRight className={styles.chevron} size={15} aria-hidden="true" />
              {/* The spaces keep them apart when read aloud; flex layout doesn't show them. */}
              <span className={styles.laterName}>Later</span>{' '}
              <span className={styles.laterCount}>{later.rows.length}</span>{' '}
              <span className={styles.laterHint}>Set aside. Each comes back on its day.</span>
            </button>
            {later.open && (
              <ul className={styles.rows} aria-label="Set aside for later" onKeyDown={moveFocus}>
                {later.rows.map(item)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
