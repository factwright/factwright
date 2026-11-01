import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { FactwrightApi } from '../src/shared/api.ts';
import { type Opened, openApp } from './app.ts';
import { desktop } from './paths.ts';
import { newDataFolder } from './workspace.ts';

/** A version with short notes, which stay in the app's release-notes folder for good. */
const VERSION = '0.19.0';

/** A test asks for what's new, as if the app were running this version. */
const AS_VERSION = { FACTWRIGHT_WHATS_NEW: VERSION };

/** The lines of that version's notes, each as the dialog shows it. */
const LINES = readFileSync(join(desktop, 'release-notes', `${VERSION}.short.md`), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.replace(/^- /, '').replaceAll('**', ''));

let dataDir: string;
let opened: Opened | undefined;

const open = async (env?: Record<string, string>) => {
  opened = await openApp(dataDir, env);
  return opened.window;
};

const quit = async () => {
  await opened?.app.close();
  opened = undefined;
};

const seenFile = () => join(dataDir, 'whats-new.json');
const keepSeen = (seen: string) => writeFileSync(seenFile(), JSON.stringify({ seen }));
const seen = () =>
  existsSync(seenFile()) ? (JSON.parse(readFileSync(seenFile(), 'utf8')).seen as string) : null;

const dialog = (window: Page) => window.getByRole('dialog', { name: `What’s new in ${VERSION}` });

/**
 * Nothing is due, and no dialog came. The window shows what's new a moment after it says it's no
 * longer due, once that's kept, so this gives it that moment.
 */
async function expectNothingShown(window: Page) {
  await expect
    .poll(() =>
      window.evaluate(() =>
        (window as unknown as { factwright: FactwrightApi }).factwright.whatsNewDue(),
      ),
    )
    .toBeNull();
  await window.waitForTimeout(500);
  await expect(window.getByRole('dialog')).toHaveCount(0);
}

test.beforeEach(() => {
  dataDir = newDataFolder();
});

test.afterEach(async () => {
  await opened?.app.close().catch(() => {});
  opened = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

test('a first open says nothing, and nor does the next', async () => {
  await expectNothingShown(await open(AS_VERSION));
  expect(seen()).toBe(VERSION);
  await quit();
  await expectNothingShown(await open(AS_VERSION));
});

test('an update from a version before this says what’s new, once', async () => {
  // It opens the app three times.
  test.slow();
  // A quiet open, like a version before this: it leaves a tracker, and nothing about what's new.
  await expectNothingShown(await open());
  expect(seen()).toBeNull();
  await quit();

  const window = await open(AS_VERSION);
  const shown = dialog(window);
  await expect(shown).toBeVisible();
  await expect(shown.getByRole('listitem')).toHaveText(LINES);
  await expect(shown.getByRole('link', { name: 'Read the full notes' })).toHaveAttribute(
    'href',
    `https://github.com/factwright/factwright/releases/tag/v${VERSION}`,
  );
  await expect(shown.getByRole('button', { name: 'Got it' })).toBeFocused();
  // Kept as it shows, whether or not it's dismissed.
  expect(seen()).toBe(VERSION);
  await shown.getByRole('button', { name: 'Got it' }).click();
  await expect(shown).toBeHidden();
  await quit();

  await expectNothingShown(await open(AS_VERSION));
});

test('going down a version says nothing, and keeps the newest seen', async () => {
  keepSeen('0.20.0');
  await expectNothingShown(await open(AS_VERSION));
  expect(seen()).toBe('0.20.0');
});

test('quiet mode says nothing unless a test asks, and leaves what’s due as it is', async () => {
  keepSeen('0.18.1');
  await expectNothingShown(await open());
  expect(seen()).toBe('0.18.1');
});

test('it never shows over Get started, and passes that version by', async () => {
  rmSync(dataDir, { recursive: true, force: true });
  dataDir = newDataFolder({ empty: true });
  keepSeen('0.18.1');
  const window = await open(AS_VERSION);
  await expect(window.getByRole('heading', { name: 'Let’s get you set up' })).toBeVisible();
  await expect.poll(seen).toBe(VERSION);
  await expectNothingShown(window);
});
