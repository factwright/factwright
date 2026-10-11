import { type JobView, jobStats } from '@factwright/core';
import { Button, EmptyState, SegmentedControl, Stat } from '@factwright/ui';
import { Briefcase, SearchX } from 'lucide-react';
import { JobList } from './JobList.tsx';
import styles from './JobsPage.module.css';
import { type JobRow, type ListFilter, viewCounts, visibleRows } from './rows.ts';
import type { JobsState } from './useJobs.ts';

const VIEW_LABELS: Readonly<Record<JobView, string>> = {
  active: 'Active',
  review: 'To review',
  applied: 'Applied',
  closed: 'Closed',
  all: 'All',
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export interface JobsPageProps {
  jobs: JobsState;
  rows: readonly JobRow[];
  today: string;
  filter: ListFilter;
  onFilter: (filter: ListFilter) => void;
  selectedId: string | null;
  onSelect: (jobId: string) => void;
  onRetry: () => void;
  canStartClaude: boolean;
  onStartClaude: () => void;
}

/** The jobs page: the numbers that matter, the views, and the list of jobs. */
export function JobsPage(props: JobsPageProps) {
  const { jobs, rows, today, filter, onFilter } = props;
  if (jobs.state === 'loading') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Jobs</h1>
        <p className={styles.quiet} role="status">
          Loading your jobs…
        </p>
      </main>
    );
  }
  if (jobs.state === 'failed') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Jobs</h1>
        <EmptyState
          title="Your jobs didn’t load"
          icon={<Briefcase size={20} aria-hidden="true" />}
          action={<Button onClick={props.onRetry}>Try again</Button>}
        >
          Something went wrong reading your workspace. Your files and tracker are safe.
        </EmptyState>
      </main>
    );
  }

  const open = rows.filter((row) => !row.job.archived);
  const stats = jobStats(rows, today);
  const counts = viewCounts(rows, filter);
  const shown = visibleRows(rows, filter);
  const heardBack = stats.applied ? `${Math.round((100 * stats.heardBack) / stats.applied)}%` : '—';

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Jobs</h1>
      {open.length > 0 && <p className={styles.summary}>{plural(open.length, 'job')}</p>}

      {open.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          icon={<Briefcase size={20} aria-hidden="true" />}
          action={
            <Button
              variant="primary"
              onClick={props.onStartClaude}
              disabled={!props.canStartClaude}
            >
              Start Claude
            </Button>
          }
        >
          Jobs you find and check show up here on their own. Start your Claude and ask it to check a
          job posting, or to find jobs that fit you.
        </EmptyState>
      ) : (
        <>
          <div className={styles.stats}>
            <Stat
              label="In play"
              value={stats.inPlay}
              detail={`${stats.interviewing} interviewing · ${plural(stats.callsAhead, 'call')} ahead`}
            />
            <Stat
              label="Applied"
              value={stats.applied}
              detail={
                stats.appliedThisWeek ? `${stats.appliedThisWeek} this week` : 'None this week'
              }
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
          </div>

          <div className={styles.toolbar}>
            <SegmentedControl
              label="Views"
              options={(Object.keys(VIEW_LABELS) as JobView[]).map((view) => ({
                value: view,
                label: VIEW_LABELS[view],
                count: counts[view],
              }))}
              value={filter.view}
              onChange={(view) => onFilter({ ...filter, view })}
            />
            <label className={styles.needsYou}>
              <input
                type="checkbox"
                checked={filter.needsYou}
                onChange={(event) => onFilter({ ...filter, needsYou: event.target.checked })}
              />
              Needs you
            </label>
          </div>

          {shown.length > 0 ? (
            <JobList rows={shown} selectedId={props.selectedId} onSelect={props.onSelect} />
          ) : (
            <div className={styles.noMatch}>
              <EmptyState
                title={filter.query ? `No jobs match “${filter.query}”` : 'Nothing here right now'}
                icon={<SearchX size={20} aria-hidden="true" />}
                action={
                  filter.query || filter.needsYou ? (
                    <Button onClick={() => onFilter({ ...filter, query: '', needsYou: false })}>
                      Show all in {VIEW_LABELS[filter.view]}
                    </Button>
                  ) : undefined
                }
              >
                {filter.query || filter.needsYou
                  ? 'Try another view, or clear the search.'
                  : 'Jobs move here as they change. Try another view.'}
              </EmptyState>
            </div>
          )}
        </>
      )}
    </main>
  );
}
