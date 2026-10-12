import {
  type Attention,
  type FitTier,
  isInView,
  JOB_VIEWS,
  type Job,
  type JobProgress,
  type JobView,
  jobProgress,
  nextStep,
  shortDate,
  startingView as viewToOpen,
} from '@factwright/core';
import { FIT_TIER_DISPLAY, JOB_STATUS_DISPLAY, MOOD_DISPLAY } from '@factwright/ui';

/** A job as the list shows it: the job, where it stands, and its next step. */
export interface JobRow {
  job: Job;
  progress: JobProgress;
  next: Attention | null;
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
  tiers: [],
  found: null,
  minPay: null,
  hasResume: false,
  showArchived: false,
};

/** How many filters are on, for the Filters button. Where jobs came from has its own menu. */
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

export function jobRows(jobs: readonly Job[], today: string): JobRow[] {
  return jobs.map((job) => {
    const progress = jobProgress(job, today);
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
      JOB_STATUS_DISPLAY[progress.status].label,
      progress.tier && FIT_TIER_DISPLAY[progress.tier].label,
      job.sentiment?.mood && MOOD_DISPLAY[job.sentiment.mood].label,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return { job, progress, next: nextStep(job, progress, today), searchText };
  });
}

/** The rows that match the search box, "Needs you" and the filters, whatever the view. */
function matching(rows: readonly JobRow[], filter: ListFilter): JobRow[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(({ job, progress, searchText }) => {
    if (job.archived && !filter.showArchived) return false;
    if (filter.needsYou && progress.attention === null) return false;
    if (filter.tiers.length > 0 && !filter.tiers.includes(progress.tier ?? 'none')) return false;
    if (filter.found && !cameFrom(job, filter.found)) return false;
    if (filter.minPay && (job.pay?.max ?? 0) < filter.minPay) return false;
    if (filter.hasResume && job.files.length === 0) return false;
    return words.every((word) => searchText.includes(word));
  });
}

/** The rows to show, most recent activity first. */
export function visibleRows(rows: readonly JobRow[], filter: ListFilter): JobRow[] {
  const recent = (row: JobRow) => row.progress.lastActivity ?? '';
  return matching(rows, filter)
    .filter((row) => isInView(filter.view, row.progress.status))
    .sort(
      (a, b) =>
        recent(b).localeCompare(recent(a)) ||
        a.job.company.localeCompare(b.job.company) ||
        a.job.role.localeCompare(b.job.role),
    );
}

/** How many rows each view would show with the same search and "Needs you". */
export function viewCounts(rows: readonly JobRow[], filter: ListFilter): Record<JobView, number> {
  const shown = matching(rows, filter);
  return Object.fromEntries(
    JOB_VIEWS.map((view) => [
      view,
      shown.filter((row) => isInView(view, row.progress.status)).length,
    ]),
  ) as Record<JobView, number>;
}

/** The view to open on: the furthest along with jobs in it, where things move fastest. */
export function startingView(rows: readonly JobRow[]): JobView {
  return viewToOpen(rows.filter((row) => !row.job.archived).map((row) => row.progress.status));
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
