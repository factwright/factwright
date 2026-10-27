import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../shared/updates.ts';
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_AFTER_MS,
  LOOK_FAILED,
  NO_INSTALL_ID,
  type Updater,
  UpdateWatcher,
} from './updates.ts';

/** What a look finds: the version the download site has, newer than the app's, or nothing new. */
type Found = { isUpdateAvailable: boolean; updateInfo: { version: string } } | null;

/** A stand-in for electron-updater: it looks when asked, and tells what happened by events. */
class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  logger: unknown = console;
  requestHeaders: Record<string, string> | null = { 'user-agent': 'Factwright' };
  checkForUpdates = vi.fn(async (): Promise<Found> => null);
  downloadUpdate = vi.fn(async (): Promise<string[]> => []);
  quitAndInstall = vi.fn();
}

/** The next look finds this version on the download site. */
function nextLookFinds(version: string) {
  updater.checkForUpdates.mockImplementationOnce(async () => ({
    isUpdateAvailable: true,
    updateInfo: { version },
  }));
}

/** The next look fails, which electron-updater says both ways: by its error, and its answer. */
function nextLookFails(problem: string) {
  updater.checkForUpdates.mockImplementationOnce(async () => {
    const error = new Error(problem);
    updater.emit('error', error, `${LOOK_FAILED}: ${error.stack}`);
    throw error;
  });
}

let updater: FakeUpdater;
let statuses: UpdateStatus[];
let logged: string[];
let watcher: UpdateWatcher;

beforeEach(() => {
  vi.useFakeTimers();
  updater = new FakeUpdater();
  statuses = [];
  logged = [];
  watcher = new UpdateWatcher({
    updater: updater as unknown as Updater,
    onStatus: (status) => statuses.push(status),
    log: (message) => logged.push(message),
  });
  watcher.start();
});

afterEach(() => {
  watcher.stop();
  vi.useRealTimers();
});

