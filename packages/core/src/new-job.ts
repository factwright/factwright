import { companyKey, roleKey, slug } from './keys.ts';
import type { JobStatus } from './tracker.ts';

/** The longest text each of a new job's fields takes, as the app's Add job dialog stops at. */
export const JOB_LIMITS = { company: 200, role: 300, link: 2000, pay: 200 } as const;

/**
 * A job's ID from its company and role, as Add job makes it, such as "acme-robotics--staff-engineer".
 * A second job with the same company and role takes "-2", then "-3", after it.
 */
export function jobIdFor(company: string, role: string): string {
  return `${companyKey(company) || slug(company) || 'job'}--${roleKey(role) || 'general'}`;
}

/** A new job's rows, as the app keeps them and sync carries them. */
export interface NewJobRows {
  job: Record<string, string | number | null>;
  status: Record<string, string | number | null>;
}

/**
 * The rows a job added by hand starts with, as the desktop app's tracker keeps them: every column
 * it has, with its defaults, so a computer that takes the job from sync holds the same row, and
 * has nothing of its own to send back. Another device, such as the browser extension, adds a job
 * through sync with these. The tracker's own tests check they still match its tables.
 */
export function newJobRows(job: {
  id: string;
  company: string;
  role: string;
  link: string;
  pay: string;
  status: JobStatus;
  /** Today, as YYYY-MM-DD in the user's time, and now, as an ISO time. */
  today: string;
  now: string;
  /** The status change's own ID, such as a random UUID. */
  statusId: string;
}): NewJobRows {
  const company = job.company.trim().slice(0, JOB_LIMITS.company);
  const link = job.link.trim().slice(0, JOB_LIMITS.link);
  return {
    job: {
      id: job.id,
      company,
      company_key: companyKey(company),
      role: job.role.trim().slice(0, JOB_LIMITS.role),
      links: JSON.stringify(link ? [{ url: link, label: 'Posting' }] : []),
      manual: 1,
      pay_text: job.pay.trim().slice(0, JOB_LIMITS.pay) || null,
      first_seen: job.today,
      status: job.status,
      status_on: job.today,
      applied_on: job.status === 'applied' ? job.today : null,
      next_action: null,
      next_on: null,
      notes: null,
      archived: 0,
      updated_at: job.now,
      questions: '[]',
      sent: '[]',
      asks: '[]',
      back_on: null,
      pass_reason: null,
      kind: null,
    },
    status: { id: job.statusId, job_id: job.id, status: job.status, at: job.today },
  };
}
