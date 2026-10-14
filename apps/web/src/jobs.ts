import {
  type Attention,
  isInView,
  isSetAside,
  JOB_VIEWS,
  type Job,
  type JobProgress,
  type JobView,
  jobProgress,
  nextStep,
  startingView as viewToOpen,
} from '@factwright/core';

/** A job as the phone's list shows it: the job, where it stands, and its next step. */
export interface PhoneRow {
  job: Job;
  progress: JobProgress;
  next: Attention | null;
}

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

/** Whether a row is in a view's list, leaving out To review's jobs set aside for later. */
const listed = (view: JobView, row: PhoneRow) =>
  isInView(view, row.progress.status) && !(view === 'review' && isSetAside(row.progress));

/** The rows matching what was typed in search. */
function matching(rows: readonly PhoneRow[], query: string): PhoneRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(({ job }) => {
    const notes = [job.earlierNotes ?? '', ...job.notes.map((note) => note.text)].join(' ');
    const text = `${job.company} ${job.role} ${notes}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** The rows in a view, narrowed to those matching what was typed in search. */
export function visible(rows: readonly PhoneRow[], view: JobView, query: string): PhoneRow[] {
  return matching(rows, query).filter((row) => listed(view, row));
}

/** The jobs set aside for later, at the bottom of To review, the soonest back first. */
export function setAside(rows: readonly PhoneRow[], view: JobView, query: string): PhoneRow[] {
  if (view !== 'review') return [];
  const back = (row: PhoneRow) => row.job.backOn ?? '9999';
  return matching(rows, query)
    .filter((row) => isSetAside(row.progress))
    .sort((a, b) => back(a).localeCompare(back(b)));
}

/** How many jobs each view has. To review doesn't count the jobs set aside. */
export function viewCounts(rows: readonly PhoneRow[]): Record<JobView, number> {
  return Object.fromEntries(
    JOB_VIEWS.map((view) => [view, rows.filter((row) => listed(view, row)).length]),
  ) as Record<JobView, number>;
}

/**
 * Opens on the furthest view with jobs in it, such as the interviews. Jobs set aside for later
 * don't count, so it never opens on an empty To review.
 */
export const startingView = (rows: readonly PhoneRow[]): JobView =>
  viewToOpen(rows.filter((row) => !isSetAside(row.progress)).map((row) => row.progress.status));
