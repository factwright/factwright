/**
 * Where saving from a browser to Factwright on this computer stands, as the Browser extension
 * window shows it. Each browser reaches Factwright through the helper the app registers with it
 * (main/extension/register.ts).
 */

/**
 * Where one browser stands:
 * - ready: it can reach Factwright on this computer.
 * - not-set-up: not yet. On a Mac, the user sets each browser up in the window, as macOS asks
 *   them first.
 * - blocked: macOS didn't let Factwright set it up, until the user allows it in System Settings.
 */
export type HelperState = 'ready' | 'not-set-up' | 'blocked';

export interface HelperBrowserView {
  /** The browser, by the name the app knows it by, such as "chrome". */
  id: string;
  /** Its name, as the app shows it, such as "Google Chrome". */
  name: string;
  state: HelperState;
  /**
   * On a Mac, the apps whose folders it reads, as Files & Folders names them, where the user lets
   * Factwright reach them: Brave's include Google Chrome's. None on Windows.
   */
  allow: string[];
}

/**
 * Why this copy of Factwright can't set up the browsers:
 * - other-system: it's not a Mac or Windows.
 * - development: a copy run from the code, or one another program drives, as the tests do, leaves
 *   the browsers as they are.
 * - translocated: macOS runs it from a temporary copy until it's moved to Applications.
 * - disk-image: it runs from a disk image or another disk, which goes away once it's ejected.
 * - no-helper: the helper isn't where the app expects it.
 */
export type HelperUnavailable =
  | 'other-system'
  | 'development'
  | 'translocated'
  | 'disk-image'
  | 'no-helper';

export interface SaveHelperView {
  /** Why the browsers can't be set up here, or null when they can. */
  unavailable: HelperUnavailable | null;
  /**
   * Whether each browser is set up when the user asks, as on a Mac, where macOS asks them first,
   * rather than on its own as the app starts, as on Windows.
   */
  onRequest: boolean;
  /** The browsers on this computer that the extension runs in. */
  browsers: HelperBrowserView[];
}

/** What setting up browsers did: where they all stand now, and any that didn't work, and why. */
export interface SetUpResult {
  view: SaveHelperView;
  problems: {
    id: string;
    name: string;
    /** Whether macOS refused, which the user can allow in System Settings. */
    blocked: boolean;
    message: string;
  }[];
}
