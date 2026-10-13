/**
 * Where an update to Factwright stands. An installed copy looks for one now and then, downloads
 * it in the background, and installs it when the app restarts or quits.
 */
export type UpdateStatus =
  /** Up to date, or not looked yet, or a copy that doesn't update itself, such as one in development. */
  | { state: 'none' }
  | { state: 'downloading'; version: string; percent: number }
  /** Downloaded, and installed once the app restarts or quits. */
  | { state: 'ready'; version: string; notes: string | null };