describe('UpdateWatcher', () => {
  it('downloads what it finds itself, and installs on quitting, quietly', () => {
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.logger).toBeNull();
  });

  it('sends no ID of this install when it looks', () => {
    expect(updater.requestHeaders).toEqual({
      'user-agent': 'Factwright',
      'x-user-staging-id': NO_INSTALL_ID,
    });
  });

  it('keeps a download that fails from going unanswered, which would show an error box', async () => {
    vi.useRealTimers();
    const unanswered = vi.fn();
    process.on('unhandledRejection', unanswered);
    try {
      nextLookFinds('0.2.0');
      updater.downloadUpdate.mockRejectedValueOnce(new Error('connection reset'));
      await watcher.check();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(updater.downloadUpdate).toHaveBeenCalled();
      expect(unanswered).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unanswered);
    }
  });
  it('looks a little after starting, then every few minutes', () => {
    expect(CHECK_EVERY_MS).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FIRST_CHECK_AFTER_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('looks when the user comes back only once a look is due, as after the computer slept', () => {
    // Just started: the first look, a little later, is still to come.
    watcher.lookAgain();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FIRST_CHECK_AFTER_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    // Switching back to the app between looks doesn't look again, so each copy counts once.
    vi.advanceTimersByTime(CHECK_EVERY_MS / 2);
    watcher.lookAgain();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    // The computer slept for an hour, with its timers stopped, and wakes.
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    watcher.lookAgain();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    // The regular looks go on 10 minutes from there, not sooner.
    vi.advanceTimersByTime(CHECK_EVERY_MS - 1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it('doesn’t look again once stopped', () => {
    vi.advanceTimersByTime(FIRST_CHECK_AFTER_MS);
    watcher.stop();
    vi.setSystemTime(Date.now() + CHECK_EVERY_MS);
    watcher.lookAgain();
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('doesn’t look again while an update is on its way', async () => {
    nextLookFinds('0.2.0');
    await watcher.check();
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    watcher.lookAgain();
    vi.advanceTimersByTime(FIRST_CHECK_AFTER_MS + CHECK_EVERY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('follows an update from found to downloaded, with its notes', async () => {
    nextLookFinds('0.2.0');
    await watcher.check();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    updater.emit('download-progress', { percent: 41.6 });
    // Progress says something only when the percent it shows moves on.
    updater.emit('download-progress', { percent: 41.9 });
    updater.emit('update-downloaded', { version: '0.2.0', releaseNotes: '- Faster resumes.\n' });
    expect(statuses).toEqual([
      { state: 'downloading', version: '0.2.0', percent: 0 },
      { state: 'downloading', version: '0.2.0', percent: 42 },
      { state: 'ready', version: '0.2.0', notes: '- Faster resumes.' },
    ]);
    expect(watcher.current()).toEqual({
      state: 'ready',
      version: '0.2.0',
      notes: '- Faster resumes.',
    });
  });

  it('downloads nothing when there’s nothing new', async () => {
    updater.checkForUpdates.mockImplementationOnce(async () => ({
      isUpdateAvailable: false,
      updateInfo: { version: '0.1.0' },
    }));
    await watcher.check();
    // A copy that doesn't update itself, such as one in development, finds nothing either.
    await watcher.check();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
  });

  it('goes on looking while an update waits, so a newer one takes its place', async () => {
    nextLookFinds('0.2.0');
    await watcher.check();
    updater.emit('update-downloaded', { version: '0.2.0', releaseNotes: 'Two.' });
    vi.advanceTimersByTime(FIRST_CHECK_AFTER_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    // 0.2.1 came out while 0.2.0 waited: it downloads in its place, so one restart brings it.
    nextLookFinds('0.2.1');
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(2));
    expect(watcher.current()).toEqual({ state: 'downloading', version: '0.2.1', percent: 0 });
    // Restarting now would install 0.2.0, so it waits for 0.2.1.
    expect(await watcher.install()).toBe(false);
    updater.emit('update-downloaded', { version: '0.2.1', releaseNotes: 'Two point one.' });
    expect(watcher.current()).toEqual({
      state: 'ready',
      version: '0.2.1',
      notes: 'Two point one.',
    });
  });

  it('doesn’t download the update that’s waiting again', async () => {
    nextLookFinds('0.2.0');
    await watcher.check();
    updater.emit('update-downloaded', { version: '0.2.0' });
    nextLookFinds('0.2.0');
    await watcher.check();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(watcher.current()).toMatchObject({ state: 'ready', version: '0.2.0' });
  });

  it('keeps the update that’s waiting when a look fails', async () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    nextLookFails('offline');
    await watcher.check();
    expect(watcher.current()).toMatchObject({ state: 'ready', version: '0.2.0' });
    expect(logged).toEqual(['Update: offline']);
    expect(await watcher.install()).toBe(true);
  });

  it('gets a newer version at the next look when its download fails', async () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    nextLookFinds('0.2.1');
    await watcher.check();
    // The newer download took the waiting update's place as it started, so there's none now.
    updater.emit('error', new Error('connection reset'));
    expect(watcher.current()).toEqual({ state: 'none' });
    nextLookFinds('0.2.1');
    await watcher.check();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(watcher.current()).toMatchObject({ state: 'downloading', version: '0.2.1' });
  });

  it('keeps what it had when a download can’t start', async () => {
    // A feed whose files it can't read throws straight away, with no error of the updater's.
    updater.downloadUpdate.mockImplementation(() => {
      throw new Error('No files provided');
    });
    nextLookFinds('0.2.0');
    await watcher.check();
    expect(watcher.current()).toEqual({ state: 'none' });
    expect(logged).toEqual(['Update: No files provided']);
    updater.emit('update-downloaded', { version: '0.2.0' });
    nextLookFinds('0.2.1');
    await watcher.check();
    expect(watcher.current()).toMatchObject({ state: 'ready', version: '0.2.0' });
    // It isn't stuck downloading, so it looks again.
    await watcher.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it('reads notes given for each version, or none', () => {
    updater.emit('update-downloaded', {
      version: '0.3.0',
      releaseNotes: [
        { version: '0.3.0', note: 'Three.' },
        { version: '0.2.0', note: 'Two.' },
      ],
    });
    expect(watcher.current()).toMatchObject({ notes: 'Three.\n\nTwo.' });
    updater.emit('update-downloaded', { version: '0.3.1', releaseNotes: null });
    expect(watcher.current()).toMatchObject({ notes: null });
  });

  it('keeps a problem quiet, and tries again at the next look', async () => {
    nextLookFails('offline');
    await watcher.check();
    expect(logged).toEqual(['Update: offline']);
    nextLookFinds('0.2.0');
    await watcher.check();
    updater.emit('error', new Error('download failed'));
    expect(watcher.current()).toEqual({ state: 'none' });
    await watcher.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it('doesn’t look, or download what a look finds, once it’s restarting into the update', async () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    // A look started as the user came back to the window to click Restart now.
    let answer: (found: Found) => void = () => {};
    updater.checkForUpdates.mockImplementationOnce(
      () => new Promise<Found>((resolve) => (answer = resolve)),
    );
    const looking = watcher.check();
    expect(await watcher.install()).toBe(true);
    answer({ isUpdateAvailable: true, updateInfo: { version: '0.2.1' } });
    await looking;
    await watcher.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(watcher.current()).toMatchObject({ state: 'ready', version: '0.2.0' });
  });

  it('restarts into an update only once one is downloaded', async () => {
    expect(await watcher.install()).toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    updater.emit('update-downloaded', { version: '0.2.0' });
    expect(await watcher.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('starts over after any problem, even with an update ready', () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    updater.emit('error', new Error('install failed'));
    expect(watcher.current()).toEqual({ state: 'none' });
  });
});

describe('UpdateWatcher on a Mac', () => {
  let installer: EventEmitter;

  beforeEach(() => {
    watcher.stop();
    statuses = [];
    busy = false;
    closed = [];
    updater = new FakeUpdater();
    installer = new EventEmitter();
    watcher = new UpdateWatcher({
      updater: updater as unknown as Updater,
      macInstaller: installer,
      busy: () => busy,
      closeClaude: async () => {
        closed.push('asked');
        await Promise.resolve();
        closed.push('closed');
      },
      onStatus: (status) => statuses.push(status),
    });
    watcher.start();
  });

  let busy = false;
  /** What became of Claude Code that's done, as restarting closed it. */
  let closed: string[] = [];

  it('is ready only once the Mac has checked the download and can install it', async () => {
    nextLookFinds('0.2.0');
    await watcher.check();
    updater.emit('update-downloaded', { version: '0.2.0', releaseNotes: 'Two.' });
    expect(watcher.current()).toMatchObject({ state: 'downloading' });
    installer.emit('update-downloaded');
    expect(watcher.current()).toEqual({ state: 'ready', version: '0.2.0', notes: 'Two.' });
  });

  it('starts over when the Mac turns a download down, and looks again', async () => {
    nextLookFinds('0.2.0');
    await watcher.check();
    updater.emit('update-downloaded', { version: '0.2.0' });
    updater.emit('error', new Error('code signature did not pass validation'));
    installer.emit('update-downloaded');
    expect(watcher.current()).toEqual({ state: 'none' });
    await watcher.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('waits for the Mac to check a newer download before offering it', async () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    installer.emit('update-downloaded');
    nextLookFinds('0.2.1');
    await watcher.check();
    updater.emit('update-downloaded', { version: '0.2.1' });
    expect(watcher.current()).toMatchObject({ state: 'downloading', version: '0.2.1' });
    installer.emit('update-downloaded');
    expect(watcher.current()).toMatchObject({ state: 'ready', version: '0.2.1' });
  });

  it('doesn’t restart while Claude has work going', async () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    installer.emit('update-downloaded');
    busy = true;
    expect(await watcher.install()).toBe(false);
    expect(closed).toEqual([]);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('tries again after an install that fails, and answers no once the update is gone', async () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    installer.emit('update-downloaded');
    expect(await watcher.install()).toBe(true);
    // The installer couldn't run, so the app never quit.
    updater.emit('error', new Error('install failed'));
    expect(watcher.current()).toEqual({ state: 'none' });
    // With no update, Restart now and switching profiles restart as usual.
    expect(await watcher.install()).toBe(false);
    updater.emit('update-downloaded', { version: '0.2.0' });
    installer.emit('update-downloaded');
    expect(await watcher.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2);
  });

  it('goes on restarting when a look fails while Claude Code closes', async () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    installer.emit('update-downloaded');
    // A look started as the user came back to the window to click Restart now, and fails once
    // the restart has begun.
    let fail: () => void = () => {};
    updater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise<Found>((_, reject) => {
          fail = () => {
            const error = new Error('offline');
            updater.emit('error', error, `${LOOK_FAILED}: ${error.stack}`);
            reject(error);
          };
        }),
    );
    const looking = watcher.check();
    const restarting = watcher.install();
    fail();
    await looking;
    expect(await restarting).toBe(true);
    expect(watcher.current()).toMatchObject({ state: 'ready', version: '0.2.0' });
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('quits Claude Code that’s done first, then restarts into the update, once', async () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    installer.emit('update-downloaded');
    updater.quitAndInstall.mockImplementation(() => closed.push('installed'));
    // Restart now, clicked again while Claude Code closes.
    const [first, again] = await Promise.all([watcher.install(), watcher.install()]);
    expect([first, again]).toEqual([true, true]);
    expect(closed).toEqual(['asked', 'closed', 'installed']);
  });
});
