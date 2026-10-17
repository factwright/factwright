import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type Opened, openApp, terminalText } from './app.ts';
import { version } from './paths.ts';
import { ACME_FOLDER, ACME_RESUME, ACME_WORD, newDataFolder } from './workspace.ts';

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
// runs them has one, as Factwright's own releases are built with. The browser extension saves
// through sync, so only a copy with sync links to it.
test('says sync isn’t in a copy built without a sync server', async () => {
  const sync = opened.window.getByRole('region', { name: 'Sync' });
  const extension = opened.window.getByRole('link', { name: 'Browser extension' });
  if (process.env.FACTWRIGHT_SYNC_SERVER) {
    await expect(sync.getByRole('button', { name: 'Turn on…' })).toBeVisible();
    // Not clicked: it would open factwright.com in the browser of whoever runs the tests.
    await expect(extension).toHaveAttribute('href', 'https://factwright.com/extension');
  } else {
    await expect(sync.getByText('Not in this copy')).toBeVisible();
    await expect(sync.getByRole('button')).toHaveCount(0);
    await expect(extension).toHaveCount(0);
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

test('X-rays a resume as applicant systems read it, its PDF and its Word file', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: `ATS X-ray of ${ACME_RESUME}` }).click();
  const dialog = window.getByRole('dialog', { name: 'ATS X-ray' });
  // pdf.js reads the PDF in the window, with its own worker, as it does for previews.
  await expect(dialog.getByText('Reads cleanly')).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'The text' })).toContainText(
    'Platform Engineering Lead 03/2021 – Present',
  );
  const pick = (name: string) =>
    dialog
      .locator('label')
      .filter({ has: window.getByRole('radio', { name, exact: true }) })
      .click();
  await pick('What it fills in');
  await expect(dialog.getByText('alex@example.com', { exact: true })).toBeVisible();
  await pick('Word');
  await expect(dialog).toContainText(`${ACME_WORD}, read the way`);
  await expect(dialog.getByText('Reads cleanly')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
});

