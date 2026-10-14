import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type Opened, openApp } from './app.ts';
import { ACME_FOLDER, newDataFolder } from './workspace.ts';

test.describe.configure({ mode: 'serial' });

let dataDir: string;
let opened: Opened | undefined;
/** The first profile's job hunt as it was before any profile was added. */
let before: { files: string[]; acme: string };

// Switching profiles restarts the app. In the tests it only closes, and each test opens it again.
const open = async () => {
  opened = await openApp(dataDir, { FACTWRIGHT_RELAUNCH: 'off' });
  return opened;
};

/** Waits for the app to close itself, as switching profiles does. */
async function closes(app: Opened['app']) {
  await app.waitForEvent('close', { timeout: 20_000 });
  opened = undefined;
}

const addedProfiles = () =>
  existsSync(join(dataDir, 'Profiles')) ? readdirSync(join(dataDir, 'Profiles')) : [];

test.beforeAll(() => {
  dataDir = newDataFolder();
  before = {
    files: readdirSync(join(dataDir, 'workspace'), { recursive: true }).map(String).sort(),
    acme: readFileSync(join(dataDir, 'workspace', ACME_FOLDER, 'job.md'), 'utf8'),
  };
});

test.afterAll(async () => {
  await opened?.app.close().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
});

test('with one profile, shows no switcher, and offers a profile for someone else', async () => {
  const { window } = await open();
  await expect(window.getByRole('button', { name: /^Acme Robotics/ })).toBeVisible();
  await expect(window.getByRole('button', { name: /^Profile:/ })).toHaveCount(0);
  // Nothing is written for profiles until one is added.
  expect(existsSync(join(dataDir, 'profiles.json'))).toBe(false);
  expect(existsSync(join(dataDir, 'profile.json'))).toBe(false);
  await window.getByRole('button', { name: 'Get started' }).first().click();
  await window.getByRole('button', { name: 'Add a profile' }).click();
});

test('adds a profile, and opens on it: empty, with its own Claude login', async () => {
  if (!opened) throw new Error('The app isn’t open.');
  const { app, window } = opened;
  const dialog = window.getByRole('dialog', { name: 'Add a profile' });
  await dialog.getByRole('textbox', { name: 'New profile’s name' }).fill('Testing');
  // The first time, the open profile gets a name too.
  await dialog.getByRole('textbox', { name: 'This profile’s name' }).fill('Alex');
  await dialog.getByRole('button', { name: 'Add and open' }).click();
  await closes(app);

  const [id] = addedProfiles();
  expect(id).toMatch(/^[0-9a-f]{12}$/);
  const profile = join(dataDir, 'Profiles', id as string);
  const { window: added } = await open();
  await expect(added.getByRole('heading', { name: 'Let’s get you set up' })).toBeVisible();
  await expect(added.getByRole('button', { name: 'Profile: Testing' })).toBeVisible();
  await expect(added).toHaveTitle('Factwright · Testing');
  // Claude Code for this profile keeps its login in the profile's own folder.
  await expect(added.getByText('Not signed in', { exact: true })).toBeVisible();
  await expect(added.getByText(`Profiles/${id}/claude' claude auth login`)).toBeVisible();
  // Its own data, in its own folder.
  expect(existsSync(join(profile, 'workspace'))).toBe(true);
  expect(existsSync(join(profile, 'tracker.db'))).toBe(true);
  expect(JSON.parse(readFileSync(join(profile, 'claude', '.claude.json'), 'utf8'))).toEqual({
    hasCompletedOnboarding: true,
  });

  // Signing in, as `claude auth login` with the profile's folder would.
  writeFileSync(join(profile, 'claude', 'signed-in'), '');
  await added.getByRole('button', { name: 'Check again' }).first().click();
  await expect(added.getByText('Your Claude is ready · Max plan.')).toBeVisible();
});

test('switches back to the first profile, whose job hunt is as it was', async () => {
  if (!opened) throw new Error('The app isn’t open.');
  const { app, window } = opened;
  await window.getByRole('button', { name: 'Profile: Testing' }).click();
  const menu = window.getByRole('menu', { name: 'Profiles' });
  await expect(menu.getByRole('menuitemradio')).toHaveText(['AAlex', 'TTesting']);
  await menu.getByRole('menuitemradio', { name: 'Alex' }).click();
  await closes(app);

  const { window: first } = await open();
  await expect(first.getByRole('button', { name: /^Acme Robotics/ })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Profile: Alex' })).toBeVisible();
  await expect(first.getByText('Signed in · Max plan')).toBeVisible();
  // The added profile's folder holds only its own job hunt: none of the first profile's jobs.
  const [id] = addedProfiles();
  const added = join(dataDir, 'Profiles', id as string, 'workspace');
  expect(readdirSync(added, { recursive: true }).map(String)).not.toContain(ACME_FOLDER);
  // The first profile's job hunt is where it was, as it was.
  const files = readdirSync(join(dataDir, 'workspace'), { recursive: true }).map(String);
  expect(files).toEqual(expect.arrayContaining(before.files));
  expect(readFileSync(join(dataDir, 'workspace', ACME_FOLDER, 'job.md'), 'utf8')).toBe(before.acme);
  expect(statSync(join(dataDir, 'tracker.db')).isFile()).toBe(true);
});

test('renames a profile, and won’t remove the open one or the first', async () => {
  if (!opened) throw new Error('The app isn’t open.');
  const { window } = opened;
  await window.getByRole('button', { name: 'Profile: Alex' }).click();
  await window.getByRole('menuitem', { name: 'Manage profiles…' }).click();
  const dialog = window.getByRole('dialog', { name: 'Manage profiles' });
  await dialog.getByRole('button', { name: 'Rename Alex' }).click();
  await dialog.getByRole('textbox', { name: 'New name for Alex' }).fill('Alex Rivera');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Alex Rivera', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Remove Alex Rivera' })).toHaveCount(0);
  // Removing Testing would put its folder in this computer's real trash, so the tests stop there.
  await expect(dialog.getByRole('button', { name: 'Remove Testing' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(window.getByRole('button', { name: 'Profile: Alex Rivera' })).toBeVisible();
  await expect(window).toHaveTitle('Factwright · Alex Rivera');
});
