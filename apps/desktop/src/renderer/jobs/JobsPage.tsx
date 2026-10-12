import { JOB_VIEW_LABELS, JOB_VIEWS, jobStats } from '@factwright/core';
import { Button, Checkbox, EmptyState, SegmentedControl, Select, Stat } from '@factwright/ui';
import { Activity, Briefcase, Search, SearchX } from 'lucide-react';
import { FiltersPanel } from './FiltersPanel.tsx';
import { JobList } from './JobList.tsx';
import styles from './JobsPage.module.css';
import {
  type FoundOption,
  filterCount,
  foundOptions,
  type JobRow,
  type ListFilter,
  NO_FILTERS,
  viewCounts,
  visibleRows,
} from './rows.ts';
import type { JobsState } from './useJobs.ts';

const option = ({ value, label, count }: FoundOption) => (
  <option key={value} value={value}>
    {label} ({count})
  </option>
);

/**
 * Where the jobs came from: each job search, so its jobs can be seen together, such as the
 * month's HN thread, then the other ways jobs came in.
 */
function FoundBy({
  rows,
  today,
  filter,
  onFilter,
}: {
  rows: readonly JobRow[];
  today: string;
  filter: ListFilter;
  onFilter: (filter: ListFilter) => void;
}) {
  const { searches, others } = foundOptions(rows, today);
  const { found } = filter;
  // What's picked always shows, even once nothing is left with it, so it can be cleared.
  const gone = found && ![...searches, ...others].some((each) => each.value === found);
  if (searches.length === 0 && others.length < 2 && !found) return null;
  return (
    <Select
      className={`${styles.foundBy} ${found ? styles.foundOn : ''}`}
      aria-label="Found by"
      value={found ?? ''}
      onChange={(event) => onFilter({ ...filter, found: event.target.value || null })}
    >
      <option value="">Found anywhere</option>
      {gone && option({ value: found, label: found.replace(/^(search|from):/, ''), count: 0 })}
      {searches.length > 0 && <optgroup label="Job searches">{searches.map(option)}</optgroup>}
      {others.length > 0 && <optgroup label="Other ways">{others.map(option)}</optgroup>}
    </Select>
  );
}

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
  /** Whether Claude can take a job search now: signed in, and not busy. */
  canFindJobs: boolean;
  onFindJobs: () => void;
  onOpenJourney: () => void;
  /** Opens getting started, for a user who hasn't told Factwright about themselves yet. */
  onGetStarted?: (() => void) | undefined;
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
  const narrowed = Boolean(filter.query || filter.needsYou || filter.found || filterCount(filter));

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Jobs</h1>
          {open.length > 0 && <p className={styles.summary}>{plural(open.length, 'job')}</p>}
        </div>
        <div className={styles.headActions}>
          <Button
            icon={<Search size={16} aria-hidden="true" />}
            onClick={props.onFindJobs}
            disabled={!props.canFindJobs}
          >
            Find jobs
          </Button>
          {rows.length > 0 && (
            <Button icon={<Activity size={16} aria-hidden="true" />} onClick={props.onOpenJourney}>
              Your journey
            </Button>
          )}
        </div>
      </div>

      {open.length === 0 && props.onGetStarted ? (
        <EmptyState
          title="No jobs yet"
          icon={<Briefcase size={20} aria-hidden="true" />}
          action={
            <Button variant="primary" onClick={props.onGetStarted}>
              Get started
            </Button>
          }
        >
          Tell Factwright about yourself first. Your Claude builds your fact bank from it, so it can
          find jobs that fit and write resumes that are true to you.
        </EmptyState>
      ) : open.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          icon={<Briefcase size={20} aria-hidden="true" />}
          action={
            <Button
              variant="primary"
              onClick={() => props.onStartClaude()}
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
              options={JOB_VIEWS.map((view) => ({
                value: view,
                label: JOB_VIEW_LABELS[view],
                count: counts[view],
              }))}
              value={filter.view}
              onChange={(view) => onFilter({ ...filter, view })}
            />
            <div className={styles.narrowing}>
              <FoundBy rows={rows} today={today} filter={filter} onFilter={onFilter} />
              <Checkbox
                label="Needs you"
                checked={filter.needsYou}
                onChange={(event) => onFilter({ ...filter, needsYou: event.target.checked })}
              />
              <FiltersPanel filter={filter} onFilter={onFilter} />
            </div>
          </div>

          {shown.length > 0 ? (
            <JobList
              rows={shown}
              view={filter.view}
              today={today}
              // Only when the jobs come from more than one search: otherwise it's only noise.
              showFound={
                filter.view === 'review' &&
                new Set(shown.flatMap(({ job }) => job.searches.map((run) => run.folder))).size > 1
              }
              selectedId={props.selectedId}
              onSelect={props.onSelect}
            />
          ) : (
            <div className={styles.noMatch}>
              <EmptyState
                title={filter.query ? `No jobs match “${filter.query}”` : 'Nothing here right now'}
                icon={<SearchX size={20} aria-hidden="true" />}
                action={
                  narrowed ? (
                    <Button
                      onClick={() =>
                        onFilter({ ...filter, ...NO_FILTERS, query: '', needsYou: false })
                      }
                    >
                      Show all in {JOB_VIEW_LABELS[filter.view]}
                    </Button>
                  ) : undefined
                }
              >
                {narrowed
                  ? 'Try another view, or clear the search and filters.'
                  : 'Jobs move here as they change. Try another view.'}
              </EmptyState>
            </div>
          )}
        </>
      )}
    </main>
  );
}
