// Runs the app for development. The screens reload as they're edited, and the app restarts when
// the main process or preload script changes. Extra arguments go to Electron, for example
// `pnpm dev --remote-debugging-port=9223`.
import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build, createServer, type Plugin } from 'vite';

// Inside Node, the electron package's only export is the path to its binary.
const electronPath = createRequire(import.meta.url)('electron') as string;

const screens = await createServer({ configFile: 'vite.renderer.config.ts' });
await screens.listen();
const devUrl = screens.resolvedUrls?.local[0];
if (!devUrl) throw new Error('The screens dev server did not report a URL.');

let app: ChildProcess | undefined;
let restarting = false;

function startApp(): void {
  app = spawn(electronPath, ['.', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, FACTWRIGHT_DEV_URL: devUrl },
  });
  app.on('exit', () => {
    // Closing the app ends the session, unless it's closing to restart.
    if (restarting) return;
    void screens.close();
    process.exit(0);
  });
}

function restartApp(): void {
  if (!app || app.exitCode !== null) {
    startApp();
    return;
  }
  restarting = true;
  app.once('exit', () => {
    restarting = false;
    startApp();
  });
  app.kill();
}

// Both builds finish once before the first start. Every rebuild after that restarts the app.
let builds = 0;
const restartAfterBuild: Plugin = {
  name: 'restart-app',
  closeBundle() {
    builds += 1;
    if (builds >= 2) restartApp();
  },
};

await build({
  configFile: 'vite.preload.config.ts',
  build: { watch: {} },
  plugins: [restartAfterBuild],
});
await build({
  configFile: 'vite.main.config.ts',
  build: { watch: {} },
  plugins: [restartAfterBuild],
});
