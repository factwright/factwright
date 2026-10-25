import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { FactwrightApi } from '../src/shared/api.ts';
import type { RunTask } from '../src/shared/runs.ts';
import { type Opened, openApp, terminalText } from './app.ts';
import { ACME_FOLDER, newDataFolder } from './workspace.ts';

test.describe.configure({ mode: 'serial' });

let dataDir: string;
let opened: Opened;

const ACME_ID = 'acme-robotics--staff-engineer';
const claudePanel = () => opened.window.locator('section[aria-label="Claude"]');
const jobPanel = () => opened.window.locator('aside[aria-label="Job details"]');
const letter = () => jobPanel().getByRole('region', { name: 'Cover letter', exact: true });
const earlier = () => letter().getByRole('list', { name: 'Earlier versions of the cover letter' });
/** The earlier versions the job's folder keeps. */
const kept = () => readdirSync(join(dataDir, 'workspace', ACME_FOLDER, 'previous')).sort();
/**
 * The letter's first paragraph, or null for the moment Use this has the job's letter aside,
 * before the earlier one takes its place.
 */
const words = () => {
  try {
    return JSON.parse(
      readFileSync(join(dataDir, 'workspace', ACME_FOLDER, 'cover-letter.json'), 'utf8'),
    ).paragraphs[0];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

async function finishRun() {
  const panel = claudePanel();
  await expect(panel.getByRole('status').first()).toHaveText('Done');
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
}

test.beforeAll(async () => {
  dataDir = newDataFolder();
  opened = await openApp(dataDir);
});

test.afterAll(async () => {
  await opened?.app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('refuses changes it didn’t keep, and gives them a run of their own', async () => {
  const task = { skill: 'cover-letter', jobId: ACME_ID, changes: true };
  type Api = { factwright: FactwrightApi };
  const started = await opened.window.evaluate(
    (given) =>
      (globalThis as unknown as Api).factwright.startClaude(
        { cols: 80, rows: 24 },
        given as RunTask,
      ),
    task,
  );
  expect(started).toEqual({ ok: false, reason: 'changes' });
  const asTask = await opened.window.evaluate(
    (given) => (globalThis as unknown as Api).factwright.runTask(given as RunTask),
    task,
  );
  expect(asTask).toEqual({ ok: false, reason: 'new-run' });
});

test('makes the changes the user asks for, typing only the job and the app’s own word', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await jobPanel().getByRole('button', { name: 'Write a cover letter' }).click();
  await finishRun();
  const first = words();
  await letter().getByRole('button', { name: 'Request changes' }).click();
  const dialog = window.getByRole('dialog', { name: 'Changes to your cover letter' });
  await dialog.getByRole('textbox', { name: 'What to change' }).fill('Make it shorter');
  await dialog.getByRole('button', { name: 'Make the changes' }).click();
  await expect(claudePanel()).toContainText('Your cover letter for Acme Robotics is ready.');
  const typed = await terminalText(window);
  expect(typed).toContain(`/factwright:cover-letter job ${ACME_ID} changes`);
  // The user's words reach the run through requested_changes, never typed into it.
  expect(typed).not.toContain('Make it shorter');
  await finishRun();
  expect(words()).toBe('Changed as you asked (Make it shorter), by the stand-in Claude.');
  // The letter before the changes is kept as an earlier version, and says why.
  await letter().getByText('Earlier versions').click();
  await expect(earlier().getByRole('listitem')).toHaveCount(1);
  await expect(earlier()).toContainText('Before your changes: “Make it shorter”');
  expect(kept()).toHaveLength(1);
  // Used again, it's the job's letter, and the one with the changes is put aside.
  await earlier()
    .getByRole('button', { name: /^Use the version built/ })
    .click();
  await expect.poll(words).toBe(first);
  await expect(earlier()).toContainText('Set aside for an earlier version');
  await expect(earlier().getByRole('listitem')).toHaveCount(1);
});

test('keeps the current letter before a new version, and asks before the Trash', async () => {
  const { window } = opened;
  await letter().getByRole('button', { name: 'New version' }).click();
  await expect(claudePanel()).toContainText('Your cover letter for Acme Robotics is ready.');
  expect(await terminalText(window)).toContain(
    `/factwright:cover-letter job ${ACME_ID} new version`,
  );
  await finishRun();
  // In the order they were made, newest first: the letter with the changes, then the first.
  const rows = earlier().getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Set aside for an earlier version');
  await expect(rows.nth(1)).toContainText('Before a new version');
  expect(kept()).toHaveLength(2);
  // Remove asks first. The tests stop at Keep: Remove would put the folder in this computer's
  // real Trash.
  await earlier()
    .getByRole('button', { name: /^Remove the version built/ })
    .first()
    .click();
  await expect(earlier().getByRole('status')).toHaveText('Move it to the Trash?');
  await earlier().getByRole('button', { name: 'Keep' }).click();
  await expect(earlier().getByRole('listitem')).toHaveCount(2);
});
