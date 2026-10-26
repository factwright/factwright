import { rmSync } from 'node:fs';
import { expect, type Locator, test } from '@playwright/test';
import { type Opened, openApp, showWork, terminalStart, terminalText } from './app.ts';
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
const tabs = () => claudePanel().getByRole('tablist', { name: 'Claude’s tasks' });
const tab = (name: string) => tabs().getByRole('tab', { name: new RegExp(`^${name}`) });
const jobRow = (company: string) =>
  opened.window
    .getByRole('list', { name: 'Jobs' })
    .getByRole('button', { name: new RegExp(company) });

/** Picks a view of the jobs, by its label, as a person clicks it. */
const pickView = (name: RegExp) =>
  opened.window
    .locator('label')
    .filter({ has: opened.window.getByRole('radio', { name }) })
    .click();

/** Answers the stand-in's two questions about a resume, in the dialog that shows them. */
async function answerQuestions(dialog: Locator) {
  await dialog
    .getByRole('group', { name: /Have you used GraphQL/ })
    .getByRole('radio', { name: 'Yes, in production', exact: true })
    .check();
  await dialog
    .getByRole('group', { name: /Have you run Kafka/ })
    .getByRole('radio', { name: 'No', exact: true })
    .check();
  await dialog.getByRole('button', { name: 'Send answers' }).click();
}

test('runs two tasks on different jobs at once, and a third on one of them waits its turn', async () => {
  const { window } = opened;
  await pickView(/^All/);

  // Tidewater's resume starts, and stops to ask two questions, which wait in the app's dialog.
  await jobRow('Tidewater Analytics').click();
  await jobPanel()
    .getByRole('region', { name: 'Resumes and cover letters' })
    .getByRole('button', { name: 'Tailor a resume' })
    .click();
  const asks = window.getByRole('dialog', { name: 'Claude has 2 questions' });
  await expect(asks).toContainText(
    'From your Claude, working on Tidewater Analytics · Tailored resume.',
  );
  // One run alone has no tabs, as before.
  await expect(tabs()).toHaveCount(0);
  await asks.getByRole('button', { name: 'Not now' }).click();
  await expect(asks).toHaveCount(0);

  // A cover letter for the same job waits for its resume.
  await jobPanel().getByRole('button', { name: 'Write a cover letter' }).click();
  await expect(tab('Tidewater Analytics · Cover letter')).toContainText('in line');
  await expect(jobPanel().getByText('In line', { exact: true })).toBeVisible();
  await expect(claudePanel()).toContainText(
    'Waits for Claude’s other task on this job, then starts by itself.',
  );
  await expect(claudePanel().getByRole('status').first()).toHaveText('In line');

  // Another job's task starts beside it, and asks its own questions.
  await jobRow('Acme Robotics').click();
  await jobPanel()
    .getByRole('region', { name: 'Resumes and cover letters' })
    .getByRole('button', { name: 'New version' })
    .click();
  const acme = window.getByRole('dialog', { name: 'Claude has 2 questions' });
  await expect(acme).toContainText('From your Claude, working on Acme Robotics · Tailored resume.');
  // The dialog names the run asking, and which of those waiting it is.
  await expect(acme).toContainText('Acme Robotics · Tailored resume2 of 2');

  // Both run at once, each in a tab of its own, and the bar sums them up.
  await expect(tabs().getByRole('tab')).toHaveCount(3);
  await expect(tab('Tidewater Analytics · Tailored resume')).toContainText('waiting on you');
  await expect(tab('Acme Robotics · Tailored resume')).toContainText('waiting on you');
  await expect(claudePanel()).toContainText('2 waiting on you · 1 in line');
  await expect(jobRow('Tidewater Analytics')).toContainText('Claude is on it');
  await expect(jobRow('Acme Robotics')).toContainText('Claude is on it');

  // Back to the first one waiting, which the user answers first.
  await acme.getByRole('button', { name: 'Previous' }).click();
  const tidewater = window.getByRole('dialog', { name: 'Claude has 2 questions' });
  await expect(tidewater).toContainText('Tidewater Analytics · Tailored resume1 of 2');
  await answerQuestions(tidewater);

  // Answered, the dialog goes on to Acme's questions, and Tidewater's resume finishes, so its
  // cover letter starts by itself.
  const next = window.getByRole('dialog', { name: 'Claude has 2 questions' });
  await expect(next).toContainText('From your Claude, working on Acme Robotics · Tailored resume.');
  await expect(tab('Tidewater Analytics · Tailored resume')).toContainText('done');
  await expect(tab('Tidewater Analytics · Cover letter')).not.toContainText('in line');
  await expect(tab('Tidewater Analytics · Cover letter')).toContainText('done');
  await answerQuestions(next);
  await expect(next).toHaveCount(0);
  await expect(tab('Acme Robotics · Tailored resume')).toContainText('done');

  // Each run's terminal is its own, from the prompt the app typed into it.
  await tab('Acme Robotics · Tailored resume').click();
  await expect
    .poll(() => terminalStart(window))
    .toContain('/factwright:focused-resume job acme-robotics--staff-engineer new version');
  await tab('Tidewater Analytics · Tailored resume').click();
  await expect
    .poll(() => terminalStart(window))
    .toContain('/factwright:focused-resume job tidewater-analytics--senior-backend-engineer');
  expect(await terminalStart(window)).not.toContain('acme-robotics');

  // Close puts each away. The one left is alone, with no tabs, and the panel goes with it.
  for (const name of [
    'Tidewater Analytics · Tailored resume',
    'Tidewater Analytics · Cover letter',
  ]) {
    await tab(name).click();
    await claudePanel().getByRole('button', { name: 'Close' }).click();
  }
  await expect(tabs()).toHaveCount(0);
  await expect(claudePanel()).toContainText('Acme Robotics · Tailored resume');
  await claudePanel().getByRole('button', { name: 'Close' }).click();
  await expect(claudePanel()).toHaveCount(0);
  await expect(jobRow('Acme Robotics')).not.toContainText('Claude is on it');
});

