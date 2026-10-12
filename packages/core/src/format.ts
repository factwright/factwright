import { localDate } from './dates.ts';
import type { JobPay } from './jobs.ts';

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const FULL_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * A date as "Oct 7", with the year when it isn't this year's. A full time, such as when a file
 * changed, counts on the user's own calendar.
 */
export function shortDate(date: string, today: string): string {
  const local = date.length > 10 ? localDate(new Date(date)) : date;
  const day = new Date(`${local}T00:00:00Z`);
  return (local.slice(0, 4) === today.slice(0, 4) ? MONTH_DAY : FULL_DATE).format(day);
}

/** A file's size: "52 KB", or "1.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const thousands = (amount: number) => `$${Math.round(amount / 1000)}k`;

/** Pay as a range, such as "$185k–$215k", marked "est." when a salary check estimated it. */
export function payLabel(pay: JobPay | null): string | null {
  if (!pay) return null;
  if (pay.min === null || pay.max === null) return null;
  const range =
    pay.min === pay.max ? thousands(pay.min) : `${thousands(pay.min)}–${thousands(pay.max)}`;
  return pay.source === 'estimate' ? `${range} est.` : range;
}
