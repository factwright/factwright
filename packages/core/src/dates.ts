const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. "2026-02-30" is false. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** The first YYYY-MM-DD date in some text, such as "2026-10-07" in "Checked Oct 7 (2026-10-07)". */
export function firstDate(text: string | null | undefined): string | null {
  return text?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

/** A date as YYYY-MM-DD in the computer's own time zone: "today" for the user. */
export function localDate(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The date some whole days after another, as YYYY-MM-DD: "2026-10-17" a week after "2026-10-10". */
export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD date to another: 1 from "2026-10-09" to "2026-10-10". */
export function daysBetween(from: string, to: string): number {
  const day = (date: string) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((day(to) - day(from)) / 86_400_000);
}
