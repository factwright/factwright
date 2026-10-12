import { type Call, type CallKind, dayFrom, type JobView, payLabel } from '@factwright/core';
import { FitBadge, StatusPill, VisuallyHidden } from '@factwright/ui';
import { Check } from 'lucide-react';
import type { KeyboardEvent } from 'react';
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

/**
 * The jobs, one row each: company and role, status, fit, pay and the next step. Jobs in
 * interviews show their calls so far, and jobs to review say which search found them.
 */
export function JobList({
  rows,
  view,
  today,
  showFound = view === 'review',
  selectedId,
  onSelect,
}: {
  rows: readonly JobRow[];
  view: JobView;
  today: string;
  /** Whether each job says which search found it. */
  showFound?: boolean;
  selectedId: string | null;
  onSelect: (jobId: string) => void;
}) {
  return (
    <div className={styles.table}>
      <div>
        <div className={styles.head} aria-hidden="true">
          <span className={styles.job}>Job</span>
          <span className={styles.status}>Status</span>
          <span className={styles.fit}>Fit</span>
          <span className={styles.pay}>Pay</span>
          <span className={styles.next}>Next step</span>
        </div>
        <ul className={styles.rows} aria-label="Jobs" onKeyDown={moveFocus}>
          {rows.map(({ job, progress, next }) => {
            const pay = payLabel(job.pay);
            const selected = job.id === selectedId;
            return (
              <li key={job.id}>
                <button
                  type="button"
                  className={`${styles.row} ${selected ? styles.selected : ''}`}
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
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
