import {
  type Attention,
  type FitTier,
  isInView,
  isSetAside,
  JOB_VIEWS,
  type Job,
  type JobProgress,
  type JobStatus,
  type JobView,
  jobProgress,
  type KindName,
  kindOfJob,
  nextStep,
  shortDate,
  viewOf,
  startingView as viewToOpen,
} from '@factwright/core';
import { FIT_TIER_DISPLAY, JOB_STATUS_DISPLAY, MOOD_DISPLAY } from '@factwright/ui';

/** A job as the list shows it: the job, where it stands, and its next step. */
export interface JobRow {
  job: Job;
  progress: JobProgress;
  next: Attention | null;
  /**
   * The kind of job it's under, when the user wants more than one: the one they put it under,
   * or else the one the job search or fit check found it as, or else their first. Null with one.
   */
  kind: KindName | null;
  /** Everything the search box looks through, in lowercase. */
  searchText: string;
}

/** A fit level to filter by: one of the tiers, or "none" for jobs that aren't scored yet. */
export type TierFilter = FitTier | 'none';

/** What narrows the list: the view, the search box, "Needs you", and the filters. */
export interface ListFilter {
  view: JobView;
  query: string;
  needsYou: boolean;
  /** The kind of job to show, by its id, or null for every kind. */
  kind: string | null;
  /** The fit levels to show. None picked shows every level. */
  tiers: TierFilter[];
  /**
   * Where the jobs came from: a job search, as "search:" and its folder, which names the run,
   * or another way, as "from:" and its name, such as "from:Added by hand".
   */
  found: string | null;
  /** The least yearly pay to show, in dollars. */
  minPay: number | null;
  hasResume: boolean;
  showArchived: boolean;
}

/** The filters, all off. */
export const NO_FILTERS: Omit<ListFilter, 'view' | 'query' | 'needsYou'> = {
  kind: null,
  tiers: [],
  found: null,
  minPay: null,
  hasResume: false,
  showArchived: false,
};

/**
 * How many filters are on, for the Filters button. The kind of job and where jobs came from have
 * their own menus.
 */
export function filterCount(filter: ListFilter): number {
  return (
    filter.tiers.length +
    [filter.minPay, filter.hasResume, filter.showArchived].filter(Boolean).length
  );
}

/** A place jobs came from, for the "Found by" menu, with how many jobs it holds. */
export interface FoundOption {
  value: string;
  label: string;
  count: number;
}

/** Whether a job came from where the "Found by" menu says. */
function cameFrom(job: Job, found: string): boolean {
  if (found.startsWith('search:')) {
    const folder = found.slice('search:'.length);
    return job.searches.some((run) => run.folder === folder);
  }
  return job.searches.length === 0 && `from:${job.source}` === found;
}

/**
 * Where the jobs came from, for the "Found by" menu: each job search, newest first, by where it
 * looked and, when two looked in the same place, when; then the other ways jobs came, such as
 * fit checks of postings the user found and jobs added by hand. Each counts the jobs still in
 * the lists, and stays even when they're all archived, so a search picked never vanishes.
 */
export function foundOptions(
  rows: readonly JobRow[],
  today: string,
): { searches: FoundOption[]; others: FoundOption[] } {
  const runs = new Map<string, { source: string; date: string | null; count: number }>();
  const others = new Map<string, number>();
  for (const { job } of rows) {
    const counted = job.archived ? 0 : 1;
    for (const run of job.searches) {
      const known = runs.get(run.folder) ?? { ...run, count: 0 };
      runs.set(run.folder, { ...known, count: known.count + counted });
    }
    if (job.searches.length === 0 && job.source) {
      others.set(job.source, (others.get(job.source) ?? 0) + counted);
    }
  }
  const sources = [...runs.values()].map((run) => run.source);
  const searches = [...runs.entries()]
    .sort(([a, x], [b, y]) => (y.date ?? '').localeCompare(x.date ?? '') || b.localeCompare(a))
    .map(([folder, run]) => {
      const twice = sources.filter((source) => source === run.source).length > 1;
      const when = twice && run.date ? ` · ${shortDate(run.date, today)}` : '';
      return { value: `search:${folder}`, label: `${run.source}${when}`, count: run.count };
    });
  return {
    searches,
    others: [...others.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, count]) => ({ value: `from:${source}`, label: source, count })),
  };
}

/** The filter, with a kind of job the user no longer wants, such as one removed, back to every kind. */
export function withKnownKind(filter: ListFilter, kinds: readonly KindName[]): ListFilter {
  return filter.kind === null || kinds.some((kind) => kind.id === filter.kind)
    ? filter
    : { ...filter, kind: null };
}

/**
 * What the list shows once a job is added, so it's there: all of the view it starts in, still of
 * the kind of job picked when the job is that kind.
 */
export function filterForAdded(
  filter: ListFilter,
  status: JobStatus,
  kind: string | null,
): ListFilter {
  return {
    ...NO_FILTERS,
    kind: kind === filter.kind ? kind : null,
    view: viewOf(status),
    query: '',
    needsYou: false,
  };
}

