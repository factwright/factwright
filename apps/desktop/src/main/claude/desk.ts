/** How many things can wait on the user at once, past which the oldest goes to the terminal. */
const MAX_WAITING = 10;

/** Something waiting on the user, with what settles it. */
interface Waiting<T, R> {
  item: T;
  settle: (reply: R | null) => void;
}

/**
 * What Claude Code is waiting on the user to answer in the app, oldest first, such as a round of
 * Claude's questions or a permission prompt, which the window shows one at a time. Each waits until
 * the user answers it, sends it to the terminal, or Claude Code stops waiting, as when the user
 * interrupts the run or answers in the terminal, the hook's time runs out, or the run ends.
 */
export class Desk<T extends { id: string }, R> {
  private readonly waiting: Waiting<T, R>[] = [];
  private readonly show: (item: T | null) => void;

  /** `show` hears what the window should show, or null once nothing is waiting. */
  constructor(show: (item: T | null) => void) {
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
          const shown = this.current();
          const at = this.waiting.indexOf(entry);
          if (at >= 0) this.waiting.splice(at, 1);
          resolve(reply);
          if (this.current() !== shown) this.show(this.current());
        },
      };
      const stopped = () => entry.settle(null);
      signal.addEventListener('abort', stopped, { once: true });
      // The same call asked again replaces the one before, whose hook has gone.
      this.waiting.find((each) => each.item.id === item.id)?.settle(null);
      this.waiting.push(entry);
      while (this.waiting.length > MAX_WAITING) this.waiting[0]?.settle(null);
      if (this.current() === item) this.show(item);
    });
  }

  /** What the window shows: the oldest thing waiting, or null. */
  current(): T | null {
    return this.waiting[0]?.item ?? null;
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
