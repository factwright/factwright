import { JOB_VIEW_LABELS, JOB_VIEWS, type JobView, jobStats, payLabel } from '@factwright/core';
import {
  Button,
  EmptyState,
  FitBadge,
  SearchField,
  SegmentedControl,
  Stat,
  StatusPill,
} from '@factwright/ui';
import { Briefcase, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import styles from './Dashboard.module.css';
import { type PhoneRow, phoneRows, startingView, viewCounts, visible } from './jobs.ts';
import { navigate } from './route.ts';
import type { Vault } from './vault.ts';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const NEXT_TONE = { urgent: styles.urgent, action: styles.action, info: undefined } as const;

function JobRow({ row }: { row: PhoneRow }) {
  const { job, progress, next } = row;
  const pay = payLabel(job.pay);
  return (
    <li>
      <a
        className={styles.row}
        href={`/jobs/${encodeURIComponent(job.id)}`}
        onClick={(event) => {
          event.preventDefault();
          navigate(`/jobs/${encodeURIComponent(job.id)}`);
        }}
      >
        <span className={styles.rowHead}>
          <span className={styles.company}>{job.company}</span>
          <StatusPill status={progress.status} />
        </span>
        {job.role && <span className={styles.role}>{job.role}</span>}
        <span className={styles.rowMeta}>
          {(progress.score !== null || progress.tier) && (
            <FitBadge score={progress.score} tier={progress.tier} />
          )}
          {pay && <span>{pay}</span>}
        </span>
        {next && (
          <span className={`${styles.next} ${NEXT_TONE[next.level] ?? ''}`}>{next.text}</span>
        )}
      </a>
    </li>
  );
}

/** The job hunt on the phone: the numbers that matter, the views, search, and each job. */
export function Dashboard({
  vault,
  today,
  refreshing,
  onRefresh,
}: {
  vault: Vault;
  today: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const rows = useMemo(() => phoneRows(vault.jobs, today), [vault, today]);
  const [view, setView] = useState<JobView>(() => startingView(rows));
  const [query, setQuery] = useState('');
  const counts = viewCounts(rows);
  const shown = visible(rows, view, query);
  const stats = jobStats(rows, today);
  const heardBack = stats.applied ? `${Math.round((stats.heardBack / stats.applied) * 100)}%` : '—';

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No jobs yet"
        icon={<Briefcase size={20} aria-hidden="true" />}
        action={
          <Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={onRefresh}>
            Check again
          </Button>
        }
      >
        Jobs show up here once Factwright on your computer has synced them.
      </EmptyState>
    );
  }

  return (
    <>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Jobs</h1>
        <Button
          size="sm"
          variant="quiet"
          icon={<RefreshCw size={14} aria-hidden="true" />}
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? 'Updating…' : 'Update'}
        </Button>
      </div>
      <div className={styles.stats}>
        <Stat
          label="Needs you"
          value={stats.needsYou}
          tone={stats.needsYou ? 'need' : 'default'}
          detail={
            stats.urgent
              ? `${stats.urgent} overdue`
              : stats.needsYou
                ? 'Nothing overdue'
                : 'All caught up'
          }
        />
        <Stat
          label="In play"
          value={stats.inPlay}
          detail={`${stats.interviewing} interviewing · ${plural(stats.callsAhead, 'call')} ahead`}
        />
        <Stat
          label="Applied"
          value={stats.applied}
          detail={stats.appliedThisWeek ? `${stats.appliedThisWeek} this week` : 'None this week'}
        />
        <Stat
          label="Heard back"
          value={heardBack}
          detail={
            stats.applied
              ? `${stats.heardBack} of ${plural(stats.applied, 'application')}`
              : 'No applications yet'
          }
        />
      </div>
      <div className={styles.views}>
        <SegmentedControl
          label="Views"
          options={JOB_VIEWS.map((each) => ({
            value: each,
            label: JOB_VIEW_LABELS[each],
            count: counts[each],
          }))}
          value={view}
          onChange={setView}
        />
      </div>
      <SearchField
        label="Search jobs"
        placeholder="Search companies, roles and notes"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {shown.length === 0 ? (
        <p className={styles.none}>No jobs here{query ? ' match that search' : ''}.</p>
      ) : (
        <ul className={styles.list} aria-label="Jobs">
          {shown.map((row) => (
            <JobRow key={row.job.id} row={row} />
          ))}
        </ul>
      )}
    </>
  );
}
