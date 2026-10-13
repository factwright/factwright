// The app as its installers build it, with its own plugin, node-pty unpacked beside its archive,
// and its fuses on. Those fuses turn off the debugger Playwright's Electron launcher drives, so
// this starts the app itself and drives its window over Chromium's debugging port instead.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, join } from 'node:path';
import { type Browser, chromium, expect, type Page, test } from '@playwright/test';
import { desktop, fakeClaude } from './paths.ts';
import { newDataFolder } from './workspace.ts';

/** Where the installers leave the app, unpacked, for each kind of computer. */
const BUILT: Readonly<Record<string, string>> = {
  darwin: 'dist/mac-universal/Factwright.app/Contents/MacOS/Factwright',
  win32: 'dist/win-unpacked/Factwright.exe',
};

const executable =
  process.env.FACTWRIGHT_PACKAGED_APP ?? join(desktop, BUILT[process.platform] ?? 'none');

test.describe.configure({ mode: 'serial' });
// On this computer, these wait for a build. In a release, a missing build fails them, so a build
// that went somewhere else can't pass for one that works.
const built = existsSync(executable);
test.skip(
  !built && !process.env.CI,
  `No built app at ${executable}: run pnpm dist:mac or dist:win.`,
);

let dataDir: string;
let app: ChildProcess;
let browser: Browser;
let window: Page;

/** A port nothing on this computer is using. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

test.beforeAll(async () => {
  if (!built) throw new Error(`No built app at ${executable}.`);
  dataDir = newDataFolder();
  const port = await freePort();
  const printed: string[] = [];
  app = spawn(executable, [`--user-data-dir=${dataDir}`, `--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      PATH: [fakeClaude, process.env.PATH ?? ''].join(delimiter),
      FACTWRIGHT_SETUP_WAIT_MS: '500',
      FACTWRIGHT_UPDATES: 'off',
    },
  });
  app.stdout?.on('data', (data) => printed.push(String(data)));
  app.stderr?.on('data', (data) => printed.push(String(data)));
  const until = Date.now() + 30_000;
  while (!browser) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      if (Date.now() > until || app.exitCode !== null) {
        throw new Error(`The app didn't open: ${String(error)}\n${printed.join('')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const context = browser.contexts()[0];
  if (!context) throw new Error('The app has no window.');
  window =
    context.pages().find((page) => page.url().startsWith('app://')) ??
    (await context.waitForEvent('page', { predicate: (page) => page.url().startsWith('app://') }));
});

/** Stops the app and every process it started, which Windows needs before its files can go. */
async function stop(): Promise<void> {
  if (!app || app.exitCode !== null) return;
  const exited = new Promise((resolve) => app.once('exit', resolve));
  if (process.platform === 'win32' && app.pid) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f']);
  } else {
    app.kill();
  }
  await exited;
}

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  await stop();
  // Windows can hold a file a moment after the process that had it open has gone.
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

test('opens on the jobs on file, with its Claude ready', async () => {
  await expect(window.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  await expect(window.getByText('Signed in · Max plan')).toBeVisible();
});

test('reaches Claude Code with its own plugin, and the setup check passes', async () => {
  await expect
    .poll(
      () => {
        try {
          return JSON.parse(readFileSync(join(dataDir, 'setup-check.json'), 'utf8')).result;
        } catch {
          return null;
        }
      },
      { timeout: 30_000 },
    )
    .toBe('passed');
});

// Never on this computer, where it would start on the user's own data folder.
test('won’t open with a debugging port on the user’s own data folder', async () => {
  test.skip(!process.env.CI, 'Only on a build machine, which has no one’s data.');
  const started = spawn(executable, ['--remote-debugging-port=0'], {
    env: { ...process.env, FACTWRIGHT_UPDATES: 'off' },
  });
  const code = await new Promise((resolve) => started.once('exit', resolve));
  expect(code).toBe(1);
});

test('reads and shows the fact bank', async () => {
  const facts = join(dataDir, 'workspace', 'facts');
  mkdirSync(facts, { recursive: true });
  writeFileSync(
    join(facts, 'larkspur-logistics.md'),
    '# Larkspur Logistics\n\n### Route planner\n`live` `solo` `high`\n> Built a route planner.\n',
  );
  await window
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Fact bank/ })
    .click();
  await expect(window.getByRole('article', { name: 'Route planner' })).toBeVisible();
});
