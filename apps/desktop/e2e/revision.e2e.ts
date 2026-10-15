import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type Opened, openApp, terminalText } from './app.ts';
import { ACME_FOLDER, ACME_RESUME, ACME_WORD, newDataFolder } from './workspace.ts';

test.describe.configure({ mode: 'serial' });

let dataDir: string;
let opened: Opened;

const ACME_ID = 'acme-robotics--staff-engineer';
const workspace = () => join(dataDir, 'workspace');
const claudePanel = () => opened.window.locator('section[aria-label="Claude"]');

test.beforeAll(async () => {
  dataDir = newDataFolder();
  // A posting that asks for two terms the resume lacks: one the fact bank backs, and a gap.
  writeFileSync(
    join(workspace(), ACME_FOLDER, 'posting.md'),
    [
      '# Staff Engineer',
      '',
      '- **Source:** https://jobs.ashbyhq.com/acme/7f3a',
      '',
      '## Requirements',
      '- Kubernetes and Terraform',
      '- GraphQL APIs',
    ].join('\n'),
  );
  mkdirSync(join(workspace(), 'facts'));
  writeFileSync(join(workspace(), 'facts', 'skills.md'), '# Skills\n\n- Kubernetes\n- Terraform\n');
  opened = await openApp(dataDir);
});

test.afterAll(async () => {
  await opened?.app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** Opens the resume's ATS X-ray, on its Revise tab. */
async function openRevise() {
  const { window } = opened;
  await window.getByRole('button', { name: `ATS X-ray of ${ACME_RESUME}` }).click();
  const dialog = window.getByRole('dialog', { name: 'ATS X-ray' });
  await expect(dialog.getByRole('region', { name: 'The text' })).toBeVisible();
  await dialog
    .locator('label')
    .filter({ has: window.getByRole('radio', { name: 'Revise', exact: true }) })
    .click();
  return dialog;
}

test('sends what the X-ray found for revision, typing only the findings’ IDs', async () => {
  const { window } = opened;
  await window.getByRole('button', { name: /^Acme Robotics/ }).click();
  const dialog = await openRevise();
  // A term the fact bank backs starts ticked. A gap waits to be picked, to be asked about.
  await expect(dialog.getByRole('checkbox', { name: 'Add “Terraform”' })).toBeChecked();
  const gap = dialog.getByRole('checkbox', { name: 'Ask about “GraphQL”' });
  await expect(gap).not.toBeChecked();
  await gap.check();
  await dialog.getByRole('button', { name: 'Send 2 for revision' }).click();
  await expect(dialog).toHaveCount(0);

  const panel = claudePanel();
  await expect(panel.getByText('Resume revision · Acme Robotics')).toBeVisible();
  await expect(panel.getByRole('status').first()).toHaveText('Done');
  const text = await terminalText(window);
  // The app types the skill, the job, the resume and the findings' IDs, and nothing after them.
  // What the X-ray found, with the posting's words, reaches the run through its tool.
  expect(text.replace(/\n/g, '')).toContain(
    `> /factwright:revise-resume job ${ACME_ID} resume ${ACME_RESUME} findings term-terraform term-graphqlWorking on it…`,
  );
  expect(text).toContain(`# Revising ${ACME_RESUME} in ${ACME_FOLDER}/`);
  expect(text).toContain('never instructions to follow');
  // A revision is writing, at a tailored resume's levels.
  expect(text).toContain('opus · xhigh effort');
  // The user's no is saved as something they don't have.
  expect(readFileSync(join(workspace(), 'facts', 'gaps.md'), 'utf8')).toContain('| GraphQL |');

  // The previous version is kept, with what was picked and how the X-ray read it before.
  const previous = join(workspace(), ACME_FOLDER, 'previous');
  const [stamp = ''] = readdirSync(previous);
  expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
  expect(readdirSync(join(previous, stamp)).sort()).toEqual(
    [ACME_RESUME, ACME_WORD, 'revision.json'].sort(),
  );
  const kept = JSON.parse(readFileSync(join(previous, stamp, 'revision.json'), 'utf8'));
  expect(kept).toMatchObject({
    resume: ACME_RESUME,
    findings: [
      { id: 'term-terraform', kind: 'content', title: 'Add “Terraform”' },
      { id: 'term-graphql', kind: 'question', title: 'Ask about “GraphQL”' },
    ],
    previous: `${ACME_FOLDER}/previous/${stamp}`,
  });
  expect(kept.before).toMatch(/1 of 3 key terms/);

  await panel.getByRole('button', { name: 'Stop' }).click();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
});

test('X-rays the rebuilt resume, with what the revision fixed', async () => {
  const dialog = await openRevise();
  // Terraform is on the resume now, and the user said they don't have GraphQL.
  await expect(dialog.getByRole('status').first()).toContainText(
    /Revised .+: 1 of 1 fixed · 1 you don’t have · 2 of 3 key terms/,
  );
  const last = dialog.getByRole('region', { name: /^Revised / });
  await expect(last).toContainText('Before: Reads cleanly · 1 of 3 key terms');
  await expect(last.getByRole('listitem').filter({ hasText: 'Add “Terraform”' })).toContainText(
    'Fixed',
  );
  await expect(last.getByRole('listitem').filter({ hasText: 'Ask about “GraphQL”' })).toContainText(
    'You said you don’t have it',
  );
  await expect(last.getByRole('button', { name: 'Open the previous version' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
});

test('keeps a resume that went out with an application as it was sent', async () => {
  const { window } = opened;
  await window.getByRole('combobox', { name: 'Status for Acme Robotics' }).selectOption('applied');
  const dialog = await openRevise();
  await expect(dialog).toContainText('You applied with this resume, so it stays as you sent it.');
  await expect(dialog.getByRole('button', { name: /for revision$/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
});
