import { delimiter } from 'node:path';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
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

/** What Claude's panel shows in its terminal, as text. */
export const terminalText = (window: Page) =>
  window.locator('section[aria-label="Claude"] .xterm-rows').innerText();
