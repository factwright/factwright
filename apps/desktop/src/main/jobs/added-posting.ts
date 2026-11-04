import type { Posting } from '@factwright/core';
import type { PostingRead } from '../../shared/api.ts';
import { type FetchDeps, ReadCache, readForAdding } from '../tools/posting.ts';

/** Why Add job reads no link it's given that isn't one. */
export const NOT_A_LINK: PostingRead = {
  ok: false,
  why: 'refused',
  message: 'That isn’t a link: links start with https://.',
};

/**
 * What Add job read from the links the user gave it, kept in memory by link for the job each is
 * added with, so adding the job reads nothing again: its posting goes with the job.
 */
export class AddedPostings {
  private readonly deps: FetchDeps;
  private readonly cache = new ReadCache();

  constructor(deps: FetchDeps = {}) {
    this.deps = deps;
  }

  private now(): number {
    return (this.deps.now?.() ?? new Date()).getTime();
  }

  /** Reads a job's link as Add job shows it, and keeps the posting it read for the job. */
  async read(link: string): Promise<PostingRead> {
    const read = await readForAdding(link, this.deps);
    if (!read.ok) return read;
    const { posting } = read;
    this.cache.remember(read.url, posting, this.now());
    return {
      ok: true,
      via: posting.via,
      characters: posting.text.length,
      title: posting.title ?? null,
      company: posting.company ?? null,
    };
  }

  /** The posting read from a link in the last two hours, for the job it's added with, or null. */
  readFor(link: string): Posting | null {
    if (!URL.canParse(link.trim())) return null;
    return this.cache.recall(new URL(link.trim()).href, this.now());
  }
}
