import type { JobFile } from '@factwright/core';

/**
 * Versions of what a job's folder holds for the user to send: its resume, its cover letter and
 * its Projects page. The newest is the one in the job's folder, under its own name. Each earlier
 * one is kept in a folder of its own under previous/, with the data it was built from, until the
 * user uses it again or moves it to the Trash.
 */

/** The kinds of document a job keeps versions of. */
export const DOC_KINDS = ['resume', 'letter', 'projects'] as const;

export type DocKind = (typeof DOC_KINDS)[number];

/** The kinds the user can ask for changes to, in their own words. */
export const CHANGE_KINDS = ['resume', 'letter'] as const satisfies readonly DocKind[];

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * Why a version was put aside: a new one was made, the user asked for changes, its ATS X-ray sent
 * it for revision, or the user went back to another.
 */
export const VERSION_WHYS = ['new', 'changes', 'revision', 'swapped'] as const;

export type VersionWhy = (typeof VERSION_WHYS)[number];

/** An earlier version of a job's resume, cover letter or Projects page, kept in its folder. */
export interface DocVersion {
  /** Its folder in the workspace, such as applications/2026-10-07-acme/previous/2026-10-15-093012. */
  folder: string;
  kind: DocKind;
  /** When it was put aside, as an ISO time. */
  at: string;
  why: VersionWhy;
  /**
   * What the user asked to change, for one put aside by Request changes: the version after it is
   * the one with the changes.
   */
  changes: string | null;
  /** Its PDF and Word file, as they were. */
  files: JobFile[];
  /** Whether it has the data it was built from, so it can be the job's again. */
  usable: boolean;
}

/** The most a request for changes holds. */
export const MAX_CHANGES = 2000;

/** What the user asked to change in a job's resume or cover letter, from the window. */
export interface ChangesRequest {
  jobId: string;
  kind: ChangeKind;
  changes: string;
}

/**
 * A request for changes from the window, if it's in the shape the app takes: a job's ID, a kind
 * that takes changes, and the user's words, with something in them and no more than MAX_CHANGES.
 * The words reach the run that makes the changes through a tool, never typed into it.
 */
export function parseChangesRequest(value: unknown, jobIdPattern: RegExp): ChangesRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { jobId, kind, changes, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof jobId !== 'string' || !jobIdPattern.test(jobId)) return null;
  if (!(CHANGE_KINDS as readonly unknown[]).includes(kind)) return null;
  if (typeof changes !== 'string' || changes.length > MAX_CHANGES || !changes.trim()) return null;
  return { jobId, kind: kind as ChangeKind, changes: changes.trim() };
}
