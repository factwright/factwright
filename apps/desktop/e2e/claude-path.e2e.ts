import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type Opened, openApp } from './app.ts';
import { fakeClaude } from './paths.ts';
import { newDataFolder } from './workspace.ts';

// Claude Code's installer doesn't add its folder to PATH on Windows, nor always on a Mac, so a
// new terminal window doesn't find `claude` by name. The app still finds it, and its steps start
// it by its whole path. The home folder is the test's own, and PATH has only the system's own
// folders, so no Claude Code but the stand-in is ever reached.

test.describe.configure({ mode: 'serial' });

const WINDOWS = process.platform === 'win32';

let root: string;
let home: string;
let claudeFolder: string;
let dataDir: string;
let opened: Opened;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'factwright-claude-path-'));
  home = join(root, 'home');
  mkdirSync(home);
  // Claude Code's own folder for the app's runs, signed out until a test signs it in.
  claudeFolder = join(root, 'claude');
  mkdirSync(claudeFolder);
  dataDir = newDataFolder({ empty: true });
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  opened = await openApp(dataDir, {
    PATH: (WINDOWS ? [join(system, 'System32'), system] : ['/usr/bin', '/bin']).join(delimiter),
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

test('starts Claude Code where its installer puts it, while it isn’t installed', async () => {
  const { window } = opened;
  await expect(window.getByRole('heading', { name: 'Install Claude Code' })).toBeVisible();
  await expect(
    window.getByText(
      WINDOWS ? '& "$env:USERPROFILE\\.local\\bin\\claude.exe"' : '~/.local/bin/claude',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(window.getByRole('link', { name: 'add it to your PATH' })).toBeVisible();
});

test('signs in by its whole path once it’s installed off PATH, in the steps and the card', async () => {
  const { window } = opened;
  // The stand-in, where an installer leaves it: Claude Code's own on a Mac, npm's on Windows,
  // whose own is a program the stand-in can't be.
  if (WINDOWS) {
    const npm = join(home, 'AppData', 'Roaming', 'npm');
    mkdirSync(npm, { recursive: true });
    writeFileSync(
      join(npm, 'claude.cmd'),
      `@echo off\r\n"${process.execPath}" "${join(fakeClaude, 'fake-claude.mjs')}" %*\r\n`,
    );
  } else {
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'claude'),
      `#!/bin/sh\nexec '${process.execPath}' '${join(fakeClaude, 'fake-claude.mjs')}' "$@"\n`,
    );
    chmodSync(join(bin, 'claude'), 0o755);
  }
  await window.getByRole('button', { name: 'Check again' }).first().click();
  await expect(window.getByRole('heading', { name: 'Sign in to Claude Code' })).toBeVisible();
  const command = WINDOWS
    ? '& "$env:USERPROFILE\\AppData\\Roaming\\npm\\claude.cmd" auth login'
    : '~/.local/bin/claude auth login';
  await expect(window.getByRole('main').getByText(command, { exact: true })).toBeVisible();
  await expect(
    window.getByRole('region', { name: 'Your Claude' }).getByText(command, { exact: true }),
  ).toBeVisible();
  await expect(window.getByText(/doesn’t find Claude Code by its name/)).toBeVisible();
});

test('is ready once signed in', async () => {
  const { window } = opened;
  // Signing in, as the command would.
  writeFileSync(join(claudeFolder, 'signed-in'), '');
  await window.getByRole('button', { name: 'Check again' }).first().click();
  await expect(window.getByText('Your Claude is ready · Max plan.')).toBeVisible();
  await expect(window.getByRole('link', { name: 'add it to your PATH' })).toHaveCount(0);
});
