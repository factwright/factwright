import type { AskedJob, SavedHow } from '@factwright/core';
import { askComputer } from './computer.ts';

/**
 * Whether the job on the page you're on is in your job hunt already, as the popup looks before it
 * offers to save it: by @factwright/core's savedJobFor, the same posting, the same role that saving
 * the page would add to, or the one job Fill takes for the page, as Factwright on this computer
 * finds it, or as sync holds your job hunt, whichever the extension saves to. Factwright is told
 * only the page's address, the company and the job's title, and sync is only read
 * (savedThroughSync, in save.ts).
 */

/** A page, as it's looked up: its address, and the company and job title it shows. */
export interface PageAsked {
  url: string;
  company: string;
  role: string;
}

/** The job on file a page is for, and how. */
export interface SavedFor {
  job: AskedJob;
  how: SavedHow;
}

const HOWS: readonly SavedHow[] = ['same', 'joins', 'role'];

/** What Factwright answered, as the job it names, or null when it isn't one. */
export function readSavedFor(value: unknown): SavedFor | null {
  if (typeof value !== 'object' || value === null) return null;
  const { job, how } = value as { job?: unknown; how?: unknown };
  if (typeof job !== 'object' || job === null || !HOWS.includes(how as SavedHow)) return null;
  const { id, company, role, status, appliedOn } = job as Record<string, unknown>;
  const text = (each: unknown) => typeof each === 'string';
  if (![id, company, role, status].every(text) || !(appliedOn === null || text(appliedOn))) {
    return null;
  }
  return {
    job: {
      id: id as string,
      company: (company as string).slice(0, 200),
      role: (role as string).slice(0, 300),
      status: status as string,
      appliedOn: appliedOn as string | null,
    },
    how: how as SavedHow,
  };
}

/**
 * The job a page is for, as Factwright on this computer finds it, or null when it didn't answer:
 * it's closed or busy, the browser doesn't let the extension reach it, or it's from before it knew
 * how to look, as it then doesn't know the ask.
 */
export async function savedOnComputer(page: PageAsked): Promise<{ found: SavedFor | null } | null> {
  const answer = await askComputer({ ask: 'job', ...page });
  return answer.ok && answer.did === 'job' ? { found: readSavedFor(answer.found) } : null;
}
