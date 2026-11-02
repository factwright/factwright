import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { FactwrightApi } from '../src/shared/api.ts';
import { type Opened, openApp, terminalText } from './app.ts';
import { newDataFolder } from './workspace.ts';

test.describe.configure({ mode: 'serial' });

let dataDir: string;
let opened: Opened;

const workspace = (path: string) => join(dataDir, 'workspace', ...path.split('/'));
const answers = () => JSON.parse(readFileSync(workspace('about-me/answers.json'), 'utf8'));
const claudePanel = () => opened.window.locator('section[aria-label="Claude"]');
const card = (name: string) => opened.window.getByRole('region', { name, exact: true });

/** Says what to change in a part of Profile, from its Update with Claude, and sees it through. */
async function ask(part: string, words: string, where = card(part)) {
  await where.getByRole('button', { name: `Update with Claude: ${part}` }).click();
  const dialog = opened.window.getByRole('dialog', { name: `Update with Claude: ${part}` });
  await dialog.getByRole('textbox', { name: 'What should your Claude change?' }).fill(words);
  await dialog.getByRole('button', { name: 'Make the changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(claudePanel().getByRole('status').first()).toHaveText('Done');
}

async function closeRun() {
  await claudePanel().getByRole('button', { name: 'Close' }).click();
  await expect(claudePanel()).toHaveCount(0);
}

test.beforeAll(async () => {
  dataDir = newDataFolder({ empty: true });
  // Someone who's started, so Profile shows: nothing else is told yet.
  mkdirSync(workspace('about-me'), { recursive: true });
  writeFileSync(
    workspace('about-me/answers.json'),
    JSON.stringify({ you: { name: 'Alex Rivera' }, startedOn: '2026-10-12' }),
  );
  opened = await openApp(dataDir);
  await opened.window.getByRole('button', { name: /^Profile/ }).click();
  await expect(opened.window.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
});

test.afterAll(async () => {
  await opened?.app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('has Update with Claude on the parts it helps with, even with nothing in them', async () => {
  for (const part of [
    'Your fact bank',
    'Starting resumes',
    'What you want',
    'Resume templates',
    'Beyond work',
    'Work history and education',
  ]) {
    await expect(
      card(part).getByRole('button', { name: `Update with Claude: ${part}` }),
    ).toBeVisible();
  }
  await expect(
    card('For applications').getByRole('button', {
      name: 'Update with Claude: Why you’re leaving',
    }),
  ).toBeVisible();
  // A few details, and the user's own files and words, stay theirs to change.
  for (const part of ['About you', 'For applications', 'What you’ve shared']) {
    await expect(
      card(part).getByRole('button', { name: `Update with Claude: ${part}` }),
    ).toHaveCount(0);
  }
});

test('changes a part from the user’s words, with Undo', async () => {
  const { window } = opened;
  const words = 'A four-day week';
  await ask('What you want', words);
  const typed = await terminalText(window);
  // Only the app's own word for the part is typed: the user's words reach the run through a tool.
  expect(typed).toContain('/factwright:update-profile wants');
  expect(typed).not.toContain(`> ${words}`);
  expect(typed).toContain('# Changes to What you want in the user’s Profile');
  expect(answers().mustHaves).toBe(words);

  // The part stays to itself: another part's tool isn't there, the tool other runs save with is
  // turned away, with no dialog for the user to answer, and neither saved a thing.
  expect(typed).toContain('Another part: no such tool');
  expect(typed).toContain('The usual tool: Not saved: A change to one part of Profile');
  await expect(window.getByRole('dialog')).toHaveCount(0);
  expect(answers().start ?? '').toBe('');
  // What it left, which only Claude knows, shows without opening the terminal.
  await expect(claudePanel()).toContainText('I left your name: that’s in About you’s Change.');

  // Its card lists the file it changed, and Undo puts it back as it was before the task.
  const changed = claudePanel().getByRole('list', { name: 'Files Claude changed' });
  await expect(changed).toContainText('answers.json');
  await claudePanel().getByRole('button', { name: 'Undo about-me/answers.json' }).click();
  await expect(changed).toContainText('Undone');
  await expect.poll(() => answers().mustHaves ?? '').toBe('');

  // Asked for more in the same run, it still stays to its part, with no dialog either.
  const reply = claudePanel().getByRole('textbox', { name: 'Reply to Claude' });
  await reply.fill('try the usual tool');
  await claudePanel().getByRole('button', { name: 'Send' }).click();
  await expect
    .poll(() => terminalText(window))
    .toContain('Still the usual tool: Not saved: A change to one part of Profile');
  await expect(window.getByRole('dialog')).toHaveCount(0);
  await expect(claudePanel().getByRole('status').first()).toHaveText('Done');
  await closeRun();
});

test('says what stays out of Claude’s reach, and turns it away if it comes anyway', async () => {
  const { window } = opened;
  const applications = card('For applications');
  const stays = 'Your street, postal code and equal-opportunity answers stay on this computer';
  await expect(applications).toContainText(stays);
  await applications
    .getByRole('button', { name: 'Update with Claude: Why you’re leaving' })
    .click();
  const dialog = window.getByRole('dialog', { name: 'Update with Claude: Why you’re leaving' });
  await expect(dialog).toContainText(stays);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // The stand-in tries to save a street as one, which the tool refuses by name.
  await ask('Why you’re leaving', 'My street is 12 Elm', applications);
  const typed = await terminalText(window);
  expect(typed).toContain('A street: Not saved: street, postal code and equal-opportunity answers');
  // So it never reaches a file that syncs.
  expect(readFileSync(workspace('about-me/answers.json'), 'utf8')).not.toContain('12 Elm');
  await closeRun();
});

test('changes why they’re leaving from its own line, and only that', async () => {
  const { window } = opened;
  await ask('Why you’re leaving', 'I want to work at a bigger scale.', card('For applications'));
  expect(await terminalText(window)).toContain('/factwright:update-profile leaving');
  await expect(card('For applications')).toContainText(
    'Why you’re leaving: I want to work at a bigger scale.',
  );
  await closeRun();
});

test('changes one kind of job from its own line', async () => {
  const { window } = opened;
  await card('What you want').getByRole('button', { name: 'Change' }).click();
  const change = window.getByRole('dialog', { name: 'What you want' });
  await change.getByRole('button', { name: 'Add another kind of job' }).click();
  await change.getByRole('textbox', { name: 'What to call the jobs above' }).fill('Developer');
  await change.getByRole('textbox', { name: 'What to call the new kind' }).fill('Project manager');
  await change.getByRole('button', { name: 'Add', exact: true }).click();
  await change.getByRole('button', { name: 'Done' }).click();

  await ask('Project manager', 'Program Director', card('What you want'));
  expect(await terminalText(window)).toContain('/factwright:update-profile kind project-manager');
  await expect
    .poll(() => JSON.parse(readFileSync(workspace('about-me/kinds-of-job.json'), 'utf8')).others)
    .toMatchObject([{ id: 'project-manager', roles: ['Program Director'] }]);
  await closeRun();
});

test('refuses a run on a part with nothing asked, saying so in a tab of its own', async () => {
  type Api = { factwright: FactwrightApi };
  await opened.window.evaluate(() =>
    (globalThis as unknown as Api).factwright.startClaude({
      skill: 'update-profile',
      part: 'wants',
      request: '0000000000000000',
    }),
  );
  const panel = claudePanel();
  await expect(panel.getByRole('status')).toHaveText('Didn’t finish');
  await expect(panel).toContainText('These changes need asking for again.');
  await closeRun();
});
