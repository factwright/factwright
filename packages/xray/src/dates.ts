/**
 * Dates as resume parsers read them. They count your years of experience from each job's dates,
 * so a date they can't read can leave a job, or the time in it, uncounted.
 */

const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const YEAR = '(?:19|20)\\d{2}';
const SEASON = '(?:spring|summer|fall|autumn|winter)';

/** How a date is written, and whether parsers read it. */
export type DateForm = 'full' | 'month-year' | 'year' | 'now' | 'season' | 'quarter' | 'short-year';

/** The forms parsers read well: a whole date, a month and year, a year, or "Present". */
export const READABLE: ReadonlySet<DateForm> = new Set(['full', 'month-year', 'year', 'now']);

/** Each form, most specific first, so "Jun 2019" is a month and year rather than a year. */
const FORMS: readonly [DateForm, string][] = [
  ['season', `${SEASON}\\s+${YEAR}`],
  ['quarter', `q[1-4]\\s+${YEAR}`],
  ['short-year', `${MONTH}\\s*['’]\\d{2}(?!\\d)|\\d{1,2}/\\d{2}(?![\\d/])|['’]\\d{2}(?!\\d)`],
  [
    'full',
    `(?:0?[1-9]|1[0-2])[/.-](?:0?[1-9]|[12]\\d|3[01])[/.-]${YEAR}|${MONTH}\\s+\\d{1,2},\\s+${YEAR}`,
  ],
  [
    'month-year',
    `${MONTH},?\\s+${YEAR}|(?:0?[1-9]|1[0-2])[/.-]${YEAR}|${YEAR}[/.-](?:0?[1-9]|1[0-2])(?![\\d/.-])`,
  ],
  ['year', YEAR],
  ['now', 'present|current(?:ly)?|now|today|ongoing|to date'],
];

const DATE = FORMS.map(([, pattern]) => pattern).join('|');

/** A span of time: a start, a dash or "to", and an end. */
const RANGE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${DATE})\\s*(?:[–—―‒-]|\\bto\\b|\\bthrough\\b|\\buntil\\b|\\btill\\b)\\s*(${DATE})(?![\\p{L}\\p{N}])`,
  'giu',
);

/** One date on its own, such as when a degree was earned. */
const SINGLE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${DATE})(?![\\p{L}\\p{N}])`, 'giu');

/** How a date is written. */
export function formOf(date: string): DateForm {
  for (const [form, pattern] of FORMS) {
    if (new RegExp(`^(?:${pattern})$`, 'iu').test(date.trim())) return form;
  }
  return 'year';
}

/** A span of dates found in a line. */
export interface DateRange {
  /** The span as written, such as "04/2021 – Present". */
  text: string;
  start: string;
  end: string;
  /** Where it starts in the line. */
  at: number;
}

/** The spans of dates in a line of text. */
export function dateRanges(text: string): DateRange[] {
  return [...text.matchAll(RANGE)].map((match) => ({
    text: match[0],
    start: match[1] ?? '',
    end: match[2] ?? '',
    at: match.index ?? 0,
  }));
}

/** The dates in a line that aren't part of a span, such as a degree's year. */
export function singleDates(text: string): string[] {
  const spans = dateRanges(text);
  return [...text.matchAll(SINGLE)]
    .filter((match) => {
      const at = match.index ?? 0;
      return !spans.some((span) => at >= span.at && at < span.at + span.text.length);
    })
    .map((match) => match[0]);
}

/** Whether a span's dates are both in forms parsers read. */
export const readable = (range: DateRange) =>
  READABLE.has(formOf(range.start)) && READABLE.has(formOf(range.end));
