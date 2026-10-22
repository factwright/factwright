import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { type Opened, openApp } from './app.ts';
import { newDataFolder } from './workspace.ts';

// A Mac app keeps running with its window closed, until the user quits, and the Dock, opening the
// app again, or a notification opens a new window. Everything that kept the first window must use
// the new one. On Windows and Linux, closing the window quits the app.
const mac = process.platform === 'darwin';

let dataDir: string;
let opened: Opened | undefined;
/** What the app's process printed, which says what went wrong as it quit. */
let printed: string[];

/** How the app's process marks a problem it had. */
const PROBLEM = 'Problem in the app:';

test.beforeEach(async () => {
  dataDir = newDataFolder();
  opened = await openApp(dataDir);
  printed = [];
  opened.app.process().stderr?.on('data', (data) => printed.push(String(data)));
  // A problem in the app's own process shows nowhere else: Electron puts it in a dialog.
  await opened.app.evaluate((_electron, marker) => {
    const problems: string[] = [];
    Object.assign(globalThis, { problems });
    process.on('uncaughtException', (error) => {
      problems.push(String(error));
      console.error(marker, error);
    });
  }, PROBLEM);
});

test.afterEach(async () => {
  if (opened) {
    const problems = await opened.app
      .evaluate(() => (globalThis as unknown as { problems: string[] }).problems)
      .catch((error: unknown) => [`The app stopped answering: ${String(error)}`]);
    await opened.app.close().catch(() => {});
    opened = undefined;
    expect(problems).toEqual([]);
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/**
 * Prints a template's preview, which the app does in a hidden window of its own. Each name on top
 * prints anew, where the same one would show the preview kept from before.
 */
async function printPreview({ window }: Opened, name: string): Promise<void> {
  const done = await window.evaluate(async (shown) => {
    const { factwright } = globalThis as unknown as {
      factwright: { templatePreview(id: string, name: string): Promise<{ ok: boolean }> };
    };
    return (await factwright.templatePreview('classic', shown)).ok;
  }, name);
  expect(done).toBe(true);
}

/** Closes the app's window, as its close button does. In quiet mode it's hidden, as print's is. */
async function closeWindow({ app, window }: Opened): Promise<void> {
  const closed = window.waitForEvent('close');
  await (await app.browserWindow(window)).evaluate((each) => each.close());
  await closed;
}

/** Does something that opens the app's window again, and waits for it to show the jobs. */
async function opensAgain(open: () => Promise<unknown>): Promise<Page> {
  if (!opened) throw new Error('The app isn’t open.');
  const next = opened.app.waitForEvent('window', {
    predicate: (page) => page.url().startsWith('app://'),
    timeout: 15_000,
  });
  await open();
  const window = await next;
  await expect(window.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  opened = { ...opened, window };
  return window;
}

test('stays out of the way while the tests run it, never taking the keyboard', async () => {
  if (!opened) throw new Error('The app isn’t open.');
  await expect(opened.window.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  // On a Mac the window stays hidden. Elsewhere it shows, without being brought forward.
  expect(
    await opened.app.evaluate(({ app, BrowserWindow }) => ({
      shown: BrowserWindow.getAllWindows().filter((each) => each.isVisible()).length,
      focused: BrowserWindow.getFocusedWindow() !== null,
      dock: app.dock?.isVisible() ?? false,
    })),
  ).toEqual({ shown: mac ? 0 : 1, focused: false, dock: false });
});

test.describe('on a Mac', () => {
  test.skip(!mac, 'Only a Mac app keeps running with its window closed.');

  test('opens its window again from the Dock, after printing in a window of its own', async () => {
    if (!opened) throw new Error('The app isn’t open.');
    await printPreview(opened, 'Alex Rivera');
    await closeWindow(opened);
    const window = await opensAgain(() =>
      (opened as Opened).app.evaluate(({ app }) => {
        app.emit('activate', {}, false);
      }),
    );
    // What changes from now on shows in the new window: a job added to the workspace, here.
    const folder = join(dataDir, 'workspace', 'applications', '2026-10-16-harbor-labs-platform');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'job.md'),
      '# Harbor Labs: Platform Engineer\n\n- **Date:** 2026-10-16\n',
    );
    await window
      .locator('label')
      .filter({ has: window.getByRole('radio', { name: /^All/ }) })
      .click();
    await expect(window.getByRole('button', { name: /^Harbor Labs/ })).toBeVisible();
    // And it prints, in the hidden window kept from before.
    await printPreview(opened as Opened, 'Sam Rivera');
  });

  test('opens its window again when it’s opened a second time, after it was closed', async () => {
    if (!opened) throw new Error('The app isn’t open.');
    await closeWindow(opened);
    await opensAgain(() =>
      (opened as Opened).app.evaluate(({ app }) => {
        app.emit('second-instance', {}, [], process.cwd(), {});
      }),
    );
  });

  test('opens its window again from a notification about a run, after it was closed', async () => {
    if (!opened) throw new Error('The app isn’t open.');
    const { app, window } = opened;
    // The user is looking elsewhere. In quiet mode, notifications are only asked for, and kept here.
    await app.evaluate(({ app, BrowserWindow }) => {
      const shown: unknown[] = [];
      Object.assign(globalThis, { shown });
      BrowserWindow.prototype.isFocused = () => false;
      // An event of the app's own, which Electron's types don't list.
      (app as unknown as NodeJS.EventEmitter).on('quiet-notification', (notification: unknown) =>
        shown.push(notification),
      );
    });
    await window.getByRole('button', { name: 'Find jobs' }).click();
    await window
      .getByRole('dialog', { name: 'Find jobs' })
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(window.locator('section[aria-label="Claude"]').getByRole('status')).toHaveText(
      'Done',
    );
    // The window tells of it once it knows what the search made, or after a moment that it's done.
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { shown: unknown[] }).shown.length))
      .toBe(1);
    await closeWindow(opened);
    await opensAgain(() =>
      app.evaluate(() => {
        const { shown } = globalThis as unknown as { shown: { emit(event: string): void }[] };
        shown[0]?.emit('click');
      }),
    );
  });
});

test.describe('on Windows and Linux', () => {
  test.skip(mac, 'A Mac app keeps running with its window closed.');

  // With a window of its own still open, hidden, the app never heard that its last window closed.
  test('quits when its window closes, even after printing', async () => {
    if (!opened) throw new Error('The app isn’t open.');
    await printPreview(opened, 'Alex Rivera');
    const quit = opened.app.waitForEvent('close', { timeout: 15_000 });
    await closeWindow(opened);
    await quit;
    opened = undefined;
    expect(printed.join('')).not.toContain(PROBLEM);
  });
});