test('writes a cover letter, and shows it to read, copy, preview and open', async () => {
  const { app, window } = opened;
  await jobPanel()
    .getByRole('button', { name: /^Cover letter/ })
    .click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  // The app types only the skill and the job. A letter is writing, so it gets Opus at extra high.
  expect(await terminalText(window)).toContain(`/factwright:cover-letter job ${ACME_ID}`);
  expect(await terminalText(window)).toContain('opus · xhigh effort');
  expect(await terminalText(window)).toContain('in the Classic template: 1 page');
  await closeRun();

  const letter = jobPanel().getByRole('region', { name: 'Cover letter' });
  await expect(
    letter.getByRole('article', { name: 'Cover letter for Acme Robotics' }),
  ).toContainText('I cut deploy time by ~40% at Tidewater');
  await letter.getByRole('button', { name: 'Copy text of the cover letter' }).click();
  await expect(letter.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(
    /^Dear Sam Lee,\n\nAcme’s posting asks .+\n\nBest regards,\nAlex Rivera$/s,
  );
  // Its PDF, printed in the job's resume template, previews as one page.
  await letter
    .getByRole('button', { name: 'Preview AlexRiveraCoverLetter10142026_Acme.pdf' })
    .click();
  const dialog = window.getByRole('dialog', { name: 'AlexRiveraCoverLetter10142026_Acme.pdf' });
  await expect(dialog.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(
    letter.getByRole('button', { name: 'Open AlexRiveraCoverLetter10142026_Acme.docx' }),
  ).toBeVisible();
  // The resume is still the resume, and the letter is its own.
  const files = jobPanel().getByRole('region', { name: 'Files' });
  await expect(files).toContainText('1 resume · 1 cover letter');
  expect(readdirSync(join(dataDir, 'workspace', ACME_FOLDER)).sort()).toEqual(
    expect.arrayContaining([
      'AlexRiveraCoverLetter10142026_Acme.docx',
      'AlexRiveraCoverLetter10142026_Acme.pdf',
      'cover-letter.json',
    ]),
  );
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

test('adds a call with who it’s with, preps for it, and keeps the prep sheet with the call', async () => {
  const { window } = opened;
  const calls = jobPanel().getByRole('region', { name: 'Calls and interviews' });
  await calls.getByRole('button', { name: 'Add a call' }).click();
  const form = calls.getByRole('form', { name: 'Add a call' });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = [tomorrow.getFullYear(), tomorrow.getMonth() + 1, tomorrow.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  await form.getByLabel('Date').fill(day);
  await form.getByLabel('How', { exact: true }).selectOption('video');
  await form.getByLabel('Meeting link').fill('https://meet.example.com/acme');
  await form.getByLabel('Name of person 1').fill('Dana Lee');
  await form.getByLabel('Role of person 1').fill('Hiring manager');
  await form.getByRole('button', { name: 'Add call' }).click();
  await expect(calls.getByText('With Dana Lee (Hiring manager)')).toBeVisible();
  // Adding a recruiter screen moves the job on.
  await expect(window.getByRole('combobox', { name: 'Status for Acme Robotics' })).toHaveValue(
    'screen',
  );

  await calls.getByRole('button', { name: 'Call prep for the recruiter screen' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  // The app types only the job's and the call's IDs; who it's with reaches Claude through its tools.
  const typed = await terminalText(window);
  expect(typed).toMatch(new RegExp(`/factwright:interview-prep job ${ACME_ID} call [0-9a-f-]{36}`));
  expect(typed).not.toContain('Dana Lee');
  await calls.getByRole('button', { name: 'Open the prep sheet for the recruiter screen' }).click();
  const sheet = window.getByRole('dialog', { name: /^Prep sheet: Recruiter screen/ });
  await expect(
    sheet.getByText('With Dana Lee (Hiring manager), from the stand-in Claude.'),
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(
    calls.getByRole('button', { name: 'Prep again for the recruiter screen' }),
  ).toBeVisible();
});

test('fills in a call from the company’s invite, read in the window', async () => {
  const calls = jobPanel().getByRole('region', { name: 'Calls and interviews' });
  await calls.getByRole('button', { name: 'Add a call' }).click();
  const form = calls.getByRole('form', { name: 'Add a call' });
  // 3:30 PM in UTC, which the form gives in this computer's time zone.
  const at = new Date(Date.UTC(2026, 10, 5, 15, 30));
  const pad = (part: number) => String(part).padStart(2, '0');
  const invite = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART:20261105T153000Z',
    'DURATION:PT45M',
    'LOCATION:https://zoom.us/j/8812345678',
    'ORGANIZER;CN=Priya Shah:mailto:priya@acme.example',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  await form.locator('input[type="file"]').setInputFiles({
    name: 'invite.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from(invite),
  });
  await expect(form.getByRole('status')).toHaveText(
    'Filled in the date, time, length, meeting link and 1 person from the invite. Check them before you add it.',
  );
  await expect(form.getByLabel('Date')).toHaveValue(
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
  );
  await expect(form.getByLabel('Time, if you know it')).toHaveValue(
    `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  );
  await expect(form.getByLabel('Meeting link')).toHaveValue('https://zoom.us/j/8812345678');
  await expect(form.getByLabel('Name of person 1')).toHaveValue('Priya Shah');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(form).toBeHidden();
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

test('asks the user’s OK in a dialog, and saves to their profile only once they allow it', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: 'Find jobs' }).click();
  await window
    .getByRole('dialog', { name: 'Find jobs' })
    .getByRole('button', { name: /^Search/ })
    .click();
  const panel = claudePanel();
  await expect(panel.getByRole('status').first()).toHaveText('Done');
  const typing = panel.locator('.xterm-helper-textarea');
  const ask = async () => {
    await typing.pressSequentially('save my notice period');
    await typing.press('Enter');
    return window.getByRole('dialog', { name: 'Let Claude save this to your profile?' });
  };
  // Allowed, it's saved.
  const first = await ask();
  await expect(first).toContainText('When you can start');
  await expect(first).toContainText('Two weeks’ notice');
  await expect(panel.getByRole('status').first()).toHaveText('Needs your answer');
  await first.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(first).toHaveCount(0);
  await expect.poll(() => terminalText(window)).toContain('Saved to the user’s profile');
  await expect(panel.getByRole('status').first()).not.toHaveText('Needs your answer');
  // Said no to, with a note, it isn't, and Claude hears why.
  const second = await ask();
  await second.getByRole('button', { name: 'Tell Claude why not' }).click();
  await second.getByRole('textbox', { name: 'Note for Claude' }).fill('I said a month');
  await second.getByRole('button', { name: 'Don’t allow' }).click();
  await expect(second).toHaveCount(0);
  await expect
    .poll(() => terminalText(window))
    .toContain('Not saved: The user said no, in Factwright, and added: I said a month');
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

test('reads and changes the fact bank: a fact’s words, verifying one, and a new fact', async () => {
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

  // A fact drafted from the user's files waits at the top, to verify.
  const toVerify = window.getByRole('region', { name: 'Unverified' });
  await expect(toVerify.getByRole('article', { name: 'Dispatch alerts' })).toContainText(
    'From your resume alex.pdf',
  );
  await toVerify.getByRole('button', { name: 'Verify “Dispatch alerts”' }).click();
  await expect(toVerify).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Verify “Dispatch alerts”' })).toHaveCount(0);
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

test('saves what the user answers while Claude tailors a resume, unverified, and nothing planted', async () => {
  const { window } = opened;
  const facts = join(dataDir, 'workspace', 'facts');
  const file = join(facts, 'larkspur-logistics.md');
  const gaps = join(facts, 'gaps.md');
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Jobs/ })
    .click();
  await pickView(/^All/);
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await jobPanel()
    .getByRole('button', { name: /^Tailored resume/ })
    .click();
  const panel = claudePanel();
  // The stand-in asks two questions in one round, which open in the app's dialog rather than the
  // terminal. Put aside, the round waits in Claude's panel.
  const asks = window.getByRole('dialog', { name: 'Claude has 2 questions' });
  await expect(asks).toContainText('From your Claude, working on Tailored resume · Acme Robotics.');
  // The user says yes to one, puts the round aside, and comes back to it as they left it.
  const graphql = asks
    .getByRole('group', { name: /Have you used GraphQL/ })
    .getByRole('radio', { name: 'Yes, in production', exact: true });
  await graphql.check();
  await asks.getByRole('button', { name: 'Not now' }).click();
  await expect(asks).toHaveCount(0);
  await expect(panel.getByText(/waiting for your answer to 2 questions/)).toBeVisible();
  await panel.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(graphql).toBeChecked();
  // They say no to the other, and the stand-in tries to save a fact the user never gave.
  await asks
    .getByRole('group', { name: /Have you run Kafka/ })
    .getByRole('radio', { name: 'No', exact: true })
    .check();
  await asks.getByRole('button', { name: 'Send answers' }).click();
  await expect(asks).toHaveCount(0);
  await expect.poll(() => terminalText(window)).toContain("User answered Claude's questions");
  await expect(panel.getByText('1 new fact to verify')).toBeVisible();
  await expect(panel.getByRole('status').filter({ hasText: 'new fact to verify' })).toHaveText(
    '1 new fact to verify: “GraphQL for the driver app”, from your answers. Also noted 1 thing you don’t have.',
  );
  await expect
    .poll(() => terminalText(window))
    .toContain('Factwright has no record of the user answering');
  await expect.poll(() => terminalText(window)).toContain('only from your own call');
  const text = readFileSync(file, 'utf8');
  expect(text).toMatch(
    /### GraphQL for the driver app\n`unconfirmed` `live` `solo` `medium`\n> Built the driver app’s GraphQL API\.\n- \*\*Keywords:\*\* GraphQL\n- \*\*Source:\*\* answer \d{4}-\d{2}-\d{2}, tailoring a resume for Acme Robotics\n- \*\*Question:\*\* The posting wants GraphQL\. Have you used GraphQL\?\n- \*\*Answer:\*\* Yes, in production\n/,
  );
  expect(text).not.toContain('Led a big team');
  expect(readFileSync(gaps, 'utf8')).toMatch(
    /\| Kafka \| No \(asked “The posting wants Kafka\. Have you run Kafka, or another event-streaming platform\?” while tailoring a resume for Acme Robotics\) \| \d{4}-\d{2}-\d{2} \|/,
  );
  // The sidebar says there's a fact to verify, and the panel goes to it.
  await expect(
    window.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Fact bank/ }),
  ).toHaveAccessibleName('Fact bank 1 to verify');
  await panel.getByRole('button', { name: 'Verify them' }).click();
  const toVerify = window.getByRole('region', { name: 'Unverified' });
  const answered = toVerify.getByRole('article', { name: 'GraphQL for the driver app' });
  await expect(answered).toContainText('Your answer while tailoring a resume for Acme Robotics');
  await expect(answered).toContainText('“Yes, in production”');
  await answered.getByRole('button', { name: 'Verify “GraphQL for the driver app”' }).click();
  await expect(toVerify).toHaveCount(0);
  expect(readFileSync(file, 'utf8')).toMatch(
    /### GraphQL for the driver app\n`live` `solo` `medium`\n[^#]*- \*\*Source:\*\* \S+ \d{4}-\d{2}-\d{2}\n- \*\*Question:\*\*/,
  );
  // What they said they don't have can be taken back.
  await window
    .getByRole('navigation', { name: 'Your fact files' })
    .getByRole('button', { name: /^Gaps/ })
    .click();
  await window.getByRole('button', { name: 'Remove “Kafka”' }).click();
  await expect(window.getByRole('button', { name: 'Remove “Kafka”' })).toHaveCount(0);
  expect(readFileSync(gaps, 'utf8')).not.toContain('Kafka');
  await closeRun();
});

test('keeps everything tracked after a restart', async () => {
  await opened.app.close();
  opened = await openApp(dataDir);
  const { window } = opened;
  await pickView(/^All/);
  await expect(window.getByRole('button', { name: /^Northwind Labs/ })).toBeVisible();
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await expect(window.getByRole('combobox', { name: 'Status for Acme Robotics' })).toHaveValue(
    'screen',
  );
  await expect(jobPanel().getByRole('list', { name: 'Your notes' })).toContainText(
    'Recruiter: Sam',
  );
  // The call keeps who it's with, and Claude's prep sheet for it.
  const calls = jobPanel().getByRole('region', { name: 'Calls and interviews' });
  await expect(calls.getByText('With Dana Lee (Hiring manager)')).toBeVisible();
  await expect(
    calls.getByRole('button', { name: 'Open the prep sheet for the recruiter screen' }),
  ).toBeVisible();
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
  // The terminal is outlined, as the place to answer.
  const outlined = panel.locator('[class*="attention"]');
  await expect(outlined).toHaveCount(1);
  await panel.locator('.xterm-helper-textarea').press('Enter');
  await expect(panel.getByRole('note')).toHaveCount(0);
  await expect(outlined).toHaveCount(0);
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
