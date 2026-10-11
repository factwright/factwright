import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, nativeTheme, session } from 'electron';
import { RunServer } from './claude/run-server.ts';
import { checkSetup, SetupChecker } from './claude/self-test.ts';
import { ClaudeSession, prepareLaunch, startHidden } from './claude/session.ts';
import { registerIpc } from './ipc.ts';
import { JobsService } from './jobs/service.ts';
import { Tracker } from './jobs/tracker.ts';
import { workspaceDir } from './jobs/workspace.ts';
import { notifyIfAway } from './notify.ts';
import { contentSecurityPolicy } from './policy.ts';
import { APP_ORIGIN, registerAppScheme, serveApp } from './protocol.ts';
import { ElectronResumePrinter } from './resume/printer.ts';
import { applyDevPolicy, denyPermissions, hardenContents } from './security.ts';
import { factwrightTools } from './tools/index.ts';
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

    const dataDir = app.getPath('userData');
    // The tracker sits beside the workspace, not in it, so Claude's file tools can't reach it.
    // Claude reaches it only through Factwright's tools.
    const tracker = new Tracker(join(dataDir, 'tracker.db'));
    const workspace = workspaceDir(dataDir);
    const jobs = new JobsService({
      workspace,
      tracker,
      onChange: (list) => window.webContents.send('jobs:changed', list),
    });
    jobs.read();
    const printer = new ElectronResumePrinter();
    const server = new RunServer({
      tools: factwrightTools({ jobs, workspace, printer }),
      version: app.getVersion(),
    });
    await server.start();

    let window = createMainWindow(startUrl);
    jobs.watch();
    const claude = new ClaudeSession({
      dataDir,
      pluginDir: pluginDir(),
      server,
      dark: () => nativeTheme.shouldUseDarkColors,
      onOutput: (data) => window.webContents.send('claude:output', data),
      onSignal: (signal) => {
        window.webContents.send('claude:signal', signal);
        notifyIfAway(window, signal);
      },
      onTrust: () => {
        window.webContents.send('claude:trust');
        notifyIfAway(window, 'needs-answer');
      },
    });
    // Claude Code updates itself, so each new version gets a check, hidden, that uses no plan.
    const setup = new SetupChecker({
      file: join(dataDir, 'setup-check.json'),
      check: (signal) =>
        checkSetup({
          launch: () =>
            prepareLaunch({
              dataDir,
              pluginDir: pluginDir(),
              server,
              dark: nativeTheme.shouldUseDarkColors,
              name: 'self-test',
            }),
          start: startHidden,
          server,
          signal,
        }),
      onChange: (check) => window.webContents.send('setup:checked', check),
      busy: () => claude.busy(),
      // The end-to-end tests set a shorter wait, to see the check finish.
      ...(process.env.FACTWRIGHT_SETUP_WAIT_MS && {
        waitMs: Number(process.env.FACTWRIGHT_SETUP_WAIT_MS),
      }),
    });
    await setup.load();
    registerIpc({
      isAppPage: (url) => url.startsWith(devUrl ?? `${APP_ORIGIN}/`),
      claude,
      setup,
      jobs,
      workspace,
    });

    // A run belongs to its window, so closing the window or quitting stops it.
    const stopWithWindow = (opened: BrowserWindow) => opened.on('closed', () => claude.stop());
    stopWithWindow(window);
    app.on('before-quit', () => {
      claude.stop();
      setup.stop();
      server.stop();
      printer.close();
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