test('takes a task out of line when its tab is closed', async () => {
  const { window } = opened;
  await jobRow('Tidewater Analytics').click();
  await jobPanel()
    .getByRole('region', { name: 'Resumes and cover letters' })
    .getByRole('button', { name: 'Tailor a resume' })
    .click();
  const asks = window.getByRole('dialog', { name: 'Claude has 2 questions' });
  await asks.getByRole('button', { name: 'Not now' }).click();
  await jobPanel().getByRole('button', { name: 'Write a cover letter' }).click();
  const waiting = tab('Tidewater Analytics · Cover letter');
  await expect(waiting).toContainText('in line');
  await waiting.click();
  await claudePanel().getByRole('button', { name: 'Close' }).click();
  // The run left is alone again, with no tabs, and its questions still wait in its bar.
  await expect(tabs()).toHaveCount(0);
  await expect(claudePanel()).toContainText('Claude is waiting for your answer to 2 questions.');
  await expect(jobPanel().getByRole('button', { name: 'Write a cover letter' })).toBeEnabled();
  // Stopping it leaves its tab saying so, until it's closed.
  await claudePanel().getByRole('button', { name: 'Stop' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Stopped');
  await claudePanel().getByRole('button', { name: 'Close' }).click();
  await expect(claudePanel()).toHaveCount(0);
});

test('shows where a run is in its working strip: its step on Claude’s to-do list, and its helpers at work', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: 'Find jobs' }).click();
  await window
    .getByRole('dialog', { name: 'Find jobs' })
    .getByRole('button', { name: /^Search/ })
    .click();
  const status = claudePanel().getByRole('status').first();
  await expect(status).toHaveText('Done');
  // A follow-up typed into its terminal makes a to-do list, then starts two helpers in the
  // background and ends its turn while they work.
  await showWork(window);
  const typing = claudePanel().locator('[data-shown] .xterm-helper-textarea');
  await typing.pressSequentially('plan it with helpers');
  await typing.press('Enter');
  // Its turn is over, but with its helpers at work, the run isn't done.
  await expect
    .poll(() => terminalText(window))
    .toContain('Two helpers are filtering the listings.');
  await expect(status).toHaveText('Working');
  await expect(claudePanel()).toContainText('Step 2 of 3: Filtering the listings');
  await expect(claudePanel()).toContainText('2 helpers going through the jobs');
  // Its picture, which a narrow bar leaves out for the words.
  await expect(claudePanel().locator('[data-scene]')).toHaveAttribute('data-scene', 'helpers');
  // They're back, Claude finishes the list, and the run is done, with no strip.
  await typing.pressSequentially('go on');
  await typing.press('Enter');
  await expect(status).toHaveText('Done');
  await expect(claudePanel().locator('[data-scene]')).toHaveCount(0);
  await claudePanel().getByRole('button', { name: 'Close' }).click();
  await expect(claudePanel()).toHaveCount(0);
});
