import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../shared/updates.ts';
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_AFTER_MS,
  NO_INSTALL_ID,
  type Updater,
  UpdateWatcher,
} from './updates.ts';

/** A stand-in for electron-updater: it looks when asked, and tells what happened by events. */
class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  logger: unknown = console;
  requestHeaders: Record<string, string> | null = { 'user-agent': 'Factwright' };
  checkForUpdates = vi.fn(async (): Promise<{ downloadPromise?: Promise<unknown> } | null> => null);
  quitAndInstall = vi.fn();
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
  it('downloads by itself and installs on quitting, quietly', () => {
    expect(updater.autoDownload).toBe(true);
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
      updater.checkForUpdates.mockImplementationOnce(async () => ({
        downloadPromise: Promise.reject(new Error('connection reset')),
      }));
      watcher.check();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unanswered).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unanswered);
    }
  });
  it('looks a little after starting, then every few hours', () => {
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FIRST_CHECK_AFTER_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('follows an update from found to downloaded, with its notes', () => {
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('download-progress', { percent: 41.6 });
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

  it('stops looking once an update is on its way or waiting', () => {
    updater.emit('update-available', { version: '0.2.0' });
    vi.advanceTimersByTime(FIRST_CHECK_AFTER_MS + CHECK_EVERY_MS);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('keeps a problem quiet, and tries again at the next look', async () => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    watcher.check();
    await vi.waitFor(() => expect(logged).toEqual(['Update: offline']));
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('error', new Error('download failed'));
    expect(watcher.current()).toEqual({ state: 'none' });
    watcher.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('restarts into an update only once one is downloaded', () => {
    expect(watcher.install()).toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    updater.emit('update-downloaded', { version: '0.2.0' });
    expect(watcher.install()).toBe(true);
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
    updater = new FakeUpdater();
    installer = new EventEmitter();
    watcher = new UpdateWatcher({
      updater: updater as unknown as Updater,
      macInstaller: installer,
      busy: () => busy,
      onStatus: (status) => statuses.push(status),
    });
    watcher.start();
  });

  let busy = false;

  it('is ready only once the Mac has checked the download and can install it', () => {
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('update-downloaded', { version: '0.2.0', releaseNotes: 'Two.' });
    expect(watcher.current()).toMatchObject({ state: 'downloading' });
    installer.emit('update-downloaded');
    expect(watcher.current()).toEqual({ state: 'ready', version: '0.2.0', notes: 'Two.' });
  });

  it('starts over when the Mac turns a download down, and looks again', () => {
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('update-downloaded', { version: '0.2.0' });
    updater.emit('error', new Error('code signature did not pass validation'));
    installer.emit('update-downloaded');
    expect(watcher.current()).toEqual({ state: 'none' });
    watcher.check();
    expect(updater.checkForUpdates).toHaveBeenCalled();
  });

  it('doesn’t restart while Claude is working', () => {
    updater.emit('update-downloaded', { version: '0.2.0' });
    installer.emit('update-downloaded');
    busy = true;
    expect(watcher.install()).toBe(false);
    busy = false;
    expect(watcher.install()).toBe(true);
  });
});
