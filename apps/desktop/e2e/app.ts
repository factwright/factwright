import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import electronPath from 'electron';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const fakeClaude = join(desktop, 'e2e', 'fake-claude');

export interface Opened {
  app: ElectronApplication;
  window: Page;
}

/**
 * Opens the built app on a data folder, with the stand-in Claude Code first on PATH, so no run
 * reaches the user's own Claude Code or their plan. When the app doesn't reach its jobs screen,
 * the error says how far it got, with what it printed.
 */
export async function openApp(dataDir: string, env: Record<string, string> = {}): Promise<Opened> {
  const app = await _electron.launch({
    executablePath: electronPath as unknown as string,
    args: [desktop, `--user-data-dir=${dataDir}`],
    env: {
      ...process.env,
      PATH: [fakeClaude, process.env.PATH ?? ''].join(delimiter),
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
    step = 'waiting for its jobs screen';
    await window.getByRole('heading', { name: 'Jobs' }).waitFor({ timeout: 20_000 });
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
