import type { FromRun } from '../../shared/api.ts';

/** How many things can wait on the user at once, past which the oldest goes to the terminal. */
const MAX_WAITING = 10;

/** How many things have come in to wait on the user, from every run, of every kind. */
let order = 0;

/**
 * Something one of Claude's runs waits on the user for, such as a round of questions, marked with
 * the run and its place in the order they all came in, to take them in turn. Its ID is the run's
 * own, so two runs' never meet.
 */
export function fromRun<T extends { id: string }>(runId: string, item: T): T & FromRun {
  order += 1;
  return { ...item, id: `${runId}/${item.id}`, runId, since: order };
}

/** Something waiting on the user, with what settles it. */
interface Waiting<T, R> {
  item: T;
  settle: (reply: R | null) => void;
}

/**
 * What Claude Code is waiting on the user to answer in the app, oldest first, from every run,
 * such as rounds of Claude's questions or permission prompts, which the window takes in turn.
 * Each waits until the user answers it, sends it to the terminal, or Claude Code stops waiting,
 * as when the user interrupts the run or answers in the terminal, the hook's time runs out, or the
 * run ends.
 */
export class Desk<T extends { id: string; runId?: string }, R> {
  private readonly waiting: Waiting<T, R>[] = [];
  private readonly show: (items: T[]) => void;

  /** `show` hears everything waiting, oldest first, each time that changes. */
  constructor(show: (items: T[]) => void) {
    this.show = show;
  }

  /**
   * Waits for the user's answer, or null to have Claude Code ask in the terminal, which is also
   * what an aborted wait settles with.
   */
  ask(item: T, signal: AbortSignal): Promise<R | null> {
    if (signal.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const entry: Waiting<T, R> = {
        item,
        settle: (reply) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', stopped);
          const at = this.waiting.indexOf(entry);
          if (at >= 0) this.waiting.splice(at, 1);
          resolve(reply);
          if (at >= 0) this.show(this.items());
        },
      };
      const stopped = () => entry.settle(null);
      signal.addEventListener('abort', stopped, { once: true });
      // The same call asked again replaces the one before, whose hook has gone.
      this.waiting.find((each) => each.item.id === item.id)?.settle(null);
      this.waiting.push(entry);
      while (this.waiting.length > MAX_WAITING) this.waiting[0]?.settle(null);
      this.show(this.items());
    });
  }

  /** Everything waiting, oldest first. */
  items(): T[] {
    return this.waiting.map((each) => each.item);
  }

  /** The oldest thing waiting, or null. */
  current(): T | null {
    return this.waiting[0]?.item ?? null;
  }

  /** Whether anything from one run is waiting. */
  waitsFor(runId: string): boolean {
    return this.waiting.some((each) => each.item.runId === runId);
  }

  /** Something that's waiting, by its ID, or null. */
  find(id: string): T | null {
    return this.waiting.find((each) => each.item.id === id)?.item ?? null;
  }

  /**
   * Settles something waiting with the user's answer, or null to send it to the terminal. False
   * when it isn't waiting anymore.
   */
  answer(id: string, reply: R | null): boolean {
    const entry = this.waiting.find((each) => each.item.id === id);
    entry?.settle(reply);
    return entry !== undefined;
  }
}
