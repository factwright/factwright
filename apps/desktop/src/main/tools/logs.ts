import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { WORKSPACE_PATHS } from '@factwright/core';

/**
 * The job hunt's logs, which the skills add a row to as they go: a fit check's verdict, a salary
 * check's estimate, and the employer an unmasked listing hides. Each one's columns, in its
 * table's order, and the ones a row must have.
 */
export const LOGS = {
  'fit-checks': {
    path: WORKSPACE_PATHS.fitChecks,
    columns: ['Date', 'Company', 'Role', 'Verdict', 'Score', 'Link', 'Pay', 'Note'],
    needs: ['company', 'role', 'verdict'],
  },
  'salary-checks': {
    path: WORKSPACE_PATHS.salaryChecks,
    columns: ['Date', 'Company', 'Role', 'Estimate', 'Confidence', 'Link'],
    needs: ['company', 'role', 'estimate'],
  },
  'unmask-checks': {
    path: WORKSPACE_PATHS.unmaskChecks,
    columns: ['Date', 'Listing', 'Employer', 'Role', 'Apply', 'Link'],
    needs: ['listing', 'employer', 'role'],
  },
} as const;

export type LogName = keyof typeof LOGS;

export const LOG_NAMES = Object.keys(LOGS) as LogName[];

/** Every column any log has, by the name a row gives it, in lowercase. */
export const LOG_COLUMNS = [
  ...new Set(
    Object.values(LOGS).flatMap((log) => log.columns.map((column) => column.toLowerCase())),
  ),
];

/** As long as one cell may be: a note is 60 characters, and a link can run long. */
const MAX_CELL = 500;

/** The table's first line and the one under it, as markdownTable finds a table. */
const RULE = /^\s*(?:\|\s*)?:?-{2,}/;

/** A cell's text on one line, with any "|" in it kept inside the cell. */
const cellText = (value: string) => value.replace(/\s+/g, ' ').trim().replaceAll('|', '\\|');

/** A table row's cells, as markdownTable reads them, by their headings in lowercase. */
function headingsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim().toLowerCase());
}

/**
 * A log's text with one more row, at the end of its table, in the columns its table has: a log
 * that isn't there, or has no table, gets the table first, with its heading.
 */
export function withRow(text: string | null, log: LogName, row: Record<string, string>): string {
  const { columns } = LOGS[log];
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  const table = [line(columns), `|${columns.map(() => '---').join('|')}|`];
  const rowOf = (headings: readonly string[]) =>
    line(headings.map((heading) => cellText(row[heading] ?? '')));
  const fresh = [...table, rowOf(columns.map((column) => column.toLowerCase()))];
  if (text === null || text.trim() === '') return `${fresh.join('\n')}\n`;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(
    (each, at) => each.trim().startsWith('|') && RULE.test(lines[at + 1] ?? ''),
  );
  if (start < 0) return `${text.trimEnd()}${newline}${newline}${fresh.join(newline)}${newline}`;
  let end = start + 2;
  while (end < lines.length && (lines[end] ?? '').trim().startsWith('|')) end += 1;
  lines.splice(end, 0, rowOf(headingsOf(lines[start] ?? '')));
  return lines.join(newline);
}

/**
 * The row Claude gave, checked for the log it's for: only that log's columns, as text on one line,
 * with the ones it needs, a date as YYYY-MM-DD, today's when it's left out, and a score from 0 to
 * 100. Throws, saying what's wrong, for anything else.
 */
export function logRow(log: LogName, given: unknown, today: string): Record<string, string> {
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    throw new Error('Give the row as an object of its columns.');
  }
  const columns = LOGS[log].columns.map((column) => column.toLowerCase());
  const row: Record<string, string> = {};
  for (const [name, value] of Object.entries(given)) {
    const column = name.toLowerCase();
    if (!columns.includes(column)) {
      throw new Error(`${log} has no ${name} column. Its columns are ${columns.join(', ')}.`);
    }
    if (value === null || value === undefined) continue;
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text !== 'string' || text.length > MAX_CELL) {
      throw new Error(`The ${column} should be text of ${MAX_CELL} characters or fewer.`);
    }
    row[column] = text.trim();
  }
  const date = row.date || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Give the date as YYYY-MM-DD.');
  row.date = date;
  const score = row.score;
  if (score && !(/^\d{1,3}$/.test(score) && Number(score) <= 100)) {
    throw new Error('Give the score as a whole number from 0 to 100, or leave it out.');
  }
  const missing = LOGS[log].needs.filter((column) => !row[column]);
  if (missing.length > 0) throw new Error(`Give the ${missing.join(', ')} for ${log}.`);
  return row;
}

/**
 * Adds a row to one of the job hunt's logs, written whole, in place of the file: never half
 * written, and one row at a time, as the app writes them all, so runs side by side never write
 * one log at once. `keep` hears the file first, so the task's card lists it, with Undo.
 */
export function addLogRow(
  workspace: string,
  log: LogName,
  row: Record<string, string>,
  keep?: (path: string) => void,
): string {
  const { path } = LOGS[log];
  const file = join(workspace, ...path.split('/'));
  let text: string | null = null;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  keep?.(file);
  mkdirSync(dirname(file), { recursive: true });
  const draft = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(draft, withRow(text, log, row));
    renameSync(draft, file);
  } finally {
    rmSync(draft, { force: true });
  }
  return `Added the row to ${path}.`;
}
