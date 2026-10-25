import { type AskedJob, JOB_STATUS_LABELS, readStatus } from '@factwright/core';

/** How a job in your job hunt is said, in the popup and the panel. */

/** A day, as "Oct 20". */
export const day = (on: string) =>
  new Date(`${on}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** A job's status, in the jobs page's words, with the day you applied. */
export function statusWords(job: AskedJob): string {
  const status = readStatus(job.status) ?? 'new';
  const words = JOB_STATUS_LABELS[status];
  return status === 'applied' && job.appliedOn ? `${words} ${day(job.appliedOn)}` : words;
}
