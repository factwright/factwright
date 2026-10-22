import { delimiter } from 'node:path';
import {
  _electron,
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import electronPath from 'electron';
import { desktop, fakeClaude } from './paths.ts';
import { usersClaude } from './workspace.ts';

export interface Opened {
  app: ElectronApplication;
  window: Page;
}

/**
 * Opens the built app on a data folder, with the stand-in Claude Code first on PATH, so no run
 * reaches the user's own Claude Code or their plan, and a Claude Code folder of the tests' own,
 * so the app never changes the user's either. When the app doesn't reach its jobs, or getting
 * started for a new user, the error says how far it got, with what it printed.
 */
export async function openApp(dataDir: string, env: Record<string, string> = {}): Promise<Opened> {
  // Not a Claude Code folder of the shell's own: the tests' own stands in for the user's.
  const { CLAUDE_CONFIG_DIR: _, ...shell } = process.env;
  const app = await _electron.launch({
    executablePath: electronPath as unknown as string,
    args: [desktop, `--user-data-dir=${dataDir}`],
    env: {
      ...shell,
      PATH: [fakeClaude, process.env.PATH ?? ''].join(delimiter),
      CLAUDE_CONFIG_DIR: usersClaude(dataDir),
      // A sync server only where a test starts one, never one from the shell running the tests.
      FACTWRIGHT_SERVER_URL: '',
      // The setup check waits less, so the tests see it finish.
      FACTWRIGHT_SETUP_WAIT_MS: '500',
      // Quiet mode: the window stays hidden and never takes the keyboard, with no Dock icon or
      // notifications, so whoever is at the computer can keep using it while the tests run.
      FACTWRIGHT_QUIET: 'on',
      ...env,
    },
    timeout: 30_000,
  });
  const printed: string[] = [];
  app.process().stdout?.on('data', (data) => printed.push(String(data)));
  app.process().stderr?.on('data', (data) => printed.push(String(data)));
  let step = 'waiting for its window';
  try {
    const window = await app.firstWindow({ timeout: 20_000 });
    // E2E_NARROW makes the window as small as the screen of GitHub's Windows runners, 1024 by 768,
    // to see what the Windows workflow sees: a job's details cover the list, and Claude's panel
    // wraps more of its lines, so a run's first lines scroll out of sight sooner.
    if (process.env.E2E_NARROW) {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.setSize(1024, 768),
      );
    }
    step = 'waiting for its jobs, or getting started for a new user';
    await window
      .getByRole('heading', { name: 'Jobs' })
      .or(window.getByRole('heading', { name: 'Let’s get you set up' }))
      .waitFor({ timeout: 20_000 });
    return { app, window };
  } catch (error) {
    const shown = await app
      .windows()[0]
      ?.evaluate<string>('document.body.innerText.slice(0, 1500)')
      .catch(() => null);
    await app.close().catch(() => {});
    throw new Error(
      [
        `The app stopped ${step}: ${error instanceof Error ? error.message : String(error)}`,
        `It showed: ${shown ?? '(no window)'}`,
        `It printed:\n${printed.join('') || '(nothing)'}`,
      ].join('\n'),
    );
  }
}

/**
 * Shows Claude's work, the terminal under the run's bar, as a person does to type into it, when
 * it's folded away. True when it was.
 */
export async function showWork(window: Page): Promise<boolean> {
  const show = window
    .locator('section[aria-label="Claude"]')
    .getByRole('button', { name: 'Show Claude’s work' });
  if ((await show.count()) === 0) return false;
  await show.click();
  return true;
}

/** Folds Claude's work away again, once it was shown only to read it. */
const foldWork = (window: Page) =>
  window
    .locator('section[aria-label="Claude"]')
    .getByRole('button', { name: 'Hide Claude’s work' })
    .click();

/**
 * Reads what Claude's work shows, as a person does: the terminal draws only while it shows, so
 * this shows it while it reads, then folds it away again if it was.
 */
async function reading<T>(window: Page, read: (rows: Locator) => Promise<T>): Promise<T> {
  const folded = await showWork(window);
  const rows = window.locator('section[aria-label="Claude"] .xterm-rows');
  try {
    // Shown again, it notices a moment later, then draws its rows on the next frames, over what it
    // drew when it last showed. Once they hold still, they're all there.
    if (folded) {
      let last = '';
      await expect
        .poll(
          async () => {
            await window.evaluate(
              'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
            );
            const now = await rows.innerText();
            const still = now === last && /\S/.test(now);
            last = now;
            return still;
          },
          { intervals: [50, 100, 100, 200] },
        )
        .toBe(true);
    }
    return await read(rows);
  } finally {
    if (folded) await foldWork(window);
  }
}

/** What Claude's panel shows in its terminal, as text. */
export const terminalText = (window: Page) => reading(window, (rows) => rows.innerText());

/**
 * The top of what Claude's panel holds, where a run says which model and effort it has. A run that
 * prints more than the panel shows has scrolled it out of sight, so this scrolls back up to it, as
 * a person does, then down again. The terminal draws its rows a moment later, so poll it.
 */
export const terminalStart = (window: Page) =>
  reading(window, async (rows) => {
    await window.locator('section[aria-label="Claude"] .xterm-screen').hover();
    await window.mouse.wheel(0, -100_000);
    const text = await rows.innerText();
    await window.mouse.wheel(0, 100_000);
    return text;
  });

/** What Claude's panel shows, as one run of text, so a line too long for the panel reads whole. */
export const terminalLines = async (window: Page) =>
  (await terminalText(window)).replace(/\n/g, '');
