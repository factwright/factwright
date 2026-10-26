import { companyKey, roleKey, slug } from './keys.ts';
import type { JobStatus } from './tracker.ts';

/**
 * The longest text each of a job's fields takes, as the app's Add job dialog stops at, and its
 * Edit details: its company, role, link, pay and where it's worked.
 */
export const JOB_LIMITS = { company: 200, role: 300, link: 2000, pay: 200, location: 200 } as const;

/** How long each half of a job's ID gets, so the ID fits in a folder's name on every computer. */
const ID_PARTS = { company: 60, role: 80 } as const;

/** A key cut to a length, without a hyphen left at its end. */
const cut = (key: string, length: number) => key.slice(0, length).replace(/-+$/, '');

/**
 * A company's or a role's key, cut to its half of a job's ID, as every new job's ID is made: by
 * Add job, the browser extension and the jobs Claude's work finds.
 */
export const idPart = (key: string, half: keyof typeof ID_PARTS) => cut(key, ID_PARTS[half]);

/** A short, steady code for some text, such as a link: 8 hex digits (FNV-1a, over its UTF-16). */
export function shortCode(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * A job's ID from its company and role, as Add job makes it, such as "acme-robotics--staff-engineer".
 * Each half is cut short, so the ID fits in the name of a folder the job keeps things in, on every
 * computer. A second job with the same company and role takes "-2", then "-3", after it. A company
 * whose name has no Latin letters, such as "株式会社", is "job", and "job-" with the given code, such
 * as a short code of the job's link, when there is one, so such jobs don't all share an ID.
 */
export function jobIdFor(company: string, role: string, code?: string): string {
  const companyPart = idPart(companyKey(company) || slug(company), 'company');
  const rolePart = idPart(roleKey(role), 'role');
  return `${companyPart || (code ? `job-${code}` : 'job')}--${rolePart || 'general'}`;
}

/**
 * The ID a job had before IDs were cut short to fit a folder's name: its company's and role's
 * whole keys. The app still knows the jobs it added or found before then by these, so saving the
 * same job again from the browser looks for it there too. Null for a company with no Latin letters,
 * whose ID was never this.
 */
export function wholeJobId(company: string, role: string): string | null {
  const companyPart = companyKey(company) || slug(company);
  return companyPart ? `${companyPart}--${roleKey(role) || 'general'}` : null;
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
      merged_into: null,
      folder: null,
      pay_ask: null,
      own_company: null,
      own_role: null,
      own_pay: null,
      own_location: null,
      maybe_same: '[]',
    },
    status: { id: job.statusId, job_id: job.id, status: job.status, at: job.today },
  };
}
