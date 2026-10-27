import type { AppUpdater, UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/updates.ts';

/** What the app uses of electron-updater's updater, so tests can stand in for it. */
export type Updater = Pick<
  AppUpdater,
  'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' | 'on'
> & {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: AppUpdater['logger'];
  requestHeaders: AppUpdater['requestHeaders'];
};

/** What the app hears from the Mac's own updater, which installs what electron-updater downloads. */
export interface MacInstaller {
  on(event: 'update-downloaded', listener: () => void): unknown;
}

/** How often an installed copy looks for an update, so a new version shows within minutes. */
export const CHECK_EVERY_MS = 10 * 60 * 1000;
/** How long after starting it first looks, so looking never slows the start. */
export const FIRST_CHECK_AFTER_MS = 30 * 1000;
/**
 * The least time between looks when the user comes back to the app or the computer wakes, so
 * switching between windows doesn't look each time.
 */
export const LOOK_AGAIN_AFTER_MS = 60 * 1000;

/**
 * electron-updater sends an ID of its own, kept on the computer, with each look for an update,
 * to roll a version out to some installs at a time. Factwright doesn't, so it sends this one,
 * the same for everyone, and the download site can't tell installs apart.
 */
export const NO_INSTALL_ID = '00000000-0000-0000-0000-000000000000';

/**
 * How electron-updater's error begins when a look for an update fails, as when the computer is
 * offline (its checkForUpdates). Its other errors come from a download, the Mac's check of one, or
 * installing it.
 */
export const LOOK_FAILED = 'Cannot check for updates';

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
  /**
   * Whether Claude has work going, which restarting would stop: Claude is working, or waits on
   * the user.
   */
  busy?: () => boolean;
  /** Quits Claude Code that's done before restarting, and settles once it has closed. */
  closeClaude?: () => Promise<void>;
  /** Tells the window where an update stands, each time that changes. */
  onStatus: (status: UpdateStatus) => void;
  /** Notes a problem looking for or downloading an update, which the user isn't shown. */
  log?: (message: string) => void;
}

/**
 * Keeps an installed copy of Factwright up to date: it looks for a new version every few minutes
 * and when the user comes back to it (from the download site, as the installers set it up),
 * downloads one in the background, and installs it when the user restarts, or the next time they
 * quit. It goes on looking while an update waits, so a newer one that comes out meanwhile takes
 * its place, and one restart brings the latest. A problem looking is kept quiet: the next look
 * tries again.
 */
export class UpdateWatcher {
  private readonly deps: UpdateWatcherDeps;
  private status: UpdateStatus = { state: 'none' };
  /** A download the Mac is still checking, before it can install it. */
  private downloaded: UpdateInfo | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private running = false;
  /** Set once it's restarting into the update, while Claude Code that's done closes first. */
  private installing = false;
  /** When it last looked, or started, as coming back to the app looks only if that was a while ago. */
  private lastLook = 0;

  constructor(deps: UpdateWatcherDeps) {
    this.deps = deps;
  }

  start(): void {
    const { updater, macInstaller } = this.deps;
    // It downloads what a look finds itself, and only a version that isn't already waiting: the
    // Mac would otherwise check the same download all over again at every look.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    // Its own log prints each problem in full; the one line logged below says enough.
    updater.logger = null;
    updater.requestHeaders = { ...updater.requestHeaders, 'x-user-staging-id': NO_INSTALL_ID };
    updater.on('download-progress', (progress) => {
      if (this.status.state !== 'downloading') return;
      const percent = Math.round(progress.percent);
      if (percent !== this.status.percent) this.set({ ...this.status, percent });
    });
    updater.on('update-downloaded', (info) => {
      if (macInstaller) this.downloaded = info;
      else this.ready(info);
    });
    macInstaller?.on('update-downloaded', () => {
      if (this.downloaded) this.ready(this.downloaded);
    });
    updater.on('error', (error, message) => {
      this.deps.log?.(`Update: ${error.message}`);
      // A look that fails changes nothing: the next look tries again, and an update that's waiting
      // stays ready, even while the app restarts into it.
      if (message?.startsWith(LOOK_FAILED)) return;
      // Whatever else failed, from the download to the Mac's check of it, or installing it, the
      // next look tries again.
      this.downloaded = null;
      this.installing = false;
      if (this.status.state !== 'none') this.set({ state: 'none' });
    });
    this.running = true;
    this.lastLook = Date.now();
    this.timers.push(setTimeout(() => void this.check(), FIRST_CHECK_AFTER_MS));
    this.timers.push(setInterval(() => void this.check(), CHECK_EVERY_MS));
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /**
   * Looks now, unless it did within the last minute: for when the user comes back to the app or
   * the computer wakes, so an update that came out meanwhile shows straight away.
   */
  lookAgain(): void {
    if (!this.running || Date.now() - this.lastLook < LOOK_AGAIN_AFTER_MS) return;
    void this.check();
  }

  current(): UpdateStatus {
    return this.status;
  }

  /**
   * Restarts into the downloaded update, once Claude Code that's done has closed. Answers whether
   * it did: not without an update ready, nor while Claude has work going, which restarting would
   * stop.
   */
  async install(): Promise<boolean> {
    if (this.status.state !== 'ready' || this.deps.busy?.()) return false;
    if (this.installing) return true;
    this.installing = true;
    await this.deps.closeClaude?.();
    // Quietly on Windows, then the app opens again; the Mac does the same on its own.
    this.deps.updater.quitAndInstall(true, true);
    return true;
  }

  /**
   * Looks for an update, unless one is downloading or installing, and downloads what it finds. A
   * newer version than the one waiting to be installed takes its place. Settles once it has looked.
   */
  async check(): Promise<void> {
    if (this.status.state === 'downloading' || this.installing) return;
    this.lastLook = Date.now();
    // A look that fails says so through the updater's error too, which notes it.
    const result = await this.deps.updater.checkForUpdates().catch(() => null);
    if (result?.isUpdateAvailable) this.download(result.updateInfo.version);
  }

  /**
   * Downloads the version a look found, unless it's on its way, already waiting, or the app is
   * restarting. A newer version's download replaces the update that's waiting as it starts, so if
   * it fails, the next look gets the newer one again.
   */
  private download(version: string): void {
    const before = this.status;
    if (this.installing || before.state === 'downloading') return;
    if (before.state === 'ready' && before.version === version) return;
    this.set({ state: 'downloading', version, percent: 0 });
    try {
      // A download that fails says so through the updater's error too, so this only keeps its
      // promise from going unanswered, which would show an error box.
      this.deps.updater.downloadUpdate().catch(() => {});
    } catch (error) {
      // A feed whose files it can't read throws before anything downloads, with no error of the
      // updater's, so what was there stays as it was.
      this.deps.log?.(`Update: ${error instanceof Error ? error.message : String(error)}`);
      this.set(before);
    }
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
