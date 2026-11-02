import { randomBytes } from 'node:crypto';
import type { ProfileChanges, ProfilePart } from '../../shared/profile-parts.ts';

/** A request for changes to a part of Profile, held for the run that makes them. */
export interface BoundProfileChanges extends ProfileChanges {
  /** When it was asked, as an ISO time. */
  at: string;
}

/** How many requests are held, the newest, as a run's Try again can ask for one later. */
const MOST_HELD = 20;

/**
 * What the user asked to change in each part of Profile, by a request's ID, which its run's task
 * carries: their words, which only that run gets, and which never reach Claude as if typed. Starting
 * the task again, as Try again does, finds the same words. They're lost with a restart, as the run
 * in line for them is.
 */
export class ProfileRequests {
  private readonly held = new Map<string, BoundProfileChanges>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  /** Holds what the user asked, and answers with the ID its run's task names it by. */
  hold(request: ProfileChanges): string {
    const id = randomBytes(8).toString('hex');
    this.held.set(id, { ...request, at: this.now().toISOString() });
    for (const old of this.held.keys()) {
      if (this.held.size <= MOST_HELD) break;
      this.held.delete(old);
    }
    return id;
  }

  /** What's held for a run on a part, by its request's ID, or null when it's not for that part. */
  find(id: string, part: ProfilePart, kind: string | undefined): BoundProfileChanges | null {
    const held = this.held.get(id);
    return held && held.part === part && held.kind === kind ? held : null;
  }
}