/** The rows of one kind of job, or every row for every kind. */
export const ofKind = (rows: readonly JobRow[], kind: string | null): readonly JobRow[] =>
  kind ? rows.filter((row) => row.kind?.id === kind) : rows;

/**
 * The jobs as the list shows them. With more than one kind of job, each is under one of them,
 * and searching for a kind's name finds its jobs.
 */
export function jobRows(
  jobs: readonly Job[],
  today: string,
  kinds: readonly KindName[] = [],
): JobRow[] {
  return jobs.map((job) => {
    const progress = jobProgress(job, today);
    const id = kinds.length > 1 ? kindOfJob(job, kinds) : null;
    const kind = kinds.find((each) => each.id === id) ?? null;
    const searchText = [
      job.company,
      job.role,
      job.earlierNotes,
      ...job.notes.map((note) => note.text),
      job.summary,
      job.source,
      ...job.searches.map((run) => run.source),
      job.nextAction,
      job.pay?.text,
      job.location,
      job.fit?.verdict,
      job.apply,
      kind?.name,
      JOB_STATUS_DISPLAY[progress.status].label,
      progress.tier && FIT_TIER_DISPLAY[progress.tier].label,
      job.sentiment?.mood && MOOD_DISPLAY[job.sentiment.mood].label,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return { job, progress, next: nextStep(job, progress, today), kind, searchText };
  });
}

/** The rows that match the search box, "Needs you" and the filters, whatever the view. */
function matching(rows: readonly JobRow[], filter: ListFilter): JobRow[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(({ job, progress, kind, searchText }) => {
    if (job.archived && !filter.showArchived) return false;
    if (filter.needsYou && progress.attention === null) return false;
    if (filter.kind && kind?.id !== filter.kind) return false;
    if (filter.tiers.length > 0 && !filter.tiers.includes(progress.tier ?? 'none')) return false;
    if (filter.found && !cameFrom(job, filter.found)) return false;
    if (filter.minPay && (job.pay?.max ?? 0) < filter.minPay) return false;
    if (filter.hasResume && job.files.length === 0) return false;
    return words.every((word) => searchText.includes(word));
  });
}

/** Whether a row is in a view's list, leaving out To review's jobs set aside for later. */
const listed = (view: JobView, row: JobRow) =>
  isInView(view, row.progress.status) && !(view === 'review' && isSetAside(row.progress));

const recent = (row: JobRow) => row.progress.lastActivity ?? '';

const byActivity = (a: JobRow, b: JobRow) =>
  recent(b).localeCompare(recent(a)) ||
  a.job.company.localeCompare(b.job.company) ||
  a.job.role.localeCompare(b.job.role);

/** The rows to show, most recent activity first. */
export function visibleRows(rows: readonly JobRow[], filter: ListFilter): JobRow[] {
  return matching(rows, filter)
    .filter((row) => listed(filter.view, row))
    .sort(byActivity);
}

/**
 * The jobs set aside for later, folded at the bottom of To review: those coming back soonest
 * first, then those with no day to come back. Other views have none.
 */
export function laterRows(rows: readonly JobRow[], filter: ListFilter): JobRow[] {
  if (filter.view !== 'review') return [];
  const back = (row: JobRow) => row.job.backOn ?? '9999';
  return matching(rows, filter)
    .filter((row) => isSetAside(row.progress))
    .sort((a, b) => back(a).localeCompare(back(b)) || byActivity(a, b));
}

/**
 * How many rows each view would show with the same search and "Needs you". To review doesn't
 * count the jobs set aside, so it can be worked down to nothing.
 */
export function viewCounts(rows: readonly JobRow[], filter: ListFilter): Record<JobView, number> {
  const shown = matching(rows, filter);
  return Object.fromEntries(
    JOB_VIEWS.map((view) => [view, shown.filter((row) => listed(view, row)).length]),
  ) as Record<JobView, number>;
}

/**
 * The view that holds now what a view kept by an earlier version held, before New was a view:
 * its To review held the jobs new to the user, and its To apply those Claude had worked on.
 */
export function viewNow(earlier: JobView | null): JobView | null {
  if (earlier === 'review') return 'new';
  return earlier === 'apply' ? 'review' : earlier;
}

/**
 * The view to open on: the furthest along with jobs in it, where things move fastest. Jobs set
 * aside for later count only when they're all there is, so it opens on To review, which folds
 * them away, only then.
 */
export function startingView(rows: readonly JobRow[]): JobView {
  const open = rows.filter((row) => !row.job.archived);
  const counted = open.filter((row) => !isSetAside(row.progress));
  if (counted.length === 0 && open.length > 0) return 'review';
  return viewToOpen(counted.map((row) => row.progress.status));
}

/**
 * The job a step away from the current one, in the order the list had when a job took the
 * window, passing over jobs that have gone since. Null at either end.
 */
export function stepFrom(
  order: readonly string[],
  current: string,
  offset: -1 | 1,
  present: (jobId: string) => boolean,
): string | null {
  const at = order.indexOf(current);
  if (at < 0) return null;
  for (let next = at + offset; next >= 0 && next < order.length; next += offset) {
    const id = order[next];
    if (id && present(id)) return id;
  }
  return null;
}
