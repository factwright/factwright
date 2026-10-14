import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type Opened, openApp, terminalText } from './app.ts';
import { version } from './paths.ts';
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
const jobPanel = () => opened.window.locator('aside[aria-label="Job details"]');
const ACME_ID = 'acme-robotics--staff-engineer';

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

// The tests' build is made without FACTWRIGHT_SYNC_SERVER, as a fork's is, unless the shell that
// runs them has one, as Factwright's own releases are built with.
test('says sync isn’t in a copy built without a sync server', async () => {
  const sync = opened.window.getByRole('region', { name: 'Sync' });
  if (process.env.FACTWRIGHT_SYNC_SERVER) {
    await expect(sync.getByRole('button', { name: 'Turn on…' })).toBeVisible();
  } else {
    await expect(sync.getByText('Not in this copy')).toBeVisible();
    await expect(sync.getByRole('button')).toHaveCount(0);
  }
});

test('shows the jobs on file, your Claude ready, a way to support Factwright, and its version', async () => {
  const { window } = opened;
  // It opens on the jobs furthest along: Acme, with Claude's fit check and a resume, is to review.
  await expect(window.getByRole('button', { name: /^Acme Robotics/ })).toBeVisible();
  await expect(window.getByText('Signed in · Max plan')).toBeVisible();
  await expect(window.getByRole('button', { name: /^Claude’s levels/ })).toHaveAccessibleName(
    'Claude’s levels: Opus · Extra high. Job searches at High.',
  );
  // Not clicked: it would open Buy Me a Coffee in the browser of whoever runs the tests.
  await expect(window.getByRole('link', { name: 'Support Factwright' })).toHaveAttribute(
    'href',
    'https://buymeacoffee.com/stevehillyer',
  );
  await expect(window.getByText(`Factwright ${version}`)).toBeVisible();
  // A job the search found, which nobody has touched, is new.
  await pickView(/^New/);
  await expect(window.getByRole('button', { name: /^Tidewater Analytics/ })).toBeVisible();
  await pickView(/^To review/);
});

