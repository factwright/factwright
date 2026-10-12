import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { samplePdf } from '../src/renderer/jobs/sample-pdf.ts';
import { type Opened, openApp, terminalText } from './app.ts';
import { newDataFolder } from './workspace.ts';

test.describe.configure({ mode: 'serial' });

let dataDir: string;
let opened: Opened;
const workspace = (path: string) => join(dataDir, 'workspace', ...path.split('/'));
const read = (path: string) => readFileSync(workspace(path), 'utf8');

test.beforeAll(async () => {
  dataDir = newDataFolder({ empty: true });
  opened = await openApp(dataDir);
});

test.afterAll(async () => {
  await opened?.app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** The step's own Continue, not the sidebar's Get started. */
const next = () =>
  opened.window
    .getByRole('main')
    .getByRole('button', { name: /^(Get started|Continue)$/ })
    .click();

test('welcomes a new user, with their Claude ready', async () => {
  const { window } = opened;
  await expect(window.getByRole('heading', { name: 'Let’s get you set up' })).toBeVisible();
  await expect(window.getByText('Your Claude is ready · Max plan.')).toBeVisible();
  await expect(window.getByRole('button', { name: 'Get started' })).toHaveCount(2);
});

test('takes their name, their resume and their own words', async () => {
  const { window } = opened;
  await next();
  await window.getByRole('textbox', { name: 'Your name' }).fill('Alex Rivera');
  await next();
  await window.locator('input[type="file"][accept=".pdf,.docx,.txt,.md"]').setInputFiles({
    name: 'Alex Rivera resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(samplePdf()),
  });
  await expect(window.getByRole('button', { name: 'Remove Alex Rivera resume.pdf' })).toBeVisible();
  await next();
  await window.getByRole('button', { name: 'What I do now' }).click();
  await window
    .getByRole('textbox', { name: 'About you, in your own words' })
    .pressSequentially('I lead the platform team at Tidewater Analytics.');
  await window.getByRole('textbox', { name: 'Names to keep private' }).fill('Bluebird');
  await window.getByRole('textbox', { name: 'Names to keep private' }).press('Enter');
});

test('asks what they want, and shows the templates printed for real', async () => {
  const { window } = opened;
  await next();
  await window.getByRole('button', { name: 'Software engineering' }).click();
  await window.getByRole('button', { name: 'Senior', exact: true }).click();
  await window.getByRole('button', { name: 'Startups' }).click();
  await next();
  await expect(window.getByRole('heading', { name: 'Pick your resume templates' })).toBeVisible();
  // Each card shows a real print of the sample resume, with the user's own name.
  const timeline = window
    .getByRole('listitem')
    .filter({ has: window.getByRole('heading', { name: 'Timeline' }) });
  await expect(timeline.getByText('Suggested', { exact: true })).toBeVisible();
  await expect(timeline.getByRole('checkbox', { name: 'Use this template' })).toBeChecked();
  await expect(timeline.locator('img')).toBeVisible({ timeout: 20_000 });
});

test('hands it all to their Claude, with the workspace ready for it', async () => {
  const { window } = opened;
  await next();
  await expect(window.getByRole('heading', { name: 'Ready for your Claude' })).toBeVisible();
  await window.getByRole('button', { name: 'Start with your Claude' }).click();
  const panel = window.locator('section[aria-label="Claude"]');
  await expect(panel.getByRole('status')).toHaveText('Done');
  expect(await terminalText(window)).toContain('/factwright:get-started');
  // The profile takes over, following Claude as it works.
  await expect(window.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(window.getByRole('region', { name: 'Getting to know you' })).toBeVisible();

  const answers = JSON.parse(read('about-me/answers.json'));
  expect(answers).toMatchObject({
    you: { name: 'Alex Rivera' },
    fields: ['software'],
    levels: ['senior'],
    companies: ['startup'],
    looks: [{ layout: 'timeline', for: 'startup' }],
  });
  expect(answers.startedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(answers.files[0]).toMatchObject({ name: 'Alex Rivera resume.pdf', kind: 'resume' });
  expect(existsSync(workspace(answers.files[0].path))).toBe(true);
  // pdf.js read the resume's text in the window, for Claude to read as text.
  expect(read(answers.files[0].textFile)).toContain('ALEX RIVERA');
  expect(read('about-me/notes.md')).toBe(
    'What I do now: I lead the platform team at Tidewater Analytics.',
  );
  expect(read('guide/confidential-terms.txt')).toMatch(/\nBluebird\n$/);
  // The starter files, and the files built from the answers.
  for (const path of [
    'guide/rules.md',
    'guide/writing.md',
    'guide/styles/startup.md',
    'facts/README.md',
  ]) {
    expect(existsSync(workspace(path)), path).toBe(true);
  }
  expect(read('searches/criteria.md')).toContain('- **Level:** Senior.');
  expect(read('guide/templates.md')).toContain(
    '| Timeline | `timeline` | Startups (the startup style) |',
  );
  expect(JSON.parse(read('guide/lint.json')).maxPages).toBe(2);
});
