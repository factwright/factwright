import { rmSync } from 'node:fs';
import { expect, type Locator, test } from '@playwright/test';
import { type Opened, openApp } from './app.ts';
import { newDataFolder } from './workspace.ts';

// Add job reads a job's link from saved copies of real postings (test/pages), which the tests'
// copy of the app reads in the sites' place, so no test reaches a live site.

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

const WORKDAY =
  'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Product-Manager--AI-Platform-SW---Agentic-AI-Kernel-Generation_JR2016992';
const WORKDAY_TITLE = 'Product Manager, AI Platform SW - Agentic AI Kernel Generation';

const jobPanel = () => opened.window.locator('aside[aria-label="Job details"]');
const jobRow = (company: string) =>
  opened.window
    .getByRole('list', { name: 'Jobs' })
    .getByRole('button', { name: new RegExp(`^${company}`) });

/** Opens Add job and gives it a link, which it reads once the field is left. */
async function addWithLink(link: string): Promise<Locator> {
  await opened.window.getByRole('button', { name: 'Add job' }).click();
  const dialog = opened.window.getByRole('dialog', { name: 'Add a job' });
  const field = dialog.getByRole('textbox', { name: 'Link to the posting' });
  await field.fill(link);
  await field.blur();
  return dialog;
}

/** The posting kept with the job the panel shows, opened to read, by how it came. */
async function openKept(came: string): Promise<Locator> {
  const saved = jobPanel().getByRole('region', { name: 'Saved for this job' });
  if (!(await saved.getByText(came).isVisible())) {
    await jobPanel()
      .getByRole('button', { name: /^Saved for this job/ })
      .click();
  }
  await expect(saved.getByText(came)).toBeVisible();
  await saved.getByRole('button', { name: `Open the posting ${came.toLowerCase()}` }).click();
  return opened.window.getByRole('dialog', { name: /^Posting: / });
}

test('reads a job’s link as it’s added, fills in its company and role, and keeps its posting', async () => {
  const dialog = await addWithLink(WORKDAY);
  await expect(dialog.getByRole('status')).toHaveText(
    `Read the posting: ${WORKDAY_TITLE}, 4,692 characters. It’s kept with the job.`,
  );
  await expect(dialog.getByRole('textbox', { name: 'Company' })).toHaveValue('NVIDIA');
  await expect(dialog.getByRole('textbox', { name: 'Role' })).toHaveValue(WORKDAY_TITLE);
  await dialog.getByRole('button', { name: 'Add job' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(jobRow('NVIDIA')).toBeVisible();
  const posting = await openKept('Read from its link when you added the job');
  await expect(posting).toContainText('Agentic AI');
  await opened.window.keyboard.press('Escape');
  await expect(posting).toHaveCount(0);
});

test('says plainly why it can’t read LinkedIn, points to what works, and keeps a pasted description', async () => {
  const dialog = await addWithLink('https://www.linkedin.com/jobs/view/4012345678/');
  const note = dialog.getByRole('status');
  await expect(note).toHaveText(
    'LinkedIn doesn’t let apps read its pages, so Factwright never does. Open the posting in your browser and click Save to Factwright, or paste the description below.',
  );
  await expect(note.getByRole('link', { name: 'Save to Factwright' })).toHaveAttribute(
    'href',
    'https://factwright.com/extension',
  );
  await dialog.getByRole('textbox', { name: 'Company' }).fill('Cynet Systems');
  await dialog.getByRole('textbox', { name: 'Role' }).fill('.NET Core Developer');
  await dialog
    .getByRole('textbox', { name: 'Job description' })
    .fill('About the job\n\nBuild services in .NET Core for our clients.');
  await dialog.getByRole('button', { name: 'Add job' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(jobRow('Cynet Systems')).toBeVisible();
  const posting = await openKept('Pasted when you added the job');
  await expect(posting).toContainText('Build services in .NET Core for our clients.');
  await opened.window.keyboard.press('Escape');
});

test('says a site turned it away, or a posting closed, then adds the job without its posting', async () => {
  const blocked = await addWithLink('https://careers.blocks-apps.example/jobs/1');
  await expect(blocked.getByRole('status')).toHaveText(
    'careers.blocks-apps.example turned Factwright away (403): it blocks apps, or wants you signed in. Open the posting in your browser and click Save to Factwright, or paste the description below.',
  );
  await blocked.getByRole('textbox', { name: 'Company' }).fill('Blocks Apps');
  await blocked.getByRole('button', { name: 'Add job' }).click();
  await expect(blocked).toHaveCount(0);
  await expect(jobRow('Blocks Apps')).toBeVisible();

  const closed = await addWithLink(
    'https://clark.wd503.myworkdayjobs.com/clarkexternal/job/McLean-VA/Project-Manager_R5025094',
  );
  await expect(closed.getByRole('status')).toHaveText(
    'Workday says this posting has closed. If it’s still open, paste its description below.',
  );
  await closed.getByRole('button', { name: 'Cancel' }).click();
  await expect(closed).toHaveCount(0);
});
