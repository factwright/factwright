import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type Opened, openApp } from './app.ts';
import { fakeClaude } from './paths.ts';
import { newDataFolder } from './workspace.ts';

// Homebrew and WinGet leave updating Claude Code to the user, and for those `claude update` only
// names their own command, so the window gives that command. The stand-in is laid out as each one
// leaves it: a cask behind Homebrew's link, or in WinGet's folder on Windows. The home folder is
// the test's own, and PATH has only that folder and the system's own, so no Claude Code but the
// stand-in is ever reached.

test.describe.configure({ mode: 'serial' });

const WINDOWS = process.platform === 'win32';
const UPDATE = WINDOWS ? 'winget upgrade Anthropic.ClaudeCode' : 'brew upgrade claude-code';

let root: string;
let dataDir: string;
let opened: Opened;
/** The program that answers for Claude Code, too old until a test updates it. */
let program: string;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'factwright-claude-update-'));
  const home = join(root, 'home');
  // Claude Code's own folder for the app's runs, signed out.
  const claudeFolder = join(root, 'claude');
  mkdirSync(claudeFolder);
  dataDir = newDataFolder({ empty: true });
  let onPath: string;
  if (WINDOWS) {
    onPath = join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links');
    mkdirSync(onPath, { recursive: true });
    program = join(onPath, 'claude.cmd');
    writeFileSync(program, '@echo 2.0.12 (Claude Code)\r\n');
  } else {
    onPath = join(home, 'homebrew', 'bin');
    const cask = join(home, 'homebrew', 'Caskroom', 'claude-code', '2.0.12');
    mkdirSync(onPath, { recursive: true });
    mkdirSync(cask, { recursive: true });
    program = join(cask, 'claude');
    writeFileSync(program, "#!/bin/sh\necho '2.0.12 (Claude Code)'\n");
    chmodSync(program, 0o755);
    symlinkSync(program, join(onPath, 'claude'));
  }
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  opened = await openApp(dataDir, {
    PATH: [onPath, ...(WINDOWS ? [join(system, 'System32'), system] : ['/usr/bin', '/bin'])].join(
      delimiter,
    ),
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    CLAUDE_CONFIG_DIR: claudeFolder,
  });
});

test.afterAll(async () => {
  await opened?.app.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test('gives the package manager’s own command, in the steps and the card', async () => {
  const { window } = opened;
  await expect(window.getByRole('heading', { name: 'Update Claude Code' })).toBeVisible();
  await expect(window.getByRole('main').getByText(UPDATE, { exact: true })).toBeVisible();
  await expect(
    window.getByRole('region', { name: 'Your Claude' }).getByText(UPDATE, { exact: true }),
  ).toBeVisible();
  await expect(window.getByText('claude update')).toHaveCount(0);
});

test('moves on once it’s updated', async () => {
  const { window } = opened;
  // Updating, as the command would.
  const stand = join(fakeClaude, 'fake-claude.mjs');
  writeFileSync(
    program,
    WINDOWS
      ? `@echo off\r\n"${process.execPath}" "${stand}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath}' '${stand}' "$@"\n`,
  );
  await window.getByRole('button', { name: 'Check again' }).first().click();
  await expect(window.getByRole('heading', { name: 'Sign in to Claude Code' })).toBeVisible();
});
