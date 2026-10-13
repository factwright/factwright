import type { AppUpdater, UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/updates.ts';

/** What the app uses of electron-updater's updater, so tests can stand in for it. */
export type Updater = Pick<AppUpdater, 'checkForUpdates' | 'quitAndInstall' | 'on'> & {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: AppUpdater['logger'];
};

/** How often an installed copy looks for an update. */
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** How long after starting it first looks, so looking never slows the start. */
export const FIRST_CHECK_AFTER_MS = 30 * 1000;

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
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(deps: UpdateWatcherDeps) {
    this.deps = deps;
  }

  start(): void {
    const { updater } = this.deps;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    // Its own log prints each problem in full; the one line logged below says enough.
    updater.logger = null;
    updater.on('update-available', (info) =>
      this.set({ state: 'downloading', version: info.version, percent: 0 }),
    );
    updater.on('download-progress', (progress) => {
      if (this.status.state !== 'downloading') return;
      this.set({ ...this.status, percent: Math.round(progress.percent) });
    });
    updater.on('update-downloaded', (info) =>
      this.set({ state: 'ready', version: info.version, notes: notesOf(info) }),
    );
    updater.on('error', (error) => {
      this.deps.log?.(`Update: ${error.message}`);
      // A download that failed is tried again at the next look.
      if (this.status.state === 'downloading') this.set({ state: 'none' });
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

  /** Restarts into the downloaded update. Answers whether there was one to install. */
  install(): boolean {
    if (this.status.state !== 'ready') return false;
    // Quietly on Windows, then the app opens again; the Mac does the same on its own.
    this.deps.updater.quitAndInstall(true, true);
    return true;
  }

  /** Looks for an update, unless one is downloading or waiting to be installed. */
  check(): void {
    if (this.status.state !== 'none') return;
    this.deps.updater.checkForUpdates().catch((error: unknown) => {
      this.deps.log?.(`Update: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    this.deps.onStatus(status);
  }
}
