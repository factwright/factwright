import { JOB_VIEW_LABELS, JOB_VIEWS, type JobView, type KindName } from '@factwright/core';
import { Checkbox, Select } from '@factwright/ui';
import type { KeyboardEvent } from 'react';
import { FiltersPanel } from './FiltersPanel.tsx';
import styles from './JobRail.module.css';
import { FoundBy, KindOf } from './JobsPage.tsx';
import {
  type JobRow,
  type ListFilter,
  type ListSort,
  laterRows,
  ofKind,
  viewCounts,
  visibleRows,
} from './rows.ts';

const NEXT_TONE = { urgent: styles.urgent, action: styles.action, info: undefined } as const;

/** Moves between jobs with the arrow keys, and to the first or last with Home and End. */
function moveFocus(event: KeyboardEvent<HTMLUListElement>) {
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[event.key];
  if (to === undefined || at < 0) return;
  event.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
}

/**
 * The jobs, slim, beside a job that has the window to itself, so another is a click away: the
 * view, its jobs as the list sorts them, each with its next step, and every other choice behind
 * Filters. To review ends with the jobs set aside.
 */
export function JobRail({
  rows,
  kinds,
  today,
  filter,
  onFilter,
  sort,
  selectedId,
  onSelect,
}: {
  rows: readonly JobRow[];
  kinds: readonly KindName[];
  today: string;
  filter: ListFilter;
  onFilter: (filter: ListFilter) => void;
  sort: ListSort | null;
  selectedId: string | null;
  onSelect: (jobId: string) => void;
}) {
  const counts = viewCounts(rows, filter);
  const shown = visibleRows(rows, filter, sort);
  const later = laterRows(rows, filter);
  const extraCount = [filter.needsYou, filter.found].filter(Boolean).length;
  const list = (listed: readonly JobRow[], label: string) => (
    <ul className={styles.rows} aria-label={label} onKeyDown={moveFocus}>
      {listed.map(({ job, next }) => {
        const selected = job.id === selectedId;
        return (
          <li key={job.id}>
            <button
              type="button"
              className={`${styles.row} ${selected ? styles.selected : ''}`}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(job.id)}
            >
              <span className={styles.company}>{job.company}</span>
              <span className={styles.role}>{job.role || 'Company outreach'}</span>
              {next && (
                <span className={`${styles.next} ${NEXT_TONE[next.level] ?? ''}`}>{next.text}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
  return (
    <nav className={styles.rail} aria-label="Job list">
      <div className={styles.head}>
        <Select
          className={styles.view}
          aria-label="View"
          value={filter.view}
          onChange={(event) => onFilter({ ...filter, view: event.target.value as JobView })}
        >
          {JOB_VIEWS.map((view) => (
            <option key={view} value={view}>
              {JOB_VIEW_LABELS[view]} ({counts[view]})
            </option>
          ))}
        </Select>
        <FiltersPanel
          filter={filter}
          onFilter={onFilter}
          opens="right"
          extraCount={extraCount}
          extra={
            <>
              <Checkbox
                label="Needs you"
                checked={filter.needsYou}
                onChange={(event) => onFilter({ ...filter, needsYou: event.target.checked })}
              />
              <KindOf rows={rows} kinds={kinds} filter={filter} onFilter={onFilter} />
              <FoundBy
                rows={ofKind(rows, filter.kind)}
                all={rows}
                today={today}
                filter={filter}
                onFilter={onFilter}
              />
            </>
          }
        />
      </div>
      <div className={styles.scroll}>
        {shown.length > 0 && list(shown, 'Jobs')}
        {later.length > 0 && (
          <>
            <p className={styles.group}>Set aside for later</p>
            {list(later, 'Set aside for later')}
          </>
        )}
        {shown.length + later.length === 0 && (
          <p className={styles.empty}>Nothing here right now.</p>
        )}
      </div>
    </nav>
  );
}
