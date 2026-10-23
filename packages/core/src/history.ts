/**
 * Work history and education, as Profile keeps them for forms that ask for each job and school
 * one at a time: every position you held, newest first, with the companies they were at, and
 * every school. Several positions at one company stay apart, each with its own title, dates and
 * what you did, under the company they share. Your Claude fills them in from your facts and your
 * resumes, and you can change them. They're kept in the workspace as about-me/history.json, so
 * they sync, and Claude reads them.
 */

/** One position you held: its title, when, and what you did, in a line or two. */
export interface Position {
  title: string;
  /** When it started, as "2021-03", or "2021" when only the year's known. */
  start: string;
  /** When it ended, the same way, or "present" while you hold it. */
  end: string;
  /** What you did there, as a form's box for a description takes it. */
  summary: string;
}

/** One company you worked at, with each position you held there, newest first. */
export interface Employer {
  company: string;
  /** Where you worked for it, such as "Denver, CO" or "Remote". */
  location: string;
  positions: Position[];
}

/** One school, with what you studied there. */
export interface School {
  school: string;
  /** Such as "B.S." or "Bachelor of Science". */
  degree: string;
  /** What you studied, such as "Computer Science". */
  field: string;
  start: string;
  /** When you finished, the same way as a position's, or "present" while you're there. */
  end: string;
}

export interface WorkHistory {
  /** The companies, by their newest position, newest first. */
  jobs: Employer[];
  /** The schools, by when you finished, newest first. */
  schools: School[];
}

export const NO_HISTORY: WorkHistory = { jobs: [], schools: [] };

/** How much a work history holds, at most. */
export const HISTORY_LIMITS = {
  jobs: 40,
  positions: 12,
  schools: 12,
  line: 200,
  summary: 2000,
} as const;

/** A date as Profile keeps it: a year, a year and a month, or "present", or nothing told. */
const DATE = /^(\d{4}(-(0[1-9]|1[0-2]))?|present)?$/;

/** A date as a position or school keeps it, or "" for one that isn't one. */
export function historyDate(value: unknown): string {
  const date = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return DATE.test(date) ? date : '';
}

const line = (value: unknown, max: number = HISTORY_LIMITS.line) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const list = (value: unknown, max: number): unknown[] =>
  Array.isArray(value) ? value.slice(0, max) : [];

const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * A work history from what the file says, each part checked on its own, so one entry that doesn't
 * hold up never loses the rest. A company with no name or no position, and a school with no name,
 * are left out.
 */
export function readHistory(value: unknown): WorkHistory {
  const file = object(value);
  const jobs = list(file.jobs, HISTORY_LIMITS.jobs).flatMap((each): Employer[] => {
    const job = object(each);
    const company = line(job.company);
    const positions = list(job.positions, HISTORY_LIMITS.positions).flatMap((one): Position[] => {
      const position = object(one);
      const title = line(position.title);
      return title
        ? [
            {
              title,
              start: historyDate(position.start),
              end: historyDate(position.end),
              summary: line(position.summary, HISTORY_LIMITS.summary),
            },
          ]
        : [];
    });
    return company && positions.length > 0
      ? [{ company, location: line(job.location), positions }]
      : [];
  });
  const schools = list(file.schools, HISTORY_LIMITS.schools).flatMap((each): School[] => {
    const school = object(each);
    const name = line(school.school);
    return name
      ? [
          {
            school: name,
            degree: line(school.degree),
            field: line(school.field),
            start: historyDate(school.start),
            end: historyDate(school.end),
          },
        ]
      : [];
  });
  return { jobs, schools };
}

/** A position with its company, as a form asks for each job you held, one at a time. */
export interface HeldPosition extends Position {
  company: string;
  location: string;
}

/**
 * Every position you held, newest first, each with its company: three positions at one company
 * are three, as a form that asks for each job takes them.
 */
export function positionsOf(history: WorkHistory): HeldPosition[] {
  return history.jobs.flatMap((job) =>
    job.positions.map((position) => ({
      ...position,
      company: job.company,
      location: job.location,
    })),
  );
}

/** Whether a history has anything in it. */
export const hasHistory = (history: WorkHistory) =>
  history.jobs.length > 0 || history.schools.length > 0;

/** The months, as forms name them. */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A date's year, such as "2021", or "" when it has none, as "present" doesn't. */
export const yearOf = (date: string) => (/^\d{4}/.test(date) ? date.slice(0, 4) : '');

/**
 * A date's month, as a choice of months may name it: "March", "Mar", "03" and "3", or none when
 * the date has only a year.
 */
export function monthNames(date: string): string[] {
  const month = Number(/^\d{4}-(\d{2})$/.exec(date)?.[1] ?? 0);
  const name = MONTHS[month - 1];
  if (!name) return [];
  return [name, name.slice(0, 3), String(month).padStart(2, '0'), String(month)];
}

/** A date as a box to type it in takes it: "03/2021", or the year alone. */
export function typedDate(date: string): string {
  const [, year = '', month = ''] = /^(\d{4})(?:-(\d{2}))?$/.exec(date) ?? [];
  if (!year) return '';
  return month ? `${month}/${year}` : year;
}
