import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { type Opened, openApp } from './app.ts';
import { newDataFolder } from './workspace.ts';

test.describe.configure({ mode: 'serial' });

let dataDir: string;
let opened: Opened;

test.beforeAll(async () => {
  dataDir = newDataFolder();
  opened = await openApp(dataDir);
});

test.afterAll(async () => {
  await opened?.app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const claudePanel = () => opened.window.locator('section[aria-label="Claude"]');
const jobPanel = () => opened.window.locator('aside[aria-label="Job details"]');
const jobRow = (company: string) =>
  opened.window
    .getByRole('list', { name: 'Jobs' })
    .getByRole('button', { name: new RegExp(`^${company}`) });

/** Picks a view of the jobs, by its label, as a person clicks it. */
const pickView = (name: RegExp) =>
  opened.window
    .locator('label')
    .filter({ has: opened.window.getByRole('radio', { name }) })
    .click();

/** Adds a job by hand, as one saved from the browser is added, with a link to its posting. */
async function addJob(company: string, role: string, link: string) {
  const { window } = opened;
  await window.getByRole('button', { name: 'Add job' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add a job' });
  await dialog.getByRole('textbox', { name: 'Company' }).fill(company);
  await dialog.getByRole('textbox', { name: 'Role' }).fill(role);
  await dialog.getByRole('textbox', { name: 'Link to the posting' }).fill(link);
  await dialog.getByRole('button', { name: 'Add job' }).click();
  await expect(jobRow(company)).toBeVisible();
}

/** Closes Claude's panel once its runs are done, a tab at a time, and the panel with the last. */
async function closeRuns() {
  const panel = claudePanel();
  const tabs = await panel.getByRole('tab').count();
  for (let left = Math.max(tabs, 1); left > 0; left -= 1) {
    await panel.getByRole('button', { name: 'Close' }).click();
    if (left > 1) await expect(panel.getByRole('tab')).not.toHaveCount(left);
  }
  await expect(panel).toHaveCount(0);
}

test('says a saved job isn’t checked yet, and changes its details, which stay the user’s', async () => {
  const { window } = opened;
  await addJob('Larkspur Benefits blog', 'Staff Engineer', 'https://jobs.example/larkspur/1');
  await pickView(/^New/);
  await expect(jobRow('Larkspur Benefits blog')).toContainText('Not checked yet');
  await expect(jobRow('Larkspur Benefits blog')).toContainText('Analyze job');
  await jobRow('Larkspur Benefits blog').click();
  await jobPanel().getByRole('button', { name: 'Edit details' }).click();
  const form = jobPanel().getByRole('form', { name: 'Edit details' });
  await form.getByRole('textbox', { name: 'Company' }).fill('Larkspur Benefits');
  await form.getByRole('textbox', { name: 'Place' }).fill('Remote (US)');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(jobPanel().getByText('Larkspur Benefits', { exact: true })).toBeVisible();
  await expect(jobPanel()).toContainText('Remote (US)');
  await expect(jobRow('Larkspur Benefits')).toBeVisible();
  // Opened again, the details are the user's own.
  await jobPanel().getByRole('button', { name: 'Edit details' }).click();
  await expect(form.getByText('Yours', { exact: true })).toHaveCount(2);
  await window.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await window.getByRole('button', { name: 'Close details' }).click();
});

test('analyzes the jobs picked in one run, whose name counts them done', async () => {
  const { window } = opened;
  await addJob('Coastline Credit Union', 'Senior Engineer', 'https://jobs.example/coastline/1');
  await window.getByRole('button', { name: 'Close details' }).click();
  await pickView(/^New/);
  await window.getByRole('checkbox', { name: /^Select Larkspur Benefits/ }).click();
  await window.getByRole('checkbox', { name: /^Select Coastline Credit Union/ }).click();
  const bar = window.getByRole('region', { name: 'Selected jobs' });
  await bar.getByRole('button', { name: 'Analyze' }).click();
  // One run, which takes both, and says so as it finishes each.
  await expect(claudePanel()).toContainText('Analyze · 2 of 2 done');
  await expect(claudePanel().getByRole('status').first()).toHaveText('Done');
  await expect(claudePanel()).toContainText('All 2 jobs are analyzed.');
  await closeRuns();
  // Each one is checked now, and Claude's work took them to To review.
  await pickView(/^To review/);
  await expect(jobRow('Larkspur Benefits')).toContainText('70 · Good');
  await expect(jobRow('Coastline Credit Union')).toContainText('70 · Good');
});

test('analyzes new jobs on its own while Claude is free', async () => {
  await opened.app.close();
  opened = await openApp(dataDir, {
    FACTWRIGHT_ANALYZE_NEW: 'on',
    FACTWRIGHT_ANALYZE_WAIT_MS: '500',
  });
  // The user is looking elsewhere. In quiet mode, notifications are only asked for, and kept here.
  await opened.app.evaluate(({ app, BrowserWindow }) => {
    const shown: unknown[] = [];
    Object.assign(globalThis, { shown });
    BrowserWindow.prototype.isFocused = () => false;
    // An event of the app's own, which Electron's types don't list.
    (app as unknown as NodeJS.EventEmitter).on('quiet-notification', (notification: unknown) =>
      shown.push(notification),
    );
  });
  await addJob('Mosaic Health', 'Principal Engineer', 'https://jobs.example/mosaic/1');
  await opened.window.getByRole('button', { name: 'Close details' }).click();
  await expect(claudePanel()).toContainText(/Analyze · (1 new job|1 of 1 done)/);
  await expect(claudePanel()).toContainText('Mosaic Health is analyzed.');
  // A run Claude started on its own stays quiet, even past the moment a done run's note waits.
  await opened.window.waitForTimeout(4000);
  expect(
    await opened.app.evaluate(() => (globalThis as unknown as { shown: unknown[] }).shown.length),
  ).toBe(0);
  await closeRuns();
  await pickView(/^To review/);
  await expect(jobRow('Mosaic Health')).toContainText('70 · Good');
  // The jobs analyzed before stay as they were: none is taken again.
  await expect(claudePanel()).toHaveCount(0);
});
