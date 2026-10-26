import { ext } from './ext.ts';

/**
 * What the extension keeps of what it did on a tab, by key: a fill, a note on the page, or an
 * application you're sending. It's kept in the browser's memory while it runs, never on the disk
 * (`storage.session`), as the background that did it may be stopped and started again meanwhile.
 * What holds anything read from your job hunt through sync stays in the background's own memory
 * alone, and goes with it: nothing read through sync is stored. A browser that keeps nothing for
 * a session has each in that memory.
 */
export interface KeptState<T> {
  /** What's kept now, after the changes before. */
  all(): Promise<Record<string, T>>;
  /** Changes what's kept, after the changes before it, and says what `apply` said. */
  change<R>(apply: (all: Record<string, T>) => R): Promise<R>;
}

/**
 * Keeps things of one kind, under `name`: at most `most` of them, the newest by `at`, with those
 * `synced` says came through sync in memory alone.
 */
export function keptState<T>(
  name: string,
  synced: (each: T) => boolean,
  most: number,
  at: (each: T) => number,
): KeptState<T> {
  const memory = new Map<string, T>();
  let queue: Promise<unknown> = Promise.resolve();

  async function stored(): Promise<Record<string, T>> {
    const session = ext.storage.session;
    if (!session) return {};
    const { [name]: kept } = await session.get(name).catch(() => ({}) as Record<string, unknown>);
    return kept && typeof kept === 'object' ? (kept as Record<string, T>) : {};
  }

  const both = async () => ({ ...(await stored()), ...Object.fromEntries(memory) });

  return {
    async all() {
      await queue;
      return both();
    },
    change(apply) {
      const next = queue.then(async () => {
        const session = ext.storage.session;
        const all = await both();
        const said = apply(all);
        const newest = Object.entries(all)
          .sort(([, a], [, b]) => at(b) - at(a))
          .slice(0, most);
        const kept: Record<string, T> = {};
        memory.clear();
        for (const [key, each] of newest) {
          if (!session || synced(each)) memory.set(key, each);
          else kept[key] = each;
        }
        if (session) await session.set({ [name]: kept });
        return said;
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}
