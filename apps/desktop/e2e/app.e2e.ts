import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
// pdf.js's build for Node, as the ATS X-ray's tests read PDFs.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  type Opened,
  openApp,
  showWork,
  terminalLines,
  terminalStart,
  terminalText,
} from './app.ts';
import { version } from './paths.ts';
import {
  ACME_FOLDER,
  ACME_RESUME,
  ACME_WORD,
  HARBOR_FORM,
  HARBOR_POSTING,
  newDataFolder,
  usersClaude,
} from './workspace.ts';

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

/**
 * Closes Claude's panel once its run is done, ready for the next: Close quits Claude Code and puts
 * the panel away in one click. Stop is only for a run that's still going.
 */
async function closeRun() {
  const panel = claudePanel();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
}

// The tests' build is made without FACTWRIGHT_SYNC_SERVER, as a fork's is, unless the shell that
// runs them has one, as Factwright's own releases are built with.
test('offers only a server of your own in a copy built without Factwright’s sync', async () => {
  const { window } = opened;
  const sync = window.getByRole('region', { name: 'Sync' });
  await sync.getByRole('button', { name: 'Turn on…' }).click();
  const own = window.getByRole('region', { name: 'Your own server' });
  await expect(own.getByRole('button', { name: 'Connect your server…' })).toBeVisible();
  const factwright = window.getByRole('region', { name: 'Factwright’s sync' });
  if (process.env.FACTWRIGHT_SYNC_SERVER) await expect(factwright).toBeVisible();
  else await expect(factwright).toHaveCount(0);
  await window.getByRole('button', { name: 'Not now' }).click();
  await expect(window.getByRole('dialog')).toHaveCount(0);
});

// Saving to this computer needs no sync, so every copy offers the extension's window. One the
// tests drive leaves the browsers on the computer that runs them as they are.
test('opens the Browser extension window from the sidebar, leaving the browsers alone', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: 'Browser extension' }).click();
  const dialog = window.getByRole('dialog', { name: 'Browser extension' });
  // Not clicked: it would open factwright.com in the browser of whoever runs the tests.
  await expect(dialog.getByRole('link', { name: 'Factwright’s extension page' })).toHaveAttribute(
    'href',
    'https://factwright.com/extension',
  );
  await expect(dialog.getByText(/leaves your browsers as they are/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(window.getByRole('dialog')).toHaveCount(0);
});

