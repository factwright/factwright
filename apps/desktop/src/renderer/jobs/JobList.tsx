import { FitBadge, StatusPill, VisuallyHidden } from '@factwright/ui';
import type { KeyboardEvent } from 'react';
import { payLabel } from './format.ts';
import styles from './JobList.module.css';
import type { JobRow } from './rows.ts';

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

/** The jobs, one row each: company and role, status, fit, pay and the next step. */
export function JobList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: readonly JobRow[];
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
                    <span className={styles.company}>{job.company}</span>
                    <span className={styles.role}>{job.role || 'Company outreach'}</span>
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
