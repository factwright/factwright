import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type Opened, openApp, terminalText } from './app.ts';
import { ACME_RESUME, newDataFolder } from './workspace.ts';

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

/** Picks a view of the jobs, by its label, as a person clicks it. */
const pickView = (name: RegExp) =>
  opened.window
    .locator('label')
    .filter({ has: opened.window.getByRole('radio', { name }) })
    .click();

/** Closes Claude's panel once its run is done, ready for the next. */
async function closeRun() {
  const panel = claudePanel();
  await panel.getByRole('button', { name: 'Stop' }).click();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
}

test('shows the jobs on file, and your Claude ready', async () => {
  const { window } = opened;
  await expect(window.getByRole('button', { name: /^Acme Robotics/ })).toBeVisible();
  await expect(window.getByText('Signed in · Max plan')).toBeVisible();
  await pickView(/^To review/);
  await expect(window.getByRole('button', { name: /^Tidewater Analytics/ })).toBeVisible();
  await pickView(/^Active/);
});

test('checks its setup with Claude Code quietly, and it passes', async () => {
  await expect
    .poll(
      () => {
        try {
          return JSON.parse(readFileSync(join(dataDir, 'setup-check.json'), 'utf8')).result;
        } catch {
          return null;
        }
      },
      { timeout: 20_000 },
    )
    .toBe('passed');
  await expect(opened.window.getByText('Setup check failed')).toHaveCount(0);
});

test('tracks a job: its status and notes', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await window.getByRole('combobox', { name: 'Status for Acme Robotics' }).selectOption('applied');
  await window
    .getByPlaceholder('Names, what they asked, anything to remember')
    .fill('Recruiter: Sam');
  await expect(window.getByRole('combobox', { name: 'Status for Acme Robotics' })).toHaveValue(
    'applied',
  );
});

test('previews a resume’s pages', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: `Preview ${ACME_RESUME}` }).click();
  const dialog = window.getByRole('dialog', { name: ACME_RESUME });
  await expect(dialog.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  await expect(dialog.getByText('1 page')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
});

test('asks for an application’s questions, then runs them in Claude’s panel', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: /^Application questions/ }).click();
  const dialog = window.getByRole('dialog', { name: 'Application questions' });
  await dialog.getByRole('textbox', { name: 'Question 1' }).fill('Why Acme?');
  await dialog.getByRole('button', { name: 'Answer with Claude' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  // The app types only the skill and the job; the questions reach Claude through its tools.
  expect(await terminalText(window)).toContain(
    '/factwright:answer-questions job acme-robotics--staff-engineer',
  );
  expect(await terminalText(window)).not.toContain('Why Acme?');
  // Answers are writing, so they get Opus and high effort until the user chooses otherwise.
  expect(await terminalText(window)).toContain('opus · high effort');
  await closeRun();
});

test('finds jobs', async () => {
  const { window } = opened;
  // Done with Acme. In a narrow window, a job's details cover the page's buttons.
  await window.getByRole('button', { name: 'Close details' }).click();
  await window.getByRole('button', { name: 'Find jobs' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  expect(await terminalText(window)).toContain('/factwright:job-search');
  // A search reads a lot and weighs it lightly, so it thinks at medium.
  expect(await terminalText(window)).toContain('opus · medium effort');
  await closeRun();
});

test('adds a job by hand', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: 'Add job' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add a job' });
  await dialog.getByRole('textbox', { name: 'Company' }).fill('Northwind Labs');
  await dialog.getByRole('button', { name: 'Add job' }).click();
  await expect(window.getByRole('button', { name: /^Northwind Labs/ })).toBeVisible();
});

test('keeps everything tracked after a restart', async () => {
  await opened.app.close();
  opened = await openApp(dataDir);
  const { window } = opened;
  await pickView(/^All/);
  await expect(window.getByRole('button', { name: /^Northwind Labs/ })).toBeVisible();
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await expect(window.getByRole('combobox', { name: 'Status for Acme Robotics' })).toHaveValue(
    'applied',
  );
  await expect(window.getByPlaceholder('Names, what they asked, anything to remember')).toHaveValue(
    'Recruiter: Sam',
  );
});

test('explains the first run’s question about trusting the workspace', async () => {
  await opened.app.close();
  opened = await openApp(dataDir, { FAKE_CLAUDE_TRUST: 'ask' });
  const { window } = opened;
  await window.getByRole('button', { name: 'Find jobs' }).click();
  const panel = claudePanel();
  await expect(panel.getByRole('note')).toContainText(
    'Use the arrow keys to pick “Yes, I trust this folder”',
  );
  await expect(panel.getByRole('status')).toHaveText('Needs your answer');
  await panel.locator('.xterm-helper-textarea').press('Enter');
  await expect(panel.getByRole('note')).toHaveCount(0);
  await expect(panel.getByRole('status')).toHaveText('Done');
  await closeRun();
});
