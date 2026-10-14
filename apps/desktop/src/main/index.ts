import { appendFileSync, existsSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  autoUpdater as macInstaller,
  nativeTheme,
  powerMonitor,
  safeStorage,
  session,
  shell,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { TemplatePreviews } from './about/previews.ts';
import { AboutStore } from './about/store.ts';
import { RunServer } from './claude/run-server.ts';
import { checkSetup, SetupChecker } from './claude/self-test.ts';
import { ClaudeSession, prepareLaunch, startHidden } from './claude/session.ts';
import { registerIpc } from './ipc.ts';
import { JobsService } from './jobs/service.ts';
import { Tracker } from './jobs/tracker.ts';
import { watchWorkspace, workspaceDir } from './jobs/workspace.ts';
import { notifyIfAway } from './notify.ts';
import { contentSecurityPolicy } from './policy.ts';
import { APP_ORIGIN, registerAppScheme, serveApp } from './protocol.ts';
import { ElectronResumePrinter } from './resume/printer.ts';
import { TemplateLibrary } from './resume/templates.ts';
import { applyDevPolicy, denyPermissions, hardenContents } from './security.ts';
import { SyncAccount } from './sync/account.ts';
import { factwrightTools } from './tools/index.ts';
import { UpdateWatcher } from './updates.ts';
import { createMainWindow, DEV_ICON } from './window.ts';

/**
 * Settings for development and tests, from the environment. An installed copy ignores them, so
 * nothing that can set a variable can point its window at other screens, or its sync elsewhere.
 */
const develop = (name: string) => (app.isPackaged ? undefined : process.env[name]);

// Set by `pnpm dev`: the screens come from Vite's dev server instead of the built files.
const devUrl = develop('FACTWRIGHT_DEV_URL');
const startUrl = devUrl ?? `${APP_ORIGIN}/index.html`;

/**
 * The sync server: Factwright's own, built into its releases, or none in a copy built anywhere
 * else, such as from a fork, so that copy never syncs through Factwright's. Development and tests
 * point it at one, such as one running locally.
 */
const syncServer = develop('FACTWRIGHT_SERVER_URL') || __SYNC_SERVER__ || null;

/** The most an update's log keeps before it starts again, as it only helps with the latest problem. */
const UPDATE_LOG_BYTES = 200_000;

/** Notes a problem with an update in the data folder, where it can help when an update won't come. */
function logUpdate(dataDir: string, message: string): void {
  const file = join(dataDir, 'updates.log');
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    if (existsSync(file) && statSync(file).size > UPDATE_LOG_BYTES) writeFileSync(file, line);
    else appendFileSync(file, line);
  } catch {
    // A log that can't be written changes nothing for the user.
  }
}

/** A folder's real path, through any links, in one case, to compare with another. */
function realFolder(folder: string): string {
  let real = resolve(folder);
  try {
    real = realpathSync(real);
  } catch {
    // A folder that isn't there yet is compared as it's written.
  }
  return process.platform === 'linux' ? real : real.toLowerCase();
}

/**
 * Whether the app was asked to let another program drive it, through Chromium's debugging port,
 * while using the user's own data folder. Like Chrome, an installed copy then won't start: with a
 * folder of its own, as the tests give it, it's an empty app, with no job hunt and no sync to reach.
 */
function debuggingTheUsersData(): boolean {
  const debugging = ['remote-debugging-port', 'remote-debugging-pipe'].some((name) =>
    app.commandLine.hasSwitch(name),
  );
  if (!app.isPackaged || !debugging) return false;
  const usersOwn = join(app.getPath('appData'), app.getName());
  return realFolder(app.getPath('userData')) === realFolder(usersOwn);
}

// On Windows, the installer's shortcuts carry this ID, and notifications need the app to match it.
if (process.platform === 'win32') app.setAppUserModelId('com.factwright.app');

