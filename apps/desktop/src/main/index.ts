import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, nativeTheme, session } from 'electron';
import { ClaudeSession } from './claude/session.ts';
import { SignalServer } from './claude/signals.ts';
import { registerIpc } from './ipc.ts';
import { JobsService } from './jobs/service.ts';
import { Tracker } from './jobs/tracker.ts';
import { workspaceDir } from './jobs/workspace.ts';
import { notifyIfAway } from './notify.ts';
import { contentSecurityPolicy } from './policy.ts';
import { APP_ORIGIN, registerAppScheme, serveApp } from './protocol.ts';
import { applyDevPolicy, denyPermissions, hardenContents } from './security.ts';
import { createMainWindow } from './window.ts';

// Set by `pnpm dev`: the screens come from Vite's dev server instead of the built files.
const devUrl = process.env.FACTWRIGHT_DEV_URL;
const startUrl = devUrl ?? `${APP_ORIGIN}/index.html`;

if (app.requestSingleInstanceLock()) {
  start();
} else {
  // Factwright is already open, and that copy brings its window forward.
  app.quit();
}

/** Factwright's Claude Code plugin: from the repo while developing, from the app once installed. */
function pluginDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'plugin')
    : join(app.getAppPath(), '..', '..', 'plugin');
}

function start(): void {
  registerAppScheme();
  app.on('web-contents-created', (_event, contents) => hardenContents(contents));

  app.whenReady().then(async () => {
    const policy = contentSecurityPolicy(devUrl);
    if (devUrl) applyDevPolicy(session.defaultSession, policy);
    else serveApp(fileURLToPath(new URL('../renderer', import.meta.url)), policy);
    denyPermissions(session.defaultSession);

    const signals = new SignalServer();
    await signals.start();

    const dataDir = app.getPath('userData');
    let window = createMainWindow(startUrl);
    const claude = new ClaudeSession({
      dataDir,
      pluginDir: pluginDir(),
      signals,
      dark: () => nativeTheme.shouldUseDarkColors,
      onOutput: (data) => window.webContents.send('claude:output', data),
      onSignal: (signal) => {
        window.webContents.send('claude:signal', signal);
        notifyIfAway(window, signal);
      },
    });
    // The tracker sits beside the workspace, not in it, so Claude's file tools can't reach it.
    const tracker = new Tracker(join(dataDir, 'tracker.db'));
    const workspace = workspaceDir(dataDir);
    const jobs = new JobsService({
      workspace,
      tracker,
      onChange: (list) => window.webContents.send('jobs:changed', list),
    });
    jobs.read();
    jobs.watch();
    registerIpc({
      isAppPage: (url) => url.startsWith(devUrl ?? `${APP_ORIGIN}/`),
      claude,
      jobs,
      workspace,
    });

    // A run belongs to its window, so closing the window or quitting stops it.
    const stopWithWindow = (opened: BrowserWindow) => opened.on('closed', () => claude.stop());
    stopWithWindow(window);
    app.on('before-quit', () => {
      claude.stop();
      signals.stop();
      jobs.stop();
    });
    app.on('quit', () => tracker.close());

    app.on('second-instance', () => {
      if (window.isMinimized()) window.restore();
      window.focus();
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length > 0) return;
      window = createMainWindow(startUrl);
      stopWithWindow(window);
    });
  });

  app.on('window-all-closed', () => {
    // Mac apps stay open with no windows, until the user quits.
    if (process.platform !== 'darwin') app.quit();
  });
}
