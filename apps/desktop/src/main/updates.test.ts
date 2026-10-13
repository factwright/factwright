import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../shared/updates.ts';
import { CHECK_EVERY_MS, FIRST_CHECK_AFTER_MS, type Updater, UpdateWatcher } from './updates.ts';

/** A stand-in for electron-updater: it looks when asked, and tells what happened by events. */
class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  logger: unknown = console;
  checkForUpdates = vi.fn(async () => null);
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
});
