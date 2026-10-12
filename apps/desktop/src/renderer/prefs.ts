import { useCallback, useState } from 'react';

/** Where the window keeps how the user likes to see things, such as the sections they closed. */
const PREFIX = 'factwright.';

/** A preference as last kept on this computer, or the fallback when there's none or it doesn't read. */
export function readPref<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const kept = localStorage.getItem(PREFIX + key);
    if (kept === null) return fallback;
    const value: unknown = JSON.parse(kept);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Keeps a preference for next time. Without storage, it lasts until the window closes. */
export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage can be full or off. The preference still holds until the window closes.
  }
}

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/**
 * A preference that's kept on this computer, such as whether a section of the job panel is
 * open. It's only how the window looks, so it doesn't sync.
 */
export function usePref<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState(() => readPref(key, fallback, valid));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      writePref(key, next);
    },
    [key],
  );
  return [value, set];
}
