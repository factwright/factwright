import { join, normalize, resolve, sep } from 'node:path';
import type { TerminalSize } from '../shared/api.ts';
import { RUN_SKILLS, type RunSkill, type RunTask, SEARCH_SKILL } from '../shared/runs.ts';

/** A panel size from the window, if it's whole numbers in a sensible range. */
export function parseTerminalSize(value: unknown): TerminalSize | null {
  if (typeof value !== 'object' || value === null) return null;
  const { cols, rows } = value as Record<string, unknown>;
  const fits = (n: unknown, max: number) =>
    Number.isInteger(n) && (n as number) >= 2 && (n as number) <= max;
  return fits(cols, 1000) && fits(rows, 500)
    ? { cols: cols as number, rows: rows as number }
    : null;
}

/**
 * What the window may load: only the app's own scripts, styles and images, and no outside
 * connections. During development the screens come from Vite's dev server, which is allowed too.
 */
export function contentSecurityPolicy(devUrl?: string): string {
  const dev = devUrl ? new URL(devUrl).origin : undefined;
  const sources = (base: string) => (dev ? `${base} ${dev}` : base);
  return [
    "default-src 'self'",
    `script-src ${sources("'self'")}`,
    // React and the theme set styles inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${sources("'self'")}${dev ? ` ${dev.replace(/^http/, 'ws')}` : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Only https and email links leave the app, opening in the user's own browser or mail app. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    // Email links open the user's mail app with a draft, which they still send themselves.
    return protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * A name the window may suggest for a file it saves, such as "job-search-journey.csv": letters,
 * digits, spaces and ".-_()", ending in .csv or .txt, with no folders. Anything else is null.
 */
export function saveableFileName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length > 100) return null;
  return /^[\w][\w .()-]*\.(csv|txt)$/i.test(name) ? name : null;
}

/**
 * A resume the window may open in the user's own app for it: a PDF or Word file inside the
 * workspace. Anything else, or a path that leads outside, is null.
 */
export function openableFile(workspace: string, path: string): string | null {
  if (!/\.(pdf|docx)$/i.test(path)) return null;
  const base = resolve(workspace);
  const file = resolve(base, path);
  return file.startsWith(base + sep) ? file : null;
}

/** The file a URL path names inside `root`, or null if it would reach outside it. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const base = normalize(root);
  const file = normalize(join(base, decoded === '/' ? 'index.html' : decoded));
  return file.startsWith(base + sep) ? file : null;
}

/** A job's ID, as the app makes them: "acme-robotics--staff-engineer", maybe with "-2". */
const JOB_ID = /^[a-z0-9][a-z0-9-]{0,199}$/;

/** A skill to run on a job, or a job search, in the shape the app takes, or null for anything else. */
export function parseRunTask(value: unknown): RunTask | null {
  if (typeof value !== 'object' || value === null) return null;
  const { skill, jobId } = value as Record<string, unknown>;
  if (skill === SEARCH_SKILL) return jobId === undefined ? { skill: SEARCH_SKILL } : null;
  if (typeof skill !== 'string' || !(RUN_SKILLS as readonly string[]).includes(skill)) return null;
  if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) return null;
  return { skill: skill as RunSkill, jobId };
}

/**
 * What the app types to start a skill on a job, or a job search. It names a job only by its ID,
 * so text from a posting, such as a company's name, never reaches Claude as if the user had
 * typed it. A search starts without a source, so Claude asks the user for one.
 */
export function runPrompt(task: RunTask): string {
  return 'jobId' in task
    ? `/factwright:${task.skill} job ${task.jobId}`
    : `/factwright:${task.skill}`;
}