test('shows the jobs on file, your Claude ready, ways to support Factwright and report a problem, and its version', async () => {
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
  // Not clicked either: it would open a draft in the mail app of whoever runs the tests.
  const report = await window.getByRole('link', { name: 'Report a problem' }).getAttribute('href');
  expect(new URL(report ?? '').searchParams.get('subject')).toBe(
    `A problem in Factwright ${version}`,
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

/** The jobs list's first heading, and the box that scrolls the list sideways, in the page. */
const LIST = `(() => {
  const job = document.querySelector('button[aria-label="Sort by job"]');
  let box = job.parentElement;
  while (getComputedStyle(box).overflowX !== 'auto') box = box.parentElement;
  return { job, box };
})()`;

test('keeps every column’s heading, scrolling the list sideways beside a job with the names pinned', async () => {
  const { window } = opened;
  await pickView(/^All/);
  // No job picked, no job's panel: the list has the room.
  await expect(window.getByRole('complementary', { name: 'Job details' })).toHaveCount(0);
  const headings = ['job', 'status', 'fit', 'pay', 'next step', 'added'];
  for (const heading of headings) {
    await expect(window.getByRole('button', { name: `Sort by ${heading}` })).toBeAttached();
  }
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await expect(jobPanel()).toBeVisible();
  // Every heading is still there, and the list scrolls sideways to them, with a fade at its edge.
  for (const heading of headings) {
    await expect(window.getByRole('button', { name: `Sort by ${heading}` })).toBeAttached();
  }
  /**
   * Where the list stands, as it scrolls: the job column's heading and a job's name in it, the
   * next heading, and the last heading's right edge.
   */
  const where = () =>
    window.evaluate<{
      scrolls: boolean;
      more: boolean;
      job: number;
      name: number;
      status: number;
      added: number;
      right: number;
    }>(
      `(() => {
        const { job, box } = ${LIST};
        const left = (element) => Math.round(element.getBoundingClientRect().left);
        const added = document.querySelector('[aria-label^="Sort by added"], [aria-label^="Added,"]');
        const row = [...document.querySelectorAll('ul[aria-label="Jobs"] button')].find((each) =>
          each.textContent.startsWith('Acme Robotics'),
        );
        return {
          scrolls: box.scrollWidth > box.clientWidth,
          more: box.parentElement.hasAttribute('data-more'),
          job: left(job),
          name: left(row.firstElementChild),
          status: left(document.querySelector('button[aria-label="Sort by status"]')),
          added: Math.round(added.getBoundingClientRect().right),
          right: Math.round(box.getBoundingClientRect().right),
        };
      })()`,
    );
  const before = await where();
  expect(before).toMatchObject({ scrolls: true, more: true });
  expect(before.added).toBeGreaterThan(before.right);
  await window.evaluate(`(() => {
    const { box } = ${LIST};
    box.scrollTo({ left: box.scrollWidth });
  })()`);
  // Scrolled to the end, the jobs' names stay where they were, and the last column is in view.
  await expect.poll(async () => (await where()).more).toBe(false);
  const after = await where();
  expect(after.status).toBeLessThan(before.status);
  expect(after.job).toBe(before.job);
  expect(after.name).toBe(before.name);
  expect(after.added).toBeLessThanOrEqual(after.right);
  // Added sorts the list by the day each job was found or saved, newest first. In a narrow
  // window the job's panel is over the list, so it closes first.
  await jobPanel().getByRole('button', { name: 'Close details' }).click();
  /** The day each job in the list was added, in the list's order, as times. */
  const days = async () =>
    (await window.getByRole('list', { name: 'Jobs' }).getByRole('button').allTextContents()).map(
      (text) => {
        const [, month, day, year] = /Added (\w{3}) (\d{1,2})(?:, (\d{4}))?$/.exec(text) ?? [];
        return Date.parse(`${month} ${day}, ${year ?? new Date().getFullYear()}`);
      },
    );
  await window.getByRole('button', { name: 'Sort by added' }).click();
  await expect(window.getByRole('button', { name: 'Added, sorted newest first' })).toBeVisible();
  const newest = await days();
  expect(new Set(newest).size).toBeGreaterThan(1);
  expect(newest).toEqual([...newest].sort((a, b) => b - a));
  await window.getByRole('button', { name: 'Added, sorted newest first' }).click();
  await expect(window.getByRole('button', { name: 'Added, sorted oldest first' })).toBeVisible();
  expect(await days()).toEqual([...newest].sort((a, b) => a - b));
  // Back to the newest activity first, as the other tests expect.
  await window.getByRole('button', { name: 'Added, sorted oldest first' }).click();
  await expect(window.getByRole('button', { name: 'Sort by added' })).toBeVisible();
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

// The save dialog and Finder are stood in for, so nothing opens on the screen of whoever runs the
// tests: the dialog picks a file in the test's own folder, and showing a file is only noted.
test('saves a copy of a resume where the user picks, and shows it where it’s kept', async () => {
  const { app, window } = opened;
  const resume = join(dataDir, 'workspace', ...ACME_FOLDER.split('/'), ACME_RESUME);
  const copy = join(dataDir, 'saved', ACME_RESUME);
  mkdirSync(join(dataDir, 'saved'), { recursive: true });
  await app.evaluate(({ dialog, shell }, to) => {
    const noted = globalThis as unknown as {
      suggested: string[];
      shown: string[];
      real: { save: typeof dialog.showSaveDialog; show: typeof shell.showItemInFolder };
    };
    noted.suggested = [];
    noted.shown = [];
    noted.real = { save: dialog.showSaveDialog, show: shell.showItemInFolder };
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      noted.suggested.push((args.at(-1) as { defaultPath?: string }).defaultPath ?? '');
      return { canceled: false, filePath: to };
    }) as typeof dialog.showSaveDialog;
    shell.showItemInFolder = (path: string) => {
      noted.shown.push(path);
    };
  }, copy);
  const noted = () =>
    app.evaluate(() => {
      const { suggested, shown } = globalThis as unknown as {
        suggested: string[];
        shown: string[];
      };
      return { suggested, shown };
    });
  await window.getByRole('button', { name: `Download ${ACME_RESUME}` }).click();
  await expect.poll(() => existsSync(copy)).toBe(true);
  expect(readFileSync(copy).equals(readFileSync(resume))).toBe(true);
  // The dialog suggests the file's own name.
  expect((await noted()).suggested).toEqual([expect.stringMatching(new RegExp(`${ACME_RESUME}$`))]);
  const shown =
    process.platform === 'darwin'
      ? `Show ${ACME_RESUME} in Finder`
      : `Show ${ACME_RESUME} in its folder`;
  await window.getByRole('button', { name: shown }).click();
  // On a Mac, the app knows the tests' folder by its real path, under /private.
  await expect
    .poll(async () => (await noted()).shown.map((path) => realpathSync(path)))
    .toEqual([realpathSync(resume)]);
  // Only a file the job lists: nothing else in the workspace, and nothing outside it.
  for (const path of ['facts/profile.md', `${ACME_FOLDER}/job.md`, '../tracker.db']) {
    const refused = await window.evaluate(
      ([job, file]) =>
        (
          globalThis as unknown as {
            factwright: { downloadFile: (job: string, file: string) => Promise<unknown> };
          }
        ).factwright.downloadFile(job ?? '', file ?? ''),
      [ACME_ID, path],
    );
    expect(refused).toEqual({ ok: false, message: 'That file isn’t in your workspace anymore.' });
  }
  expect((await noted()).suggested).toHaveLength(1);
  await app.evaluate(({ dialog, shell }) => {
    const { real } = globalThis as unknown as {
      real: { save: typeof dialog.showSaveDialog; show: typeof shell.showItemInFolder };
    };
    dialog.showSaveDialog = real.save;
    shell.showItemInFolder = real.show;
  });
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
  await jobPanel().getByRole('button', { name: 'Write a cover letter' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  // The bar says what Claude made, with Claude's work folded away under it, and opens it.
  await expect(claudePanel()).toContainText('Your cover letter for Acme Robotics is ready.');
  await expect(claudePanel().getByRole('button', { name: 'Show Claude’s work' })).toBeVisible();
  await claudePanel().getByRole('button', { name: 'Open it' }).click();
  await expect(
    jobPanel().getByRole('region', { name: 'Resumes and cover letters' }),
  ).toBeInViewport();
  // The app types only the skill and the job. A letter is writing, so it gets Opus at extra high.
  expect(await terminalText(window)).toContain(`/factwright:cover-letter job ${ACME_ID}`);
  await expect.poll(() => terminalStart(window)).toContain('opus · xhigh effort');
  expect(await terminalLines(window)).toContain('in the Classic template: 1 page');
  // Its card lists each file the task made, by Claude's own edit or through the tool that built
  // the letter, each with Undo.
  const changed = claudePanel().getByRole('list', { name: 'Files Claude changed' });
  await expect(changed.getByRole('listitem')).toHaveCount(3);
  for (const file of [
    'cover-letter.json',
    'AlexRiveraCoverLetter10142026_Acme.pdf',
    'AlexRiveraCoverLetter10142026_Acme.docx',
  ]) {
    await expect(
      claudePanel().getByRole('button', { name: `Undo ${ACME_FOLDER}/${file}` }),
    ).toBeVisible();
  }
  await expect(changed).toContainText('New · PDF');
  await closeRun();

  const letter = jobPanel().getByRole('region', { name: 'Cover letter', exact: true });
  // The letter reads folded, until it's opened.
  await letter.getByText('Read the letter').click();
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
  // The PDF reads from the top, as applicant systems read it: the name and contact details, then
  // the letter. Chromium writes positioned elements last, so the letter is positioned like its
  // header, or the header would come last, after the signature.
  const loading = getDocument({
    data: new Uint8Array(
      readFileSync(
        join(dataDir, 'workspace', ACME_FOLDER, 'AlexRiveraCoverLetter10142026_Acme.pdf'),
      ),
    ),
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const page = await (await loading.promise).getPage(1);
    const { items } = await page.getTextContent({ disableNormalization: true });
    const text = items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .toLowerCase();
    for (const header of ['alex rivera', 'alex@example.com']) {
      expect(text.indexOf(header)).toBeGreaterThanOrEqual(0);
      expect(text.indexOf(header)).toBeLessThan(text.indexOf('dear sam lee'));
    }
  } finally {
    await loading.destroy();
  }
  await expect(
    letter.getByRole('button', { name: 'Open AlexRiveraCoverLetter10142026_Acme.docx' }),
  ).toBeVisible();
  // The resume is still the resume, and the letter is its own.
  const files = jobPanel().getByRole('region', { name: 'Resumes and cover letters' });
  await expect(files).toContainText('1 resume · 1 cover letter');
  expect(readdirSync(join(dataDir, 'workspace', ACME_FOLDER)).sort()).toEqual(
    expect.arrayContaining([
      'AlexRiveraCoverLetter10142026_Acme.docx',
      'AlexRiveraCoverLetter10142026_Acme.pdf',
      'cover-letter.json',
    ]),
  );
});

test('makes a Projects page, printed as cards in the resume’s template, to preview and open', async () => {
  const { window } = opened;
  // A Projects page is offered for a posting that asks for samples of the user's work.
  const files = jobPanel().getByRole('region', { name: 'Resumes and cover letters' });
  await expect(files.getByRole('button', { name: 'Make a Projects page' })).toHaveCount(0);
  writeFileSync(
    join(dataDir, 'workspace', ACME_FOLDER, 'apply.md'),
    'Send links to your projects with the application.\n',
  );
  await files.getByRole('button', { name: 'Make a Projects page' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  expect(await terminalText(window)).toContain(`/factwright:projects-page job ${ACME_ID}`);
  expect(await terminalLines(window)).toContain('in the Classic template, as cards: 1 page');
  await closeRun();

  const page = jobPanel().getByRole('region', { name: 'Projects page' });
  await expect(page).toContainText('Selected Projects: Trailhead · pg-queue');
  await page.getByRole('button', { name: 'Preview AlexRiveraProjects10142026_Acme.pdf' }).click();
  const dialog = window.getByRole('dialog', { name: 'AlexRiveraProjects10142026_Acme.pdf' });
  await expect(dialog.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  // The PDF reads from the top: the name, then the page's heading and its projects.
  const loading = getDocument({
    data: new Uint8Array(
      readFileSync(join(dataDir, 'workspace', ACME_FOLDER, 'AlexRiveraProjects10142026_Acme.pdf')),
    ),
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const pdf = await (await loading.promise).getPage(1);
    const { items } = await pdf.getTextContent({ disableNormalization: true });
    const text = items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .toLowerCase();
    expect(text.indexOf('alex rivera')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('alex rivera')).toBeLessThan(text.indexOf('selected projects'));
    expect(text.indexOf('selected projects')).toBeLessThan(text.indexOf('trailhead'));
  } finally {
    await loading.destroy();
  }
  // It's neither a resume nor a letter.
  await expect(files).toContainText('1 resume · 1 cover letter · 1 Projects page');
});

test('asks for an application’s questions, then runs them in Claude’s panel', async () => {
  const { window } = opened;
  await jobPanel()
    .getByRole('region', { name: 'Application questions' })
    .getByRole('button', { name: 'Answer the questions' })
    .click();
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
  const answers = jobPanel().getByRole('region', { name: 'Application questions' });
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
  await expect(claudePanel()).toContainText('Claude answered your question about Acme Robotics.');
  // The app types only the skill and the job; the question reaches Claude through its tools.
  expect(await terminalText(window)).toContain(`/factwright:ask job ${ACME_ID}`);
  expect(await terminalText(window)).not.toContain('recruiter screen');
  const asked = jobPanel().getByRole('region', { name: 'Questions for Claude' });
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
  // The question's run is done already, so the bar saying what the prep made is what tells it's done.
  await expect(claudePanel()).toContainText(
    'Your prep sheet for the recruiter screen at Acme Robotics is ready.',
  );
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  // The app types only the job's and the call's IDs; who it's with reaches Claude through its tools.
  const typed = await terminalLines(window);
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
  await showWork(window);
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

test('saves to the user’s profile without asking, and lists each change, with View and Undo', async () => {
  const { window } = opened;
  const panel = claudePanel();
  // Done with Acme. In a narrow window, a job's details cover the page's buttons.
  await window.getByRole('button', { name: 'Close details' }).click();
  const search = async () => {
    await window.getByRole('button', { name: 'Find jobs' }).click();
    await window
      .getByRole('dialog', { name: 'Find jobs' })
      .getByRole('button', { name: /^Search/ })
      .click();
    await expect(panel.getByRole('status').first()).toHaveText('Done');
  };
  // The user types into Claude's work, once it shows.
  const say = async (words: string) => {
    await showWork(window);
    const typing = panel.locator('.xterm-helper-textarea');
    await typing.pressSequentially(words);
    await typing.press('Enter');
  };
  const answers = () =>
    JSON.parse(readFileSync(join(dataDir, 'workspace', 'about-me', 'answers.json'), 'utf8'));
  const changed = panel.getByRole('list', { name: 'Files Claude changed' });
  await search();
  await say('save my notice period');
  // Saved without asking: no dialog, and Claude never waits on the user.
  await expect
    .poll(() => terminalText(window))
    .toContain('Saved to the user’s profile: When they can start: Two weeks’ notice.');
  await expect(panel.getByRole('status').first()).toHaveText('Done');
  await expect(window.getByRole('dialog')).toHaveCount(0);
  expect(answers().start).toBe('Two weeks’ notice');
  await expect(changed).toContainText('answers.json');
  await expect(changed).toContainText('New');
  // The next task's card starts again, with what it changed.
  await search();
  await expect(changed).toHaveCount(0);
  // The user interrupts this one, so no Stop hook comes: the card lists what it changed once the
  // run reads as done.
  await say('save a month of notice, then interrupt');
  await expect.poll(() => answers().start).toBe('One month’s notice');
  await expect(panel.getByRole('status').first()).toHaveText('Done');
  await expect(changed).toContainText('answers.json');
  // View shows it before and after, a line at a time.
  await panel.getByRole('button', { name: 'View about-me/answers.json' }).click();
  const view = window.getByRole('dialog', { name: 'What changed in answers.json' });
  await expect(view.getByRole('list')).toContainText('Taken out:   "start": "Two weeks’ notice"');
  await expect(view.getByRole('list')).toContainText('Added:   "start": "One month’s notice"');
  await view.getByRole('button', { name: 'Done' }).click();
  // Undo puts it back as it was before the task.
  await panel.getByRole('button', { name: 'Undo about-me/answers.json' }).click();
  await expect(changed).toContainText('Undone');
  expect(answers().start).toBe('Two weeks’ notice');
  await closeRun();
});

test('finds jobs where the user picks, and keeps each search’s jobs together', async () => {
  const { window } = opened;
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
  // search can be picked on its own. Tidewater, which HN found first, is one job still, found
  // again.
  await pickView(/^New/);
  await expect(window.getByRole('button', { name: /^Lakeside Data/ })).toContainText(
    'LinkedIn Oct 12',
  );
  await expect(window.getByRole('button', { name: /^Tidewater Analytics/ })).toHaveCount(1);
  await expect(window.getByRole('button', { name: /^Tidewater Analytics/ })).toContainText(
    'Found again · LinkedIn Oct 12',
  );
  await window
    .getByRole('combobox', { name: 'Found by' })
    .selectOption({ label: 'LinkedIn Oct 12 (2)' });
  await expect(window.getByRole('button', { name: /^Lakeside Data/ })).toBeVisible();
  await expect(window.getByRole('button', { name: /^Acme Robotics/ })).toHaveCount(0);
  await window
    .getByRole('combobox', { name: 'Found by' })
    .selectOption({ label: 'Found anywhere' });
});

test('adds a job by hand', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: 'Add job' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add a job' });
  // Saving to this computer needs no sync, so even a copy without Factwright's sync points to the
  // extension, for a job found in the browser.
  await expect(
    dialog.getByRole('link', { name: 'Our extension for Chrome and Firefox' }),
  ).toHaveAttribute('href', 'https://factwright.com/extension');
  await dialog.getByRole('textbox', { name: 'Company' }).fill('Northwind Labs');
  await dialog.getByRole('button', { name: 'Add job' }).click();
  await expect(window.getByRole('button', { name: /^Northwind Labs/ })).toBeVisible();
});

test('passes on several new jobs at once, saying why, and keeps why for the job search', async () => {
  const { window } = opened;
  // Northwind, just added, is open. In a narrow window, a job's details cover the list.
  await window.getByRole('button', { name: 'Close details' }).click();
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

test('keeps a job passed on as it was when the same search finds it again', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: 'Find jobs' }).click();
  await window
    .getByRole('dialog', { name: 'Find jobs' })
    .getByRole('button', { name: /^Search/ })
    .click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  await closeRun();
  // The earlier run's file stays beside this run's, so its jobs stay listed, and the stand-in
  // gave the job find_job named, under a title the app alone wouldn't take for it.
  const folder = join(dataDir, 'workspace', 'searches', '2026-10-12-linkedin');
  expect(readdirSync(folder).sort()).toEqual(['jobs-2.json', 'jobs.json']);
  expect(JSON.parse(readFileSync(join(folder, 'jobs-2.json'), 'utf8')).jobs[0].job).toBe(
    'tidewater-analytics--senior-backend-engineer',
  );
  await pickView(/^New/);
  await expect(window.getByRole('button', { name: /^Tidewater Analytics/ })).toHaveCount(0);
  await pickView(/^Closed/);
  const tidewater = window.getByRole('button', { name: /^Tidewater Analytics/ });
  await expect(tidewater).toContainText('Passed');
  await expect(tidewater).toContainText('Found again · LinkedIn Oct 12');
  await expect(window.getByRole('button', { name: /^Lakeside Data.*Passed/ })).toBeVisible();
  await tidewater.click();
  await expect(jobPanel()).toContainText('Found again in LinkedIn Oct 12');
  await window.getByRole('button', { name: 'Close details' }).click();
});

test('merges a job found twice into one, keeping the user’s decision', async () => {
  const { window } = opened;
  // The same job as the search's, added by hand with another link, so the app can't tell.
  await window.getByRole('button', { name: 'Add job' }).click();
  const add = window.getByRole('dialog', { name: 'Add a job' });
  await add.getByRole('textbox', { name: 'Company' }).fill('Lakeside Data');
  await add.getByRole('textbox', { name: 'Role' }).fill('Senior Platform Engineer');
  await add.getByRole('button', { name: 'Add job' }).click();
  await expect(window.getByRole('button', { name: /^Lakeside Data/ })).toHaveCount(1);
  await jobPanel().getByRole('button', { name: 'Merge with…' }).click();
  const merge = window.getByRole('dialog', { name: 'Merge with another job' });
  const other = merge.getByRole('radio', { name: /^Lakeside Data.*Likely the same/ });
  await other.check();
  await merge.getByRole('button', { name: 'Merge' }).click();
  await expect(merge).toHaveCount(0);
  // One job now, passed on as the user left the one the search found.
  await expect(jobPanel().getByRole('combobox', { name: 'Status for Lakeside Data' })).toHaveValue(
    'passed',
  );
  await window.getByRole('button', { name: 'Close details' }).click();
  await pickView(/^Closed/);
  await expect(window.getByRole('button', { name: /^Lakeside Data/ })).toHaveCount(1);
  await pickView(/^New/);
  await expect(window.getByRole('button', { name: /^Lakeside Data/ })).toHaveCount(0);
});

test('focuses one search, typing only its ID, and names the search by its focus', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: 'Find jobs' }).click();
  const dialog = window.getByRole('dialog', { name: 'Find jobs' });
  await dialog.getByRole('checkbox', { name: /^Hacker News/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /^LinkedIn/ }).check();
  await dialog.getByRole('button', { name: /^Focus for this search/ }).click();
  await dialog.getByRole('button', { name: 'Early startup' }).click();
  await dialog.getByRole('textbox', { name: 'Pay a year, from' }).fill('150k');
  await dialog.getByRole('textbox', { name: 'to' }).fill('200,000');
  await dialog
    .getByRole('textbox', { name: 'Anything else for this search' })
    .fill('Founding roles only.');
  await expect(dialog).toContainText('Found by names it LinkedIn');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  // The app types the focus's ID alone, and the search reads the focus with search_focus.
  const typed = await terminalText(window);
  expect(typed).toMatch(/\/factwright:job-search focus \d{4}-\d{2}-\d{2}-[0-9a-f]{4}: LinkedIn/);
  expect(typed).toContain('This search’s focus: early startups, $150k–$200k');
  expect(typed).not.toContain('Founding roles only.');
  await closeRun();
  const focuses = join(dataDir, 'workspace', 'searches', 'focus');
  const [kept] = readdirSync(focuses);
  expect(JSON.parse(readFileSync(join(focuses, kept ?? ''), 'utf8'))).toMatchObject({
    stages: ['early'],
    payMin: 150_000,
    payMax: 200_000,
    notes: 'Founding roles only.',
  });
  await pickView(/^New/);
  await window
    .getByRole('combobox', { name: 'Found by' })
    .selectOption({ label: 'LinkedIn Oct 12 · early startups, $150k–$200k (1)' });
  await expect(window.getByRole('button', { name: /^Brightline Health/ })).toBeVisible();
  await window
    .getByRole('combobox', { name: 'Found by' })
    .selectOption({ label: 'Found anywhere' });
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

test('makes a quick resume, typing only the job and the app’s own word, and asks nothing', async () => {
  const { window } = opened;
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Jobs/ })
    .click();
  await pickView(/^All/);
  await window.getByRole('button', { name: /^Tidewater Analytics/ }).click();
  await jobPanel()
    .getByRole('region', { name: 'Resumes and cover letters' })
    .getByRole('button', { name: 'Quick resume' })
    .click();
  const panel = claudePanel();
  await expect(panel).toContainText('Quick resume · Tidewater Analytics');
  await expect(panel.getByRole('status').first()).toHaveText('Done');
  // No questions: no dialog, and the stand-in says it asked nothing.
  await expect(window.getByRole('dialog')).toHaveCount(0);
  expect(await terminalLines(window)).toMatch(
    /\/factwright:focused-resume job tidewater-analytics--\S+ quick/,
  );
  expect(await terminalLines(window)).toContain('from verified facts only: no questions.');
  // Its question anyway, as when the skill's words slip, is turned away, saying why.
  expect(await terminalLines(window)).toContain(
    'Not asked: A quick resume asks the user nothing, so this wasn’t asked.',
  );
  await closeRun();
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
  // Acme's resume went out with its application, so it stays as sent: this tailors Tidewater's.
  await window.getByRole('button', { name: /^Tidewater Analytics/ }).click();
  await jobPanel()
    .getByRole('region', { name: 'Resumes and cover letters' })
    .getByRole('button', { name: 'Tailor a resume' })
    .click();
  const panel = claudePanel();
  // The stand-in asks two questions in one round, which open in the app's dialog rather than the
  // terminal. Put aside, the round waits in Claude's panel.
  const asks = window.getByRole('dialog', { name: 'Claude has 2 questions' });
  await expect(asks).toContainText(
    'From your Claude, working on Tailored resume · Tidewater Analytics.',
  );
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
    /### GraphQL for the driver app\n`unconfirmed` `live` `solo` `medium`\n> Built the driver app’s GraphQL API\.\n- \*\*Keywords:\*\* GraphQL\n- \*\*Source:\*\* answer \d{4}-\d{2}-\d{2}, tailoring a resume for Tidewater Analytics\n- \*\*Question:\*\* The posting wants GraphQL\. Have you used GraphQL\?\n- \*\*Answer:\*\* Yes, in production\n/,
  );
  expect(text).not.toContain('Led a big team');
  expect(readFileSync(gaps, 'utf8')).toMatch(
    /\| Kafka \| No \(asked “The posting wants Kafka\. Have you run Kafka, or another event-streaming platform\?” while tailoring a resume for Tidewater Analytics\) \| \d{4}-\d{2}-\d{2} \|/,
  );
  // The sidebar says there's a fact to verify, and the panel goes to it.
  await expect(
    window.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Fact bank/ }),
  ).toHaveAccessibleName('Fact bank 1 to verify');
  await panel.getByRole('button', { name: 'Verify them' }).click();
  const toVerify = window.getByRole('region', { name: 'Unverified' });
  const answered = toVerify.getByRole('article', { name: 'GraphQL for the driver app' });
  await expect(answered).toContainText(
    'Your answer while tailoring a resume for Tidewater Analytics',
  );
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

test('keeps the pay to ask for at a job, in the user’s words, after a restart', async () => {
  const { window } = opened;
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Jobs/ })
    .click();
  await pickView(/^All/);
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  const fit = () => jobPanel().getByRole('region', { name: 'Fit' });
  // No target in Profile yet, so none until they give the job one.
  await expect(fit()).toContainText('Pay to ask for: none yet');
  await fit().getByRole('button', { name: 'Set it: the pay to ask for at Acme Robotics' }).click();
  await fit().getByRole('textbox', { name: 'Pay to ask for at Acme Robotics' }).fill('$200,000');
  await fit().getByRole('button', { name: 'Save' }).click();
  await expect(fit()).toContainText('Pay to ask for: $200,000, your own');
  await opened.app.close();
  opened = await openApp(dataDir);
  await pickView(/^All/);
  await opened.window.getByRole('button', { name: /^Acme Robotics/ }).click();
  await expect(fit()).toContainText('Pay to ask for: $200,000, your own');
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
  // Why the user passed stays with the job. In a narrow window, Acme's details cover the list.
  await window.getByRole('button', { name: 'Close details' }).click();
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
  await jobPanel().getByRole('button', { name: 'Check again' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  expect(await terminalText(window)).toContain('sonnet · high effort');
  await closeRun();
});

test('marks Claude Code’s first-run screens done for a Claude account, keeping its config', async () => {
  await opened.app.close();
  // Signed in with `claude auth login`, and never opened since, so its first-run screens show.
  const claude = usersClaude(dataDir, 'new-claude');
  writeFileSync(join(claude, '.claude.json'), JSON.stringify({ numStartups: 1, theme: 'light' }));
  opened = await openApp(dataDir, { CLAUDE_CONFIG_DIR: claude, FAKE_CLAUDE_FIRST_RUN: 'show' });
  const { window } = opened;
  await expect
    .poll(() => JSON.parse(readFileSync(join(claude, '.claude.json'), 'utf8')))
    .toEqual({ numStartups: 1, theme: 'light', hasCompletedOnboarding: true });
  expect(readdirSync(claude).sort()).toEqual(['.claude.json', 'signed-in']);
  await expect(window.getByText('Signed in · Max plan')).toBeVisible();
  // So a run goes straight to work.
  await window.getByRole('button', { name: 'Find jobs' }).click();
  await window
    .getByRole('dialog', { name: 'Find jobs' })
    .getByRole('button', { name: /^Search/ })
    .click();
  const panel = claudePanel();
  await expect(panel.getByRole('status')).toHaveText('Done');
  await expect(panel.getByRole('note')).toHaveCount(0);
  await closeRun();
});

test('explains Claude Code’s first-run screens when the app leaves them, and checks again', async () => {
  await opened.app.close();
  // Signed in with a key in the environment, which those screens ask about, so they're left.
  const claude = usersClaude(dataDir, 'key-claude');
  // A new version of Claude Code, as far as the setup check knows, so it checks again.
  rmSync(join(dataDir, 'setup-check.json'), { force: true });
  opened = await openApp(dataDir, {
    CLAUDE_CONFIG_DIR: claude,
    FAKE_CLAUDE_FIRST_RUN: 'show',
    FAKE_CLAUDE_METHOD: 'api_key',
  });
  const { window } = opened;
  const card = window.getByRole('region', { name: 'Your Claude' });
  // The setup check stops on them at once, and says what to do.
  await expect(card.getByText('Claude Code’s first screens')).toBeVisible();
  await expect(card).toContainText(
    'In Claude’s panel, press Enter through them, then check again.',
  );
  await expect(card).not.toContainText('may need an update');
  expect(existsSync(join(claude, '.claude.json'))).toBe(false);
  await card.getByRole('button', { name: 'Open Claude’s panel' }).click();
  const panel = claudePanel();
  await expect(panel.getByRole('note')).toContainText('Press Enter on each one');
  await expect(panel.getByRole('status')).toHaveText('Needs your answer');
  await expect(panel.locator('[class*="attention"]')).toHaveCount(1);
  // With the panel open, the card has nothing to open, and other runs wait.
  await expect(card.getByRole('button', { name: 'Open Claude’s panel' })).toHaveCount(0);
  const findJobs = window.getByRole('button', { name: 'Find jobs' });
  await expect(findJobs).toBeDisabled();
  const terminal = panel.locator('.xterm-helper-textarea');
  await terminal.press('Enter');
  // The next screen says so too, until it's answered.
  await expect.poll(() => terminalText(window)).toContain('Security notes:');
  await expect(panel.getByRole('note')).toContainText('Press Enter on each one');
  await terminal.press('Enter');
  await expect(panel.getByRole('note')).toHaveCount(0);
  await expect.poll(() => terminalText(window)).toContain("Factwright's tools");
  // Past them, it waits for what the user types, and isn't in the way of another run.
  await expect(panel.getByRole('status')).toHaveText('Ready');
  await expect(findJobs).toBeEnabled();
  // Claude Code noted them done itself, and the check passes now.
  expect(JSON.parse(readFileSync(join(claude, '.claude.json'), 'utf8'))).toEqual({
    hasCompletedOnboarding: true,
  });
  await card.getByRole('button', { name: 'Check again' }).click();
  await expect(card.getByText('Signed in', { exact: true })).toBeVisible();
  await closeRun();
});

// Greenhouse lists a form's questions before it's open. The tests' copy of the app reads a
// made-up answer from a file in Greenhouse's place, so no test reaches Greenhouse.
test('gets a Greenhouse form’s questions before it’s open, and has your Claude draft them', async () => {
  await opened.app.close();
  const feed = join(dataDir, 'greenhouse-form.json');
  writeFileSync(feed, JSON.stringify(HARBOR_FORM));
  opened = await openApp(dataDir, { FACTWRIGHT_FORM_FEED: feed });
  const { window } = opened;
  await window.getByRole('button', { name: 'Add job' }).click();
  const add = window.getByRole('dialog', { name: 'Add a job' });
  await add.getByRole('textbox', { name: 'Company' }).fill('Harbor & Pine Outfitters');
  await add.getByRole('textbox', { name: 'Role' }).fill('Account Executive');
  await add.getByRole('textbox', { name: 'Link to the posting' }).fill(HARBOR_POSTING);
  await add.getByRole('button', { name: 'Add job' }).click();
  const answers = jobPanel().getByRole('region', { name: 'Application questions' });
  await answers.getByRole('button', { name: 'Get the form’s questions' }).click();
  // Only the form's own questions, for your Claude: not what every form asks, what Profile
  // answers, or the compliance questions.
  for (const asked of [
    'Why do you want to join Harbor & Pine?',
    'Have you sold outdoor gear before?',
  ]) {
    await expect(answers.getByText(asked, { exact: true })).toBeVisible();
  }
  for (const left of ['First Name', 'Email', 'Resume/CV', 'LinkedIn Profile', 'Gender']) {
    await expect(answers.getByText(left, { exact: true })).toHaveCount(0);
  }
  await expect(answers).toContainText('From the form on Greenhouse');
  await expect(answers).toContainText('The form’s 2 questions need drafts.');
  await answers.getByRole('button', { name: 'Draft them with your Claude' }).click();
  await expect(claudePanel().getByRole('status')).toHaveText('Done');
  // The app types the skill, the job and "form", at the top of what the run printed.
  expect((await terminalStart(window)).replace(/\n/g, '')).toMatch(
    /\/factwright:answer-questions job harbor-and-pine-outfitters--account-executive form/,
  );
  // The run reads the questions, and how the form asks each one, in job_details.
  const read = await terminalLines(window);
  expect(read).toContain('Factwright got 2 of them from the form on Greenhouse');
  expect(read).toContain('On the form: a box for paragraphs, required, up to 1,000 characters.');
  expect(read).toContain('On the form: one of its options.');
  await closeRun();
});
