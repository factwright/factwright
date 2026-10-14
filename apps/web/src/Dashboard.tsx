import { JOB_VIEW_LABELS, JOB_VIEWS, type JobView, jobStats, payLabel } from '@factwright/core';
import {
  Button,
  EmptyState,
  FitBadge,
  SearchField,
  SegmentedControl,
  Select,
  Stat,
  StatusPill,
} from '@factwright/ui';
import { Briefcase, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import styles from './Dashboard.module.css';
import {
  ofKind,
  type PhoneRow,
  phoneRows,
  setAside,
  startingView,
  viewCounts,
  visible,
} from './jobs.ts';
import { navigate } from './route.ts';
import type { Vault } from './vault.ts';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const NEXT_TONE = { urgent: styles.urgent, action: styles.action, info: undefined } as const;

/** Where the kind of job picked is kept, so it's still picked on coming back from a job. */
const KIND_KEY = 'jobs.kind';

function keptKind(): string | null {
  try {
    return sessionStorage.getItem(KIND_KEY);
  } catch {
    return null;
  }
}

function keepKind(kind: string | null) {
  try {
    if (kind) sessionStorage.setItem(KIND_KEY, kind);
    else sessionStorage.removeItem(KIND_KEY);
  } catch {
    // Kept only until the page goes, then.
  }
}

function JobRow({ row, page, showKind }: { row: PhoneRow; page: string; showKind: boolean }) {
  const { job, progress, next } = row;
  const pay = payLabel(job.pay);
  const address = `/jobs/${page}`;
  return (
    <li>
      <a
        className={styles.row}
        href={address}
        onClick={(event) => {
          event.preventDefault();
          navigate(address);
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
          {showKind && row.kind && <span className={styles.kind}>{row.kind.name}</span>}
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
  const rows = useMemo(() => phoneRows(vault.jobs, today, vault.kinds), [vault, today]);
  const [picked, setPicked] = useState(keptKind);
  // A kind of job picked, then removed on the computer, shows every kind again.
  const kind = vault.kinds.some((each) => each.id === picked) ? picked : null;
  const kindRows = ofKind(rows, kind);
  const [view, setView] = useState<JobView>(() => startingView(kindRows));
  const [query, setQuery] = useState('');
  const counts = viewCounts(kindRows);
  const shown = visible(kindRows, view, query);
  const later = setAside(kindRows, view, query);
  const stats = jobStats(kindRows, today);
  const showKind = vault.kinds.length > 1 && !kind;
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
      {vault.kinds.length > 1 && (
        <Select
          className={styles.kindOf}
          aria-label="Kind of job"
          value={kind ?? ''}
          onChange={(event) => {
            const next = event.target.value || null;
            setPicked(next);
            keepKind(next);
          }}
        >
          <option value="">Every kind of job</option>
          {vault.kinds.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name} ({rows.filter((row) => row.kind?.id === each.id).length})
            </option>
          ))}
        </Select>
      )}
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
        <p className={styles.none}>
          {later.length > 0 && !query
            ? 'Nothing to review. The rest are set aside.'
            : `No jobs here${query ? ' match that search' : ''}.`}
        </p>
      ) : (
        <ul className={styles.list} aria-label="Jobs">
          {shown.map((row) => (
            <JobRow
              key={row.job.id}
              row={row}
              page={vault.pages.get(row.job.id) ?? ''}
              showKind={showKind}
            />
          ))}
        </ul>
      )}
      {later.length > 0 && (
        <details className={styles.later}>
          <summary className={styles.laterName}>
            Later <span className={styles.laterCount}>{later.length}</span>
          </summary>
          <ul className={styles.list} aria-label="Set aside for later">
            {later.map((row) => (
              <JobRow
                key={row.job.id}
                row={row}
                page={vault.pages.get(row.job.id) ?? ''}
                showKind={showKind}
              />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
