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

test.beforeEach(async () => {
  dataDir = newDataFolder();
  opened = await openApp(dataDir);
  // A problem in the app's own process shows nowhere else: Electron puts it in a dialog.
  await opened.app.evaluate(() => {
    const problems: string[] = [];
    Object.assign(globalThis, { problems });
    process.on('uncaughtException', (error) => problems.push(String(error)));
  });
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
 * Prints a template's preview, which the app does in a hidden window of its own, kept for the
 * next one. It stays open after the app's window closes.
 */
async function printPreview({ window }: Opened): Promise<void> {
  const printed = await window.evaluate(async () => {
    const { factwright } = globalThis as unknown as {
      factwright: { templatePreview(id: string, name: string): Promise<{ ok: boolean }> };
    };
    return (await factwright.templatePreview('classic', '')).ok;
  });
  expect(printed).toBe(true);
}

/** Closes the app's window, as its close button does. */
async function closeWindow({ app, window }: Opened): Promise<void> {
  const closed = window.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => {
    for (const each of BrowserWindow.getAllWindows()) if (each.isVisible()) each.close();
  });
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

test('opens its window again from the Dock, after printing in a window of its own', async () => {
  test.skip(!mac, 'Only a Mac app keeps running with its window closed.');
  if (!opened) throw new Error('The app isn’t open.');
  await printPreview(opened);
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
});

test('opens its window again when it’s opened a second time, after it was closed', async () => {
  test.skip(!mac, 'Only a Mac app keeps running with its window closed.');
  if (!opened) throw new Error('The app isn’t open.');
  await closeWindow(opened);
  await opensAgain(() =>
    (opened as Opened).app.evaluate(({ app }) => {
      app.emit('second-instance', {}, [], process.cwd(), {});
    }),
  );
});

test('opens its window again from a notification about a run, after it was closed', async () => {
  test.skip(!mac, 'Only a Mac app keeps running with its window closed.');
  if (!opened) throw new Error('The app isn’t open.');
  const { app, window } = opened;
  // The user is looking elsewhere, and notifications are kept here, not shown.
  await app.evaluate(({ BrowserWindow, Notification }) => {
    const shown: unknown[] = [];
    Object.assign(globalThis, { shown });
    BrowserWindow.prototype.isFocused = () => false;
    Notification.prototype.show = function (this: unknown) {
      shown.push(this);
    };
  });
  await window.getByRole('button', { name: 'Find jobs' }).click();
  await window
    .getByRole('dialog', { name: 'Find jobs' })
    .getByRole('button', { name: 'Search', exact: true })
    .click();
  await expect(window.locator('section[aria-label="Claude"]').getByRole('status')).toHaveText(
    'Done',
  );
  expect(
    await app.evaluate(() => (globalThis as unknown as { shown: unknown[] }).shown.length),
  ).toBe(1);
  await closeWindow(opened);
  await opensAgain(() =>
    app.evaluate(() => {
      const { shown } = globalThis as unknown as { shown: { emit(event: string): void }[] };
      shown[0]?.emit('click');
    }),
  );
});

// With a window of its own still open, hidden, the app never heard that its last window closed.
test('quits when its window closes on Windows and Linux, even after printing', async () => {
  test.skip(mac, 'A Mac app keeps running with its window closed.');
  if (!opened) throw new Error('The app isn’t open.');
  await printPreview(opened);
  const quit = opened.app.waitForEvent('close', { timeout: 15_000 });
  await closeWindow(opened);
  await quit;
  opened = undefined;
});
