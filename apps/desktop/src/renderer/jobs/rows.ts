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
  /** Where the jobs turned up first, such as "HN October 2026". */
  source: string | null;
  /** The least yearly pay to show, in dollars. */
  minPay: number | null;
  hasResume: boolean;
  showArchived: boolean;
}

/** The filters, all off. */
export const NO_FILTERS: Omit<ListFilter, 'view' | 'query' | 'needsYou'> = {
  tiers: [],
  source: null,
  minPay: null,
  hasResume: false,
  showArchived: false,
};

/** How many filters are on, for the Filters button. */
export function filterCount(filter: ListFilter): number {
  return (
    filter.tiers.length +
    [filter.source, filter.minPay, filter.hasResume, filter.showArchived].filter(Boolean).length
  );
}

/** Every place jobs turned up first, for the filters. */
export function sources(rows: readonly JobRow[]): string[] {
  return [...new Set(rows.map((row) => row.job.source).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function jobRows(jobs: readonly Job[], today: string): JobRow[] {
  return jobs.map((job) => {
    const progress = jobProgress(job, today);
    const searchText = [
      job.company,
      job.role,
      job.notes,
      job.summary,
      job.source,
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
    if (filter.source && job.source !== filter.source) return false;
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

/** The view to open on: active jobs, or the ones to review when nothing is active yet. */
export function startingView(rows: readonly JobRow[]): JobView {
  const open = rows.filter((row) => !row.job.archived);
  const active = open.some((row) => isInView('active', row.progress.status));
  return !active && open.some((row) => row.progress.status === 'new') ? 'review' : 'active';
}
