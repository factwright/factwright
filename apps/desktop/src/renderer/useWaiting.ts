import { useCallback, useEffect, useState } from 'react';

export interface Waiting<T> {
  /** What Claude Code is waiting on the user to answer in the app, or null. */
  item: T | null;
  /** Whether its dialog is open. The user can put it aside and open it again from Claude's panel. */
  open: boolean;
  show: () => void;
  hide: () => void;
}

/**
 * Follows what Claude Code waits on the user to answer in the app, such as a round of Claude's
 * questions or a permission prompt, opening each new one.
 */
export function useWaiting<T extends { id: string }>(
  current: () => Promise<T | null>,
  subscribe: (listener: (item: T | null) => void) => () => void,
): Waiting<T> {
  const [item, setItem] = useState<T | null>(null);
  // What the user put aside, which stays closed until they open it again.
  const [aside, setAside] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let heard = false;
    const stop = subscribe((next) => {
      heard = true;
      if (live) setItem(next);
    });
    // What was waiting before the window listened, such as after it reloaded. Anything heard
    // since is newer.
    current().then(
      (waiting) => {
        if (live && !heard) setItem(waiting);
      },
      () => {},
    );
    return () => {
      live = false;
      stop();
    };
  }, [current, subscribe]);
  const id = item?.id ?? null;
  return {
    item,
    open: id !== null && id !== aside,
    show: useCallback(() => setAside(null), []),
    hide: useCallback(() => setAside(id), [id]),
  };
}
