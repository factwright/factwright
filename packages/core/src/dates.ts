const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. "2026-02-30" is false. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
