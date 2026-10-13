import type { AppUpdater, UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/updates.ts';

/** What the app uses of electron-updater's updater, so tests can stand in for it. */
export type Updater = Pick<AppUpdater, 'checkForUpdates' | 'quitAndInstall' | 'on'> & {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: AppUpdater['logger'];
  requestHeaders: AppUpdater['requestHeaders'];
};

/** What the app hears from the Mac's own updater, which installs what electron-updater downloads. */
export interface MacInstaller {
  on(event: 'update-downloaded', listener: () => void): unknown;
}

/** How often an installed copy looks for an update. */
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** How long after starting it first looks, so looking never slows the start. */
export const FIRST_CHECK_AFTER_MS = 30 * 1000;

/**
 * electron-updater sends an ID of its own, kept on the computer, with each look for an update,
 * to roll a version out to some installs at a time. Factwright doesn't, so it sends this one,
 * the same for everyone, and the download site can't tell installs apart.
 */
export const NO_INSTALL_ID = '00000000-0000-0000-0000-000000000000';

/** An update's notes as text: electron-updater gives a string, or a note for each version. */
function notesOf(info: UpdateInfo): string | null {
  const notes = info.releaseNotes;
  if (!notes) return null;
  const text =
    typeof notes === 'string'
      ? notes
      : notes
          .map((each) => each.note ?? '')
          .filter(Boolean)
          .join('\n\n');
  return text.trim() || null;
}

export interface UpdateWatcherDeps {
  updater: Updater;
  /**
   * On a Mac, the system's own updater, which says when the update it was handed is ready to
   * install. electron-updater says so earlier, once it has the file, before the Mac has checked it.
   */
  macInstaller?: MacInstaller | null;
  /** Whether Claude is working, which restarting would stop. */
  busy?: () => boolean;
  /** Tells the window where an update stands, each time that changes. */
  onStatus: (status: UpdateStatus) => void;
  /** Notes a problem looking for or downloading an update, which the user isn't shown. */
  log?: (message: string) => void;
}

/**
 * Keeps an installed copy of Factwright up to date: it looks for a new version now and then
 * (from the download site, as the installers set it up), downloads one in the background, and
 * installs it when the user restarts, or the next time they quit. A problem looking is kept
 * quiet: the next look tries again.
 */
export class UpdateWatcher {
  private readonly deps: UpdateWatcherDeps;
  private status: UpdateStatus = { state: 'none' };
  /** A download the Mac is still checking, before it can install it. */
  private downloaded: UpdateInfo | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(deps: UpdateWatcherDeps) {
    this.deps = deps;
  }

  start(): void {
    const { updater, macInstaller } = this.deps;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    // Its own log prints each problem in full; the one line logged below says enough.
    updater.logger = null;
    updater.requestHeaders = { ...updater.requestHeaders, 'x-user-staging-id': NO_INSTALL_ID };
    updater.on('update-available', (info) =>
      this.set({ state: 'downloading', version: info.version, percent: 0 }),
    );
    updater.on('download-progress', (progress) => {
      if (this.status.state !== 'downloading') return;
      this.set({ ...this.status, percent: Math.round(progress.percent) });
    });
    updater.on('update-downloaded', (info) => {
      if (macInstaller) this.downloaded = info;
      else this.ready(info);
    });
    macInstaller?.on('update-downloaded', () => {
      if (this.downloaded) this.ready(this.downloaded);
    });
    updater.on('error', (error) => {
      this.deps.log?.(`Update: ${error.message}`);
      // Whatever failed, from the download to the Mac's check of it, the next look tries again.
      this.downloaded = null;
      if (this.status.state !== 'none') this.set({ state: 'none' });
    });
    this.timers.push(setTimeout(() => this.check(), FIRST_CHECK_AFTER_MS));
    this.timers.push(setInterval(() => this.check(), CHECK_EVERY_MS));
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  current(): UpdateStatus {
    return this.status;
  }

  /**
   * Restarts into the downloaded update. Answers whether it did: not without an update ready,
   * nor while Claude is working, which restarting would stop.
   */
  install(): boolean {
    if (this.status.state !== 'ready' || this.deps.busy?.()) return false;
    // Quietly on Windows, then the app opens again; the Mac does the same on its own.
    this.deps.updater.quitAndInstall(true, true);
    return true;
  }

  /** Looks for an update, unless one is downloading or waiting to be installed. */
  check(): void {
    if (this.status.state !== 'none') return;
    const failed = (error: unknown) =>
      this.deps.log?.(`Update: ${error instanceof Error ? error.message : String(error)}`);
    this.deps.updater.checkForUpdates().then(
      // A download that fails says so through the updater's error too, so this only keeps its
      // promise from going unanswered, which would show an error box.
      (result) => result?.downloadPromise?.catch(() => {}),
      failed,
    );
  }

  private ready(info: UpdateInfo): void {
    this.downloaded = null;
    this.set({ state: 'ready', version: info.version, notes: notesOf(info) });
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    this.deps.onStatus(status);
  }
}
