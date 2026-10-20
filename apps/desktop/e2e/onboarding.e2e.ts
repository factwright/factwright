import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
  const minimal = window
    .getByRole('listitem')
    .filter({ has: window.getByRole('heading', { name: 'Minimal' }) });
  await expect(minimal.getByText('Suggested', { exact: true })).toBeVisible();
  await expect(minimal.getByRole('checkbox', { name: 'Use this template' })).toBeChecked();
  await expect(minimal.locator('img')).toBeVisible({ timeout: 20_000 });
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
    looks: [{ layout: 'minimal', for: 'startup' }],
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
    '| Minimal | `minimal` | Startups (the startup style) |',
  );
  expect(JSON.parse(read('guide/lint.json')).maxPages).toBe(2);
});

test('has their Claude make a template of their own from a resume they like', async () => {
  const { window } = opened;
  const card = window.getByRole('region', { name: 'Resume templates' });
  await card.getByRole('button', { name: 'Change' }).click();
  const dialog = window.getByRole('dialog', { name: 'Resume templates' });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'A resume I like.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(samplePdf()),
  });
  // The dialog steps aside for Claude's panel, where Claude makes it from the copy the app kept.
  await expect(dialog).toBeHidden();
  const panel = window.locator('section[aria-label="Claude"]');
  await expect(panel.getByText('A template of your own')).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('Done');
  const terminal = await terminalText(window);
  expect(terminal).toMatch(
    /\/factwright:make-template from templates\/sources\/\d{4}-\d{2}-\d{2}-1\.pdf/,
  );
  expect(terminal).toContain('Saved templates/liked-look.json, “Liked Look”.');
  expect(readdirSync(workspace('templates/sources'))).toEqual([
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}-1\.pdf$/),
  ]);
  expect(existsSync(workspace('templates/.previews/liked-look.pdf'))).toBe(true);

  // It joins their templates, printed for real like the app's own, for them to pick.
  await card.getByRole('button', { name: 'Change' }).click();
  const liked = dialog
    .getByRole('listitem')
    .filter({ has: window.getByRole('heading', { name: 'Liked Look' }) });
  await expect(liked.getByText('Yours', { exact: true })).toBeVisible();
  await expect(liked.locator('img')).toBeVisible({ timeout: 20_000 });
  await liked.getByRole('checkbox', { name: 'Use this template' }).check();
  await expect
    .poll(() => JSON.parse(read('about-me/answers.json')).looks)
    .toContainEqual({ layout: 'liked-look', for: 'any' });
  await expect
    .poll(() => read('guide/templates.md'))
    .toContain('| Liked Look | `liked-look` | any job |');
});

test('takes a second kind of job, with its own titles, and searches for it alone', async () => {
  const { window } = opened;
  await window
    .getByRole('dialog', { name: 'Resume templates' })
    .getByRole('button', { name: 'Done' })
    .click();
  const wants = window.getByRole('region', { name: 'What you want' });
  await wants.getByRole('button', { name: 'Change' }).click();
  const dialog = window.getByRole('dialog', { name: 'What you want' });
  await dialog.getByRole('button', { name: 'Add another kind of job' }).click();
  await dialog.getByRole('textbox', { name: 'What to call the jobs above' }).fill('Developer');
  await dialog.getByRole('textbox', { name: 'What to call the new kind' }).fill('Project manager');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  const titles = dialog.getByRole('textbox', { name: 'Job titles you want' });
  await expect(titles).toBeFocused();
  await titles.fill('Program Manager');
  await titles.press('Enter');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Its own file keeps the kinds, and answers.json keeps the first kind's, as before.
  await expect
    .poll(
      () =>
        existsSync(workspace('about-me/kinds-of-job.json')) && read('about-me/kinds-of-job.json'),
    )
    .toContain('Program Manager');
  expect(JSON.parse(read('about-me/kinds-of-job.json'))).toEqual({
    first: { id: 'developer', name: 'Developer' },
    others: [
      {
        id: 'project-manager',
        name: 'Project manager',
        roles: ['Program Manager'],
        fields: [],
        levels: [],
        minPay: '',
        targetPay: '',
        payFilter: false,
      },
    ],
  });
  const answers = JSON.parse(read('about-me/answers.json'));
  expect(answers).toMatchObject({ fields: ['software'], levels: ['senior'] });
  expect(answers).not.toHaveProperty('otherKinds');
  await expect
    .poll(() => read('searches/criteria.md'))
    .toContain('### Project manager (`project-manager`)');
  await expect(wants.getByText('Program Manager roles')).toBeVisible();

  // Find jobs looks for one kind, and says which to Claude by its id.
  await window.getByRole('button', { name: /^Jobs/ }).click();
  await window.getByRole('button', { name: 'Find jobs' }).click();
  const find = window.getByRole('dialog', { name: 'Find jobs' });
  await find.locator('label').filter({ hasText: 'Project manager' }).click();
  await find.getByRole('button', { name: 'Search', exact: true }).click();
  const panel = window.locator('section[aria-label="Claude"]');
  await expect(panel.getByRole('status')).toHaveText('Done');
  expect(await terminalText(window)).toContain('/factwright:job-search for project-manager: HN');

  // The job it found is under that kind, and the list can show that kind's jobs alone.
  const kinds = window.getByRole('combobox', { name: 'Kind of job', exact: true });
  await kinds.selectOption('project-manager');
  await window
    .locator('label')
    .filter({ has: window.getByRole('radio', { name: /^All/ }) })
    .click();
  await window.getByRole('button', { name: /^Harbor Light/ }).click();
  const kind = window.getByRole('combobox', { name: 'Kind of job for Harbor Light' });
  await expect(kind).toHaveValue('project-manager');
  // Put under the first kind instead, it leaves the project manager jobs.
  await kind.selectOption('developer');
  await expect(window.getByRole('button', { name: /^Harbor Light/ })).toBeHidden();
  await kinds.selectOption('developer');
  await expect(window.getByRole('button', { name: /^Harbor Light/ })).toBeVisible();
});