test('scrolls only its panes, never the window, however far the list runs', async () => {
  const { app, window } = opened;
  const zoom = (factor: number) =>
    app.evaluate(
      ({ BrowserWindow }, by) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(by),
      factor,
    );
  // Zoomed in, the list runs well past the window's bottom edge.
  await zoom(2.5);
  await pickView(/^All/);
  await expect.poll(() => window.evaluate<number>('innerHeight')).toBeLessThan(400);
  const page = await window.evaluate<{ scrollHeight: number; clientHeight: number }>(
    '({ scrollHeight: document.scrollingElement.scrollHeight, clientHeight: document.scrollingElement.clientHeight })',
  );
  await zoom(1);
  expect(page.scrollHeight).toBe(page.clientHeight);
  await pickView(/^To review/);
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

test('tracks a job: its status, dated, and a note', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await window.getByRole('combobox', { name: 'Status for Acme Robotics' }).selectOption('applied');
  await expect(window.getByRole('combobox', { name: 'Status for Acme Robotics' })).toHaveValue(
    'applied',
  );
  // The step it took shows in Progress, dated today, ready to fix.
  await expect(
    jobPanel().getByRole('button', { name: /^When you applied: .+\. Change it$/ }),
  ).toBeVisible();
  await jobPanel().getByRole('textbox', { name: 'New note' }).fill('Recruiter: Sam');
  await jobPanel().getByRole('button', { name: 'Add note' }).click();
  await expect(jobPanel().getByRole('list', { name: 'Your notes' })).toContainText(
    'Recruiter: Sam',
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
  // Answers are writing, so they get Opus and extra high effort on a Max plan, until the user
  // chooses otherwise.
  expect(await terminalText(window)).toContain('opus · xhigh effort');
  await closeRun();
});

test('keeps what was actually sent for a question', async () => {
  const answers = jobPanel().locator('section', {
    has: opened.window.getByRole('heading', { name: 'Application answers' }),
  });
  await answers.getByText('Why Acme?', { exact: true }).click();
  const box = answers.getByRole('textbox', { name: /What you sent/ });
  await box.fill('Deploys, mostly.');
  await box.blur();
  await expect(answers.getByText('Saved', { exact: true })).toBeVisible();
  await expect(answers.getByText('Sent', { exact: true })).toBeVisible();
});

test('answers a question about the job, and keeps the answer with it', async () => {
  const { window } = opened;
  await jobPanel().getByRole('button', { name: 'Ask a question' }).click();
  const dialog = window.getByRole('dialog', { name: 'Ask about Acme Robotics' });
  await dialog
    .getByRole('textbox', { name: 'Your question' })
    .fill('What should I expect from the recruiter screen?');
  await dialog.getByRole('button', { name: 'Ask Claude' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  // The app types only the skill and the job; the question reaches Claude through its tools.
  expect(await terminalText(window)).toContain(`/factwright:ask job ${ACME_ID}`);
  expect(await terminalText(window)).not.toContain('recruiter screen');
  const asked = jobPanel().locator('section', {
    has: window.getByRole('heading', { name: 'Ask Claude' }),
  });
  await expect(asked.getByText('Answered')).toBeVisible();
  await expect(asked.getByText('A short screen, from the stand-in Claude.')).toBeVisible();
  // Asked again, Claude answers it again, in place of the first answer.
  await asked.getByRole('button', { name: 'Ask again' }).click();
  await expect(asked.getByText('A short screen, from the stand-in Claude. Again.')).toBeVisible();
  expect(await terminalText(window)).toMatch(/\/factwright:ask job \S+ question 20\d\d-/);
});

test('keeps a picture pasted into Claude’s panel with the run’s job, for Claude to read', async () => {
  const { window } = opened;
  // A picture on the clipboard, pasted into the terminal, as the system hands it to the page.
  await window.evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
    const pasted = new DataTransfer();
    pasted.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    const input = document.querySelector('section[aria-label="Claude"] .xterm-helper-textarea');
    input.focus();
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: pasted, bubbles: true, cancelable: true }),
    );
  })()`);
  const shots = join(dataDir, 'workspace', 'screenshots', ACME_ID);
  await expect
    .poll(() => {
      try {
        return readdirSync(shots);
      } catch {
        return [];
      }
    })
    .toEqual([expect.stringMatching(/^pasted-\d{4}-\d{2}-\d{2}-\d{6}-1\.png$/)]);
  await claudePanel().locator('.xterm-helper-textarea').press('Enter');
  await expect.poll(() => terminalText(window)).toContain('pasted-');
  await closeRun();
});

test('finds jobs where the user picks, and keeps each search’s jobs together', async () => {
  const { window } = opened;
  // Done with Acme. In a narrow window, a job's details cover the page's buttons.
  await window.getByRole('button', { name: 'Close details' }).click();
  await window.getByRole('button', { name: 'Find jobs' }).click();
  const dialog = window.getByRole('dialog', { name: 'Find jobs' });
  await dialog.getByRole('checkbox', { name: /^LinkedIn/ }).check();
  await dialog.getByRole('button', { name: 'Search 2 places' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  // The app types the places picked, in its own words.
  expect(await terminalText(window)).toContain('/factwright:job-search HN · LinkedIn');
  // A search reads a lot and weighs it lightly, so it thinks at high.
  expect(await terminalText(window)).toContain('opus · high effort');
  await closeRun();
  // The LinkedIn search's job is new, saying which search found it now there are two, and the
  // search can be picked on its own.
  await pickView(/^New/);
  await expect(window.getByRole('button', { name: /^Lakeside Data/ })).toContainText(
    'LinkedIn Oct 12',
  );
  await window
    .getByRole('combobox', { name: 'Found by' })
    .selectOption({ label: 'LinkedIn Oct 12 (1)' });
  await expect(window.getByRole('button', { name: /^Lakeside Data/ })).toBeVisible();
  await expect(window.getByRole('button', { name: /^Tidewater Analytics/ })).toHaveCount(0);
  await window
    .getByRole('combobox', { name: 'Found by' })
    .selectOption({ label: 'Found anywhere' });
});

test('adds a job by hand', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: 'Add job' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add a job' });
  await dialog.getByRole('textbox', { name: 'Company' }).fill('Northwind Labs');
  await dialog.getByRole('button', { name: 'Add job' }).click();
  await expect(window.getByRole('button', { name: /^Northwind Labs/ })).toBeVisible();
});

test('passes on several new jobs at once, saying why, and keeps why for the job search', async () => {
  const { window } = opened;
  await pickView(/^New/);
  await window.getByRole('checkbox', { name: /^Select Tidewater Analytics/ }).click();
  await window.getByRole('checkbox', { name: /^Select Lakeside Data/ }).click();
  const bar = window.getByRole('region', { name: 'Selected jobs' });
  await expect(bar).toContainText('2 jobs selected');
  await bar.getByRole('button', { name: 'Pass' }).click();
  await expect(window.getByRole('status').filter({ hasText: 'Passed on 2 jobs.' })).toBeVisible();
  await window
    .getByRole('group', { name: 'Why you passed' })
    .getByRole('button', { name: 'Pay' })
    .click();
  await expect(
    window.getByRole('group', { name: 'Why you passed' }).getByRole('button', { name: 'Pay' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await window.getByRole('button', { name: 'Done' }).click();
  await pickView(/^Closed/);
  await expect(window.getByRole('button', { name: /^Tidewater Analytics.*Passed/ })).toBeVisible();
  await expect(window.getByRole('button', { name: /^Lakeside Data.*Passed/ })).toBeVisible();
});

test('reads and changes the fact bank: a fact’s words, a confirmation, and a new fact', async () => {
  const { window } = opened;
  // The fact bank, as getting started would have drafted it.
  const facts = join(dataDir, 'workspace', 'facts');
  const file = join(facts, 'larkspur-logistics.md');
  mkdirSync(facts, { recursive: true });
  writeFileSync(
    file,
    [
      '# Larkspur Logistics',
      '',
      '## Overview',
      'Senior engineer, 2019–2024.',
      '',
      '### Route planner',
      '`live` `led-and-built` `high`',
      '> Built a route planner used by 300 drivers.',
      '- **Source:** Alex 2026-10-01',
      '',
      '### Dispatch alerts',
      '`unconfirmed` `shipped` `solo` `medium`',
      '> Shipped dispatch alerts that cut late pickups.',
      '- **Source:** resume alex.pdf 2026-10-10',
      '',
    ].join('\n'),
  );
  const read = () => readFileSync(file, 'utf8');
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Fact bank/ })
    .click();
  await expect(window.getByRole('heading', { name: 'Larkspur Logistics', level: 2 })).toBeVisible();

  const planner = window.getByRole('article', { name: 'Route planner' });
  await planner.getByRole('button', { name: 'Change “Route planner”' }).click();
  const form = window.getByRole('form', { name: 'Change “Route planner”' });
  await form
    .getByRole('textbox', { name: 'What resumes say' })
    .fill('Built a route planner used by 320 drivers.');
  await form.getByRole('combobox', { name: 'Status' }).selectOption('shipped');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(planner).toContainText('320 drivers');
  expect(read()).toContain(
    '### Route planner\n`shipped` `led-and-built` `high`\n> Built a route planner used by 320 drivers.\n- **Source:** Alex 2026-10-01\n\n### Dispatch alerts',
  );

  await window.getByRole('button', { name: 'Confirm “Dispatch alerts”' }).click();
  await expect(window.getByRole('button', { name: 'Confirm “Dispatch alerts”' })).toHaveCount(0);
  expect(read()).toMatch(
    /### Dispatch alerts\n`shipped` `solo` `medium`\n> Shipped dispatch alerts that cut late pickups\.\n- \*\*Source:\*\* \S+ \d{4}-\d{2}-\d{2}\n/,
  );

  await window.getByRole('button', { name: 'Add a fact' }).click();
  const added = window.getByRole('form', { name: 'New fact' });
  await added.getByRole('textbox', { name: 'Title' }).fill('Driver app');
  await added.getByRole('textbox', { name: 'What resumes say' }).fill('Shipped a driver app.');
  await added.getByRole('combobox', { name: 'Status' }).selectOption('shipped');
  await added.getByRole('button', { name: 'Save' }).click();
  await expect(window.getByRole('article', { name: 'Driver app' })).toBeVisible();
  expect(read()).toMatch(
    /\n\n### Driver app\n`shipped`\n> Shipped a driver app\.\n- \*\*Source:\*\* /,
  );

  // The sidebar counts them, and the jobs are where they were.
  await expect(
    window.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Fact bank/ }),
  ).toContainText('3');
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Jobs/ })
    .click();
  await expect(window.getByRole('heading', { name: 'Jobs' })).toBeVisible();
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
  await expect(jobPanel().getByRole('list', { name: 'Your notes' })).toContainText(
    'Recruiter: Sam',
  );
  await jobPanel().getByText('Why Acme?', { exact: true }).click();
  await expect(jobPanel().getByRole('textbox', { name: /What you sent/ })).toHaveValue(
    'Deploys, mostly.',
  );
  // Why the user passed stays with the job.
  await window.getByRole('button', { name: /^Tidewater Analytics/ }).click();
  await expect(
    jobPanel()
      .getByRole('region', { name: 'Why did you pass?' })
      .getByRole('button', { name: 'Pay' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('explains the first run’s question about trusting the workspace', async () => {
  await opened.app.close();
  opened = await openApp(dataDir, { FAKE_CLAUDE_TRUST: 'ask' });
  const { window } = opened;
  await window.getByRole('button', { name: 'Find jobs' }).click();
  await window
    .getByRole('dialog', { name: 'Find jobs' })
    .getByRole('button', { name: /^Search/ })
    .click();
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

test('suits Claude’s levels to a Pro plan, once Claude Code signs in on one', async () => {
  await opened.app.close();
  opened = await openApp(dataDir, { FAKE_CLAUDE_PLAN: 'pro' });
  const { window } = opened;
  await expect(window.getByText('Signed in · Pro plan')).toBeVisible();
  const levels = window.getByRole('button', { name: /^Claude’s levels/ });
  await expect(levels).toHaveAccessibleName('Claude’s levels: Opus · High. Lighter for 4 tasks.');
  await levels.hover();
  await expect(window.getByRole('tooltip')).toContainText('Best on your Pro plan');
  // A fit check is one of the routine tasks, which start on Sonnet with Pro's levels.
  await pickView(/^All/);
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await jobPanel()
    .getByRole('button', { name: /^Fit check/ })
    .click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  expect(await terminalText(window)).toContain('sonnet · high effort');
  await closeRun();
});
