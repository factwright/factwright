import { JOB_VIEW_LABELS, JOB_VIEWS, jobStats, type KindName } from '@factwright/core';
import { Button, Checkbox, EmptyState, SegmentedControl, Select, Stat } from '@factwright/ui';
import { Activity, Briefcase, Search, SearchX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { isBoolean, usePref } from '../prefs.ts';
import { BulkBar, type Moved } from './BulkBar.tsx';
import { FiltersPanel } from './FiltersPanel.tsx';
import { JobList } from './JobList.tsx';
import styles from './JobsPage.module.css';
import {
  type FoundOption,
  filterCount,
  foundOptions,
  type JobRow,
  type ListFilter,
  laterRows,
  NO_FILTERS,
  ofKind,
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

/**
 * The kind of job to show, for a user who wants more than one, such as only their project
 * manager jobs. The numbers above the list follow it.
 */
function KindOf({
  rows,
  kinds,
  filter,
  onFilter,
}: {
  rows: readonly JobRow[];
  kinds: readonly KindName[];
  filter: ListFilter;
  onFilter: (filter: ListFilter) => void;
}) {
  if (kinds.length < 2) return null;
  const open = rows.filter((row) => !row.job.archived);
  return (
    <Select
      className={`${styles.foundBy} ${filter.kind ? styles.foundOn : ''}`}
      aria-label="Kind of job"
      value={filter.kind ?? ''}
      onChange={(event) => onFilter({ ...filter, kind: event.target.value || null })}
    >
      <option value="">Every kind of job</option>
      {kinds.map((kind) =>
        option({
          value: kind.id,
          label: kind.name,
          count: open.filter((row) => row.kind?.id === kind.id).length,
        }),
      )}
    </Select>
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export interface JobsPageProps {
  jobs: JobsState;
  api: FactwrightApi;
  rows: readonly JobRow[];
  /** The kinds of job the user wants, when there's more than one. None with one. */
  kinds?: readonly KindName[];
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

/**
 * Picking jobs in the list, to move several at once: a click picks one, and Shift picks every
 * job from the last one picked. Picks go when the view changes, and don't come back with it.
 */
function usePicks(view: string) {
  const [picks, setPicks] = useState<{ view: string; ids: ReadonlySet<string>; last: string }>({
    view,
    ids: new Set(),
    last: '',
  });
  if (picks.view !== view) setPicks({ view, ids: new Set(), last: '' });
  const ids = picks.view === view ? picks.ids : new Set<string>();
  const set = (next: ReadonlySet<string>, last = picks.last) => setPicks({ view, ids: next, last });
  return {
    ids,
    clear: () => set(new Set(), ''),
    pick: (order: readonly string[], jobId: string, on: boolean, range: boolean) => {
      const from = order.indexOf(picks.last);
      const to = order.indexOf(jobId);
      const run =
        range && from >= 0 && to >= 0
          ? order.slice(Math.min(from, to), Math.max(from, to) + 1)
          : [jobId];
      const next = new Set(ids);
      for (const id of run) {
        if (on) next.add(id);
        else next.delete(id);
      }
      set(next, jobId);
    },
    pickAll: (order: readonly string[], on: boolean) => set(new Set(on ? order : [])),
  };
}

/** The jobs page: the numbers that matter, the views, and the list of jobs. */
export function JobsPage(props: JobsPageProps) {
  const { jobs, rows, today, filter, onFilter, kinds = [] } = props;
  const picks = usePicks(filter.view);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [laterOpen, setLaterOpen] = usePref('jobs.laterOpen', false, isBoolean);
  // Once the bar closes with the keyboard's focus in it, the focus goes back to the list: the
  // box that selects every job, or else the view picked.
  const page = useRef<HTMLElement>(null);
  const backToList = useRef(false);
  useEffect(() => {
    if (moved || !backToList.current) return;
    backToList.current = false;
    const all = page.current?.querySelector<HTMLElement>('[data-select-all]');
    (all ?? page.current?.querySelector<HTMLElement>('input[type="radio"]:checked'))?.focus();
  }, [moved]);
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
  // With a kind of job picked, the numbers are that kind's.
  const kindRows = ofKind(rows, filter.kind);
  const kindOpen = kindRows.filter((row) => !row.job.archived);
  const stats = jobStats(kindRows, today);
  const counts = viewCounts(rows, filter);
  const shown = visibleRows(rows, filter);
  const later = laterRows(rows, filter);
  const heardBack = stats.applied ? `${Math.round((100 * stats.heardBack) / stats.applied)}%` : '—';
  const narrowed = Boolean(
    filter.query || filter.needsYou || filter.kind || filter.found || filterCount(filter),
  );
  // The jobs in the order they show, for picking a run of them, and those picked among them.
  // Jobs folded away under Later aren't moved, even if they were picked before it folded.
  const listed = [...shown, ...(laterOpen ? later : [])];
  const order = listed.map((row) => row.job.id);
  const picked = listed.filter((row) => picks.ids.has(row.job.id));
  const changeView = (view: ListFilter['view']) => {
    setMoved(null);
    onFilter({ ...filter, view });
  };

  return (
    <main ref={page} className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Jobs</h1>
          {open.length > 0 && (
            <p className={styles.summary}>
              {filter.kind
                ? `${kindOpen.length} of ${plural(open.length, 'job')}`
                : plural(open.length, 'job')}
            </p>
          )}
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
            <div className={styles.views}>
              <SegmentedControl
                label="Views"
                options={JOB_VIEWS.map((view) => ({
                  value: view,
                  label: JOB_VIEW_LABELS[view],
                  count: counts[view],
                }))}
                value={filter.view}
                onChange={changeView}
              />
            </div>
            <div className={styles.narrowing}>
              <KindOf rows={rows} kinds={kinds} filter={filter} onFilter={onFilter} />
              <FoundBy rows={kindRows} today={today} filter={filter} onFilter={onFilter} />
              <Checkbox
                label="Needs you"
                checked={filter.needsYou}
                onChange={(event) => onFilter({ ...filter, needsYou: event.target.checked })}
              />
              <FiltersPanel filter={filter} onFilter={onFilter} />
            </div>
          </div>

          {shown.length > 0 || later.length > 0 ? (
            <>
              {shown.length === 0 && (
                <p className={styles.caughtUp}>Nothing to review. The rest are set aside.</p>
              )}
              <JobList
                rows={shown}
                view={filter.view}
                today={today}
                // Each job's kind, while every kind shows.
                showKind={kinds.length > 1 && !filter.kind}
                // Only when the jobs come from more than one search: otherwise it's only noise.
                showFound={
                  (filter.view === 'new' || filter.view === 'review') &&
                  new Set(shown.flatMap(({ job }) => job.searches.map((run) => run.folder))).size >
                    1
                }
                selectedId={props.selectedId}
                onSelect={props.onSelect}
                picks={{
                  picked: picks.ids,
                  label: JOB_VIEW_LABELS[filter.view],
                  onPick: (jobId, on, range) => {
                    setMoved(null);
                    picks.pick(order, jobId, on, range);
                  },
                  onPickAll: (on) => {
                    setMoved(null);
                    picks.pickAll(
                      shown.map((row) => row.job.id),
                      on,
                    );
                  },
                }}
                later={{ rows: later, open: laterOpen, onToggle: () => setLaterOpen(!laterOpen) }}
              />
            </>
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
          {/* After it, so moving every job out of the view still leaves the way to undo it. */}
          <BulkBar
            view={filter.view}
            picked={picked}
            moved={moved}
            rows={rows}
            today={today}
            api={props.api}
            onMoved={(next) => {
              picks.clear();
              setMoved(next);
            }}
            onClear={picks.clear}
            onDone={(fromBar) => {
              backToList.current = fromBar;
              setMoved(null);
            }}
          />
        </>
      )}
    </main>
  );
}
