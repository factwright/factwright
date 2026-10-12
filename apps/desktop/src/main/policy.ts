import { join, normalize, resolve, sep } from 'node:path';
import { ASK_ID } from '@factwright/core';
import type { TerminalSize } from '../shared/api.ts';
import {
  FACTS_SKILL,
  GET_STARTED_SKILL,
  RUN_SKILLS,
  type RunSkill,
  type RunTask,
  SEARCH_SKILL,
  TEMPLATE_SKILL,
  TEMPLATE_SOURCE,
} from '../shared/runs.ts';
import { SOURCES_FOLDER } from './resume/templates.ts';

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

/** The most a PDF may weigh for the window to preview it. Resumes are far smaller. */
export const MAX_PREVIEW_BYTES = 20_000_000;

/** A PDF inside the workspace that the window may preview, or null for any other path. */
export function previewablePdf(workspace: string, path: string): string | null {
  return /\.pdf$/i.test(path) ? openableFile(workspace, path) : null;
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

/**
 * A task from the window, in the shape the app takes: a skill on a job, a job search, getting
 * started, more facts, or a template from a resume the app kept. Anything else is null.
 */
export function parseRunTask(value: unknown): RunTask | null {
  if (typeof value !== 'object' || value === null) return null;
  const { skill, jobId, mode, askId, source, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (skill === TEMPLATE_SKILL || source !== undefined) {
    const valid =
      skill === TEMPLATE_SKILL &&
      jobId === undefined &&
      mode === undefined &&
      askId === undefined &&
      typeof source === 'string' &&
      TEMPLATE_SOURCE.test(source);
    return valid ? { skill, source } : null;
  }
  if (askId !== undefined) {
    const valid =
      skill === 'ask' &&
      mode === undefined &&
      typeof jobId === 'string' &&
      JOB_ID.test(jobId) &&
      typeof askId === 'string' &&
      ASK_ID.test(askId);
    return valid ? { skill, jobId, askId } : null;
  }
  if (skill === SEARCH_SKILL) return jobId === undefined && mode === undefined ? { skill } : null;
  if (skill === GET_STARTED_SKILL && jobId === undefined) {
    if (mode === undefined) return { skill };
    return mode === 'resumes' ? { skill, mode } : null;
  }
  if (skill === FACTS_SKILL && jobId === undefined) {
    return mode === 'interview' || mode === 'new' ? { skill, mode } : null;
  }
  if (typeof skill !== 'string' || !(RUN_SKILLS as readonly string[]).includes(skill)) return null;
  if (mode !== undefined || typeof jobId !== 'string' || !JOB_ID.test(jobId)) return null;
  return { skill: skill as RunSkill, jobId };
}

/** What the app types after a skill's name for each of its modes, word for word. */
const MODE_WORDS = {
  resumes: 'starting resumes',
  interview: 'interview me',
  new: 'read the new files and notes',
} as const;

/**
 * What the app types to start a task. It names a job only by its ID, and everything else it
 * types is its own fixed words, so text from a posting or a file, such as a company's name,
 * never reaches Claude as if the user had typed it. A search starts without a source, so Claude
 * asks the user for one.
 */
export function runPrompt(task: RunTask): string {
  if ('source' in task) return `/factwright:${task.skill} from ${SOURCES_FOLDER}/${task.source}`;
  if ('askId' in task) return `/factwright:ask job ${task.jobId} question ${task.askId}`;
  if ('jobId' in task) return `/factwright:${task.skill} job ${task.jobId}`;
  const mode = 'mode' in task ? task.mode : undefined;
  return mode ? `/factwright:${task.skill} ${MODE_WORDS[mode]}` : `/factwright:${task.skill}`;
}
