import {
  AUTO_STATUSES,
  type Call,
  type CallKind,
  dayFrom,
  type JobView,
  payLabel,
  shortDate,
} from '@factwright/core';
import { FitBadge, StatusPill, VisuallyHidden } from '@factwright/ui';
import { ArrowDown, ArrowUp, Check, ChevronRight } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react';
import styles from './JobList.module.css';
import type { JobRow, ListSort, SortKey } from './rows.ts';

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

/** Each column's heading, and how it sorts the list: its own way round, then the other. */
const COLUMNS: readonly { by: SortKey; label: string; ways: readonly [string, string] }[] = [
  { by: 'job', label: 'Job', ways: ['A to Z', 'Z to A'] },
  { by: 'status', label: 'Status', ways: ['earliest step first', 'furthest along first'] },
  { by: 'fit', label: 'Fit', ways: ['best fit first', 'lowest fit first'] },
  { by: 'pay', label: 'Pay', ways: ['highest pay first', 'lowest pay first'] },
  { by: 'next', label: 'Next step', ways: ['most pressing first', 'least pressing first'] },
  { by: 'added', label: 'Added', ways: ['newest first', 'oldest first'] },
];

/** Which ways the list can scroll sideways from where it is, for the fades along its edges. */
interface Sideways {
  /** Columns are scrolled out of sight to the left, under the jobs' names. */
  back: boolean;
  /** More columns are out of sight to the right. */
  more: boolean;
}

/**
 * Follows how far the list is scrolled sideways, and whether it can scroll at all, as its width
 * and rows change.
 */
function useSideways() {
  const scroller = useRef<HTMLDivElement>(null);
  const [sideways, setSideways] = useState<Sideways>({ back: false, more: false });
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measure = () => {
      const back = box.scrollLeft > 0;
      // A pixel's leeway, as the browser rounds where it scrolled to.
      const more = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
      setSideways((was) => (was.back === back && was.more === more ? was : { back, more }));
    };
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resized?.observe(box);
    if (box.firstElementChild) resized?.observe(box.firstElementChild);
    return () => {
      box.removeEventListener('scroll', measure);
      resized?.disconnect();
    };
  }, []);
  return { scroller, sideways };
}

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
 * Whether a search found a job again after the user decided on it, such as passing on it: worth
 * saying in every view, not just where the list says which search found each job.
 */
const againAfter = ({ job, progress }: JobRow) =>
  Boolean(
    job.search?.again &&
      job.search.date &&
      job.statusOn &&
      job.statusOn <= job.search.date &&
      !AUTO_STATUSES.includes(progress.status),
  );

/**
 * The jobs, one row each: company and role, status, fit, pay, the next step, and the day each was
 * found or saved. Jobs in interviews show their calls so far, and jobs to review say which search
 * found them last, and when it found them again. Each row can be picked, to move several at once,
 * and To review ends with the jobs set aside. Every column keeps its heading: when the list is too
 * narrow for them all, it scrolls sideways, with the jobs' names pinned, and a fade at the edge
 * says there's more.
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
  sort = null,
  onSort,
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
  /** How the list is sorted, by a column, or null for the newest activity first. */
  sort?: ListSort | null;
  /** Sorts by a column, once its heading is clicked. */
  onSort?: (by: SortKey) => void;
}) {
  const pickedHere = picks ? rows.filter((row) => picks.picked.has(row.job.id)).length : 0;
  const allPicked = rows.length > 0 && pickedHere === rows.length;
  const { scroller, sideways } = useSideways();
  const item = (row: JobRow) => {
    const { job, progress, next } = row;
    const pay = payLabel(job.pay);
    // The newest search that found it.
    const found = job.search?.source ?? job.searches.at(-1)?.source;
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
            <span className={`${styles.companyLine} ${showKind ? styles.withKind : ''}`}>
              <span className={styles.company}>{job.company}</span>
              {showKind && row.kind && (
                <span className={styles.kind}>
                  <VisuallyHidden>, </VisuallyHidden>
                  {row.kind.name}
                </span>
              )}
              {found && (showFound || againAfter(row)) && (
                <span className={styles.found}>
                  {job.search?.again ? `Found again · ${found}` : found}
                </span>
              )}
            </span>
            <span className={styles.role}>{job.role || 'Company outreach'}</span>
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
          <span className={styles.added}>
            {job.firstSeen ? (
              <>
                <VisuallyHidden>Added </VisuallyHidden>
                {shortDate(job.firstSeen, today)}
              </>
            ) : (
              <span aria-hidden="true">—</span>
            )}
          </span>
        </button>
      </li>
    );
  };
  return (
    <div
      className={`${styles.table} ${picks ? styles.pickable : ''}`}
      data-scrolled={sideways.back || undefined}
      data-more={sideways.more || undefined}
    >
      <div ref={scroller} className={styles.scroller}>
        <div className={styles.content}>
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
              <div className={styles.head}>
                {COLUMNS.map(({ by, label, ways }) => {
                  const sorted = sort?.by === by ? sort : null;
                  return (
                    <span key={by} className={styles[by]}>
                      {onSort ? (
                        <button
                          type="button"
                          className={`${styles.sort} ${sorted ? styles.sorted : ''}`}
                          aria-label={
                            sorted
                              ? `${label}, sorted ${ways[sorted.reversed ? 1 : 0]}`
                              : `Sort by ${label.toLowerCase()}`
                          }
                          onClick={() => onSort(by)}
                        >
                          {label}
                          {sorted &&
                            (sorted.reversed ? (
                              <ArrowUp size={13} aria-hidden="true" />
                            ) : (
                              <ArrowDown size={13} aria-hidden="true" />
                            ))}
                        </button>
                      ) : (
                        <span aria-hidden="true">{label}</span>
                      )}
                    </span>
                  );
                })}
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
    </div>
  );
}
