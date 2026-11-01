import type { ProfileChanges, ProfilePart } from '../../shared/profile-parts.ts';

/** A request for changes to a part of Profile, held for the run that makes them. */
export interface BoundProfileChanges extends ProfileChanges {
  /** When it was asked, as an ISO time. */
  at: string;
}

const keyOf = (part: ProfilePart, kind: string | undefined) => `${part}/${kind ?? ''}`;

/**
 * What the user asked to change in each part of Profile, waiting for its run, one each: their
 * words, which only that run gets, and which never reach Claude as if typed. They're lost with a
 * restart, as the run in line for them is.
 */
export class ProfileRequests {
  private readonly held = new Map<string, BoundProfileChanges>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  /** Holds what the user asked, for the run the window starts next, which claims it. */
  hold(request: ProfileChanges): void {
    this.held.set(keyOf(request.part, request.kind), {
      ...request,
      at: this.now().toISOString(),
    });
  }

  /** The changes held for a run the window starts, which only that run gets. Null for none. */
  claim(part: ProfilePart, kind: string | undefined): BoundProfileChanges | null {
    const key = keyOf(part, kind);
    const held = this.held.get(key) ?? null;
    this.held.delete(key);
    return held;
  }

  /** Holds changes again when their run didn't start, so starting it again finds them. */
  release(changes: BoundProfileChanges): void {
    const key = keyOf(changes.part, changes.kind);
    if (!this.held.has(key)) this.held.set(key, changes);
  }
}
