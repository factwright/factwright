import {
  type Attention,
  isInView,
  JOB_VIEWS,
  type Job,
  type JobProgress,
  type JobView,
  jobProgress,
  nextStep,
} from '@factwright/core';

/** A job as the phone's list shows it: the job, where it stands, and its next step. */
export interface PhoneRow {
  job: Job;
  progress: JobProgress;
  next: Attention | null;
}

export const VIEW_LABELS: Readonly<Record<JobView, string>> = {
  active: 'Active',
  review: 'To review',
  applied: 'Applied',
  closed: 'Closed',
  all: 'All',
};

const URGENCY = { urgent: 0, action: 1, info: 2 } as const;

/** What needs the user comes first, then what happened most recently. */
function byUrgency(a: PhoneRow, b: PhoneRow): number {
  const level = (row: PhoneRow) =>
    row.progress.attention ? URGENCY[row.progress.attention.level] : 3;
  return (
    level(a) - level(b) ||
    (b.progress.lastActivity ?? '').localeCompare(a.progress.lastActivity ?? '') ||
    a.job.company.localeCompare(b.job.company)
  );
}

/** Every job that isn't archived, as rows, most pressing first. */
export function phoneRows(jobs: readonly Job[], today: string): PhoneRow[] {
  return jobs
    .filter((job) => !job.archived)
    .map((job) => {
      const progress = jobProgress(job, today);
      return { job, progress, next: nextStep(job, progress, today) };
    })
    .sort(byUrgency);
}

/** The rows in a view, narrowed to those matching what was typed in search. */
export function visible(rows: readonly PhoneRow[], view: JobView, query: string): PhoneRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(({ job, progress }) => {
    if (!isInView(view, progress.status)) return false;
    const text = `${job.company} ${job.role} ${job.notes ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** How many jobs each view has. */
export function viewCounts(rows: readonly PhoneRow[]): Record<JobView, number> {
  return Object.fromEntries(
    JOB_VIEWS.map((view) => [
      view,
      rows.filter((row) => isInView(view, row.progress.status)).length,
    ]),
  ) as Record<JobView, number>;
}

/** Opens on the active jobs, or on the ones to review before any are active. */
export const startingView = (rows: readonly PhoneRow[]): JobView =>
  viewCounts(rows).active > 0 ? 'active' : 'review';
