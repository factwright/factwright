import { KIND_ID } from '@factwright/core';
import { MAX_CHANGES } from './versions.ts';

/**
 * Update with Claude: the user says what to change in one part of Profile, in their own words, and
 * a run changes that part and nothing else. As with Request changes on a job's resume, the app
 * holds their words for the run, which reads them with requested_changes, so they never reach
 * Claude as if typed. The run's scope keeps it to the part's own tools, and its task's card lists
 * what it changed, with Undo.
 */

/** The skill that updates one part of Profile, by the part's name. */
export const PROFILE_SKILL = 'update-profile';

/**
 * The parts of Profile a run can update, each on its own: a card of Profile's, and what a card
 * shows that has a button of its own, one kind of job and why the user's leaving. About you and the
 * rest of For applications are a few details, quicker typed than asked for, and What you've shared
 * is the user's own files and words, so those stay with them.
 */
export const PROFILE_PARTS = [
  'wants',
  'kind',
  'leaving',
  'beyond',
  'history',
  'resumes',
  'templates',
  'facts',
] as const;

export type ProfilePart = (typeof PROFILE_PARTS)[number];

/** Each part, as its card names it. One kind of job goes by the kind's own name. */
export const PART_NAMES: Readonly<Record<ProfilePart, string>> = {
  wants: 'What you want',
  kind: 'A kind of job',
  leaving: 'Why you’re leaving',
  beyond: 'Beyond work',
  history: 'Work history and education',
  resumes: 'Starting resumes',
  templates: 'Resume templates',
  facts: 'Your fact bank',
};

/** A task's part as its tab names it: its card's name, or a kind of job by its id, in words. */
export function partTitle(part: ProfilePart, kind?: string): string {
  if (!kind) return PART_NAMES[part];
  const words = kind.replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * What the user sees above the box they type in, which is also the question a fact rests on when
 * their words back it: the app holds what they typed as their answer to it.
 */
export const CHANGES_QUESTION = 'What should your Claude change?';

/** The ID of a request for changes to a part of Profile, which the app makes as it holds one. */
export const PROFILE_REQUEST = /^[0-9a-f]{16}$/;

/** What the user asked to change in a part of Profile, from the window. */
export interface ProfileChanges {
  part: ProfilePart;
  /** The kind of job, by its id, for the part that's one kind. */
  kind?: string;
  changes: string;
}

/**
 * A request from the window, if it's in the shape the app takes: a part, the kind's id exactly when
 * the part is one kind of job, and the user's words, with something in them and no more than
 * MAX_CHANGES.
 */
export function parseProfileChanges(value: unknown): ProfileChanges | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { part, kind, changes, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (!(PROFILE_PARTS as readonly unknown[]).includes(part)) return null;
  if (part === 'kind' ? typeof kind !== 'string' || !KIND_ID.test(kind) : kind !== undefined) {
    return null;
  }
  if (typeof changes !== 'string' || changes.length > MAX_CHANGES || !changes.trim()) return null;
  return {
    part: part as ProfilePart,
    ...(part === 'kind' && { kind: kind as string }),
    changes: changes.trim(),
  };
}