if (debuggingTheUsersData()) {
  app.exit(1);
} else if (app.requestSingleInstanceLock()) {
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
    if (!app.isPackaged) app.dock?.setIcon(DEV_ICON);
    const policy = contentSecurityPolicy(devUrl);
    if (devUrl) applyDevPolicy(session.defaultSession, policy);
    else serveApp(fileURLToPath(new URL('../renderer', import.meta.url)), policy);
    denyPermissions(session.defaultSession);

    // Sends to the window, unless it's closed, as when a run ends while the app quits.
    const toWindow = (channel: string, ...values: unknown[]) => {
      if (!window.isDestroyed()) window.webContents.send(channel, ...values);
    };

    const dataDir = app.getPath('userData');
    // The tracker sits beside the workspace, not in it, so Claude's file tools can't reach it.
    // Claude reaches it only through Factwright's tools.
    const tracker = new Tracker(join(dataDir, 'tracker.db'));
    const workspace = workspaceDir(dataDir);
    const sync = new SyncAccount({
      dataDir,
      server: syncServer,
      version: app.getVersion(),
      keychain: safeStorage,
      tracker,
      workspace,
      openUrl: (url) => shell.openExternal(url),
      onStatus: (status) => toWindow('sync:status', status),
      // Changes from other devices: read the workspace again, and show the new list.
      onApplied: () => toWindow('jobs:changed', jobs.read()),
    });
    const jobs = new JobsService({
      workspace,
      tracker,
      trash: (path) => shell.trashItem(path),
      onChange: (list) => {
        toWindow('jobs:changed', list);
        sync.requestSync();
      },
    });
    jobs.read();
    const templates = new TemplateLibrary({ workspace, trash: (path) => shell.trashItem(path) });
    const about = new AboutStore({
      workspace,
      starterDir: join(pluginDir(), 'starter'),
      trash: (path) => shell.trashItem(path),
      templates: () => templates.list(),
    });
    const printer = new ElectronResumePrinter();
    const previews = new TemplatePreviews(printer, templates);
    const server = new RunServer({
      tools: factwrightTools({ jobs, about, workspace, printer, templates }),
      version: app.getVersion(),
    });
    await server.start();

    let window = createMainWindow(startUrl);
    jobs.watch();
    // Claude fills in the fact bank and builds resumes as it goes, and other devices sync theirs,
    // so the profile follows the workspace too.
    const stopWatchingProfile = watchWorkspace(
      workspace,
      () => {
        toWindow('about:changed', about.profile());
      },
      500,
    );
    const claude = new ClaudeSession({
      dataDir,
      pluginDir: pluginDir(),
      server,
      dark: () => nativeTheme.shouldUseDarkColors,
      onOutput: (data) => toWindow('claude:output', data),
      onSignal: (signal) => {
        toWindow('claude:signal', signal);
        notifyIfAway(window, signal);
      },
      onTrust: () => {
        toWindow('claude:trust');
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
      onChange: (check) => toWindow('setup:checked', check),
      busy: () => claude.busy(),
      // The end-to-end tests set a shorter wait, to see the check finish.
      ...(process.env.FACTWRIGHT_SETUP_WAIT_MS && {
        waitMs: Number(process.env.FACTWRIGHT_SETUP_WAIT_MS),
      }),
    });
    await setup.load();
    // A copy installed from GitHub's build keeps itself up to date. One being developed, or
    // built on this computer, has no update settings and doesn't, and the end-to-end tests turn
    // it off.
    const updates =
      app.isPackaged &&
      existsSync(join(process.resourcesPath, 'app-update.yml')) &&
      process.env.FACTWRIGHT_UPDATES !== 'off'
        ? new UpdateWatcher({
            updater: autoUpdater,
            macInstaller: process.platform === 'darwin' ? macInstaller : null,
            busy: () => claude.busy(),
            onStatus: (status) => toWindow('updates:changed', status),
            log: (message) => logUpdate(dataDir, message),
          })
        : null;
    if (updates) {
      updates.start();
      // Coming back to the app, or the computer waking, looks straight away, so an update that
      // came out meanwhile doesn't wait for the next look.
      app.on('browser-window-focus', () => updates.lookAgain());
      powerMonitor.on('resume', () => updates.lookAgain());
      powerMonitor.on('unlock-screen', () => updates.lookAgain());
    }
    registerIpc({
      isAppPage: (url) => url.startsWith(devUrl ?? `${APP_ORIGIN}/`),
      about,
      templates,
      previews,
      claude,
      setup,
      jobs,
      workspace,
      sync,
      dataDir,
      updates,
    });
    void sync.start();

    // A run belongs to its window, so closing the window or quitting stops it.
    const stopWithWindow = (opened: BrowserWindow) => opened.on('closed', () => claude.stop());
    stopWithWindow(window);
    app.on('before-quit', () => {
      updates?.stop();
      claude.stop();
      setup.stop();
      server.stop();
      printer.close();
      jobs.stop();
      stopWatchingProfile();
      void sync.stop();
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
