import { appendFileSync, existsSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  autoUpdater as macInstaller,
  nativeTheme,
  powerMonitor,
  safeStorage,
  session,
  shell,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import type { PermissionAnswer, PermissionAsk } from '../shared/permission-asks.ts';
import type { QuestionRound, RoundReply } from '../shared/rounds.ts';
import { TemplatePreviews } from './about/previews.ts';
import { AboutStore } from './about/store.ts';
import { Desk } from './claude/desk.ts';
import { useClaudeFolder } from './claude/launch.ts';
import { RunServer } from './claude/run-server.ts';
import { checkSetup, SetupChecker } from './claude/self-test.ts';
import { ClaudeSession, prepareLaunch, startHidden } from './claude/session.ts';
import { registerIpc } from './ipc.ts';
import { Revisions } from './jobs/revisions.ts';
import { JobsService } from './jobs/service.ts';
import { Tracker } from './jobs/tracker.ts';
import { watchWorkspace, workspaceDir } from './jobs/workspace.ts';
import { MainWindow } from './main-window.ts';
import { notifyIfAway, notifyOfRequests, remindOfCall } from './notify.ts';
import { JobOpener } from './open-job.ts';
import { contentSecurityPolicy } from './policy.ts';
import {
  chooseProfile,
  claudeFolder,
  FIRST_PROFILE,
  noteStarting,
  type ProfileFolder,
  Profiles,
  prepareClaudeFolder,
  profileToOpen,
  stoppedStart,
} from './profiles.ts';
import { APP_ORIGIN, registerAppScheme, serveApp } from './protocol.ts';
import { CallReminders } from './reminders.ts';
import { ElectronResumePrinter } from './resume/printer.ts';
import { TemplateLibrary } from './resume/templates.ts';
import { applyDevPolicy, denyPermissions, hardenContents } from './security.ts';
import { SyncAccount } from './sync/account.ts';
import { NO_KEYCHAIN } from './sync/secrets.ts';
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
 * Factwright's own sync server, built into its releases, or none in a copy built anywhere else,
 * such as from a fork, so that copy never syncs through Factwright's. Development and tests point
 * it at one, such as one running locally. A server of your own is never set here: it's typed in
 * the sync dialog, and kept with sync's sign-in in the profile's folder (sync/account.ts).
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
 * Whether an installed copy was asked to let another program drive it, through Chromium's
 * debugging port, as its own tests do. A copy being developed runs whatever code it's given.
 */
const driven =
  app.isPackaged &&
  ['remote-debugging-port', 'remote-debugging-pipe'].some((name) =>
    app.commandLine.hasSwitch(name),
  );

/**
 * Whether the app is driven by another program while using the user's own data: their own data
 * folder, or a profile in it. Like Chrome, an installed copy then won't start: with a folder of
 * its own, as the tests give it, it's an empty app, with no job hunt and no sync to reach. Each
 * folder is checked as it really is, through any links.
 */
function debuggingTheUsersData(folders: string[]): boolean {
  if (!driven) return false;
  const usersOwn = realFolder(join(app.getPath('appData'), app.getName()));
  return folders
    .map(realFolder)
    .some((folder) => folder === usersOwn || folder.startsWith(usersOwn + sep));
}

/**
 * Opens a profile. Its folder becomes the data folder for everything, Chromium's own storage and
 * the lock that keeps one copy of the app on it included, and an added profile's Claude Code
 * gets a folder of its own. So this comes before anything uses either.
 */
function openProfile(home: string, profile: ProfileFolder): void {
  if (profile.dir !== home) app.setPath('userData', profile.dir);
  const claude = claudeFolder(profile);
  if (claude) {
    try {
      prepareClaudeFolder(claude);
    } catch {
      // Claude Code makes its folder itself, when it first runs.
    }
  }
  useClaudeFolder(claude);
}

// On Windows, the installer's shortcuts carry this ID, and notifications need the app to match it.
if (process.platform === 'win32') app.setAppUserModelId('com.factwright.app');

// The app's own data folder, as Electron gives it: the first profile's, which holds the others.
const home = app.getPath('userData');
// The profile chosen last, read before anything uses the data folder, and one whose last start
// stopped short, which the first profile opens in place of.
const stopped = stoppedStart(home);
const profile = profileToOpen(home);

if (debuggingTheUsersData([home, profile.dir])) {
  app.exit(1);
} else {
  openProfile(home, profile);
  if (app.requestSingleInstanceLock()) {
    try {
      // After one stopped short, the first profile opens from now on, until another is chosen.
      if (stopped) chooseProfile(home, FIRST_PROFILE);
      else noteStarting(home, profile);
    } catch {
      // Without the note, a profile that can't start opens again next time.
    }
    start(home, profile, stopped);
  } else {
    // Factwright is already open on this profile, and that copy brings its window forward.
    app.quit();
  }
}

/** Factwright's Claude Code plugin: from the repo while developing, from the app once installed. */
function pluginDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'plugin')
    : join(app.getAppPath(), '..', '..', 'plugin');
}

function start(home: string, profile: ProfileFolder, stopped: ProfileFolder | null): void {
  registerAppScheme();
  app.on('web-contents-created', (_event, contents) => hardenContents(contents));

  app.whenReady().then(async () => {
    if (!app.isPackaged) app.dock?.setIcon(DEV_ICON);
    const policy = contentSecurityPolicy(devUrl);
    if (devUrl) applyDevPolicy(session.defaultSession, policy);
    else serveApp(fileURLToPath(new URL('../renderer', import.meta.url)), policy);
    denyPermissions(session.defaultSession);

    // Opens a job in the window, such as when the user clicks a call's reminder.
    const opener = new JobOpener();
    // The app's window, whichever one is open: everything reaches it through this. A run belongs
    // to its window, so closing it stops the run. On Windows and Linux, the app quits once its
    // last window closes, and the hidden window resumes print in would keep it running unseen, so
    // that closes first. A Mac app keeps running with its window closed, and so does that one,
    // ready for the next print: closing it there could leave a print it was doing unfinished.
    const window = new MainWindow({
      open: () => {
        const opened = createMainWindow(startUrl, syncServer !== null);
        // A page loading again can't hear a job to open until it says it's listening.
        const page = opened.webContents;
        page.on('did-start-loading', () => opener.forget(page));
        return opened;
      },
      closed: () => {
        if (process.platform !== 'darwin') printer.close();
        claude.stop();
      },
    });

    // The open profile's folder, which holds its job hunt, its sync and its settings.
    const dataDir = app.getPath('userData');
    // The tracker sits beside the workspace, not in it, so Claude's file tools can't reach it.
    // Claude reaches it only through Factwright's tools.
    const tracker = new Tracker(join(dataDir, 'tracker.db'));
    const workspace = workspaceDir(dataDir);
    const profiles = new Profiles({
      home,
      open: profile,
      platform: process.platform,
      ownName: () => about.answers().you.name,
      trash: (path) => shell.trashItem(path),
      busy: () => claude.busy(),
      stopped,
      restart: () => {
        // An update that's ready installs as the app restarts, then opens the profile chosen.
        if (updates?.install()) return;
        // While developing, the screens' server closes with the app, and the tests start it
        // again themselves.
        if (!devUrl && develop('FACTWRIGHT_RELAUNCH') !== 'off') app.relaunch();
        app.quit();
      },
    });
    // A reminder an hour before each call. Clicking it brings the window forward, or opens it
    // again on a Mac, on the call's job.
    const reminders = new CallReminders({
      file: join(dataDir, 'call-reminders.json'),
      jobs: () => jobs.list().jobs,
      notify: (reminder) =>
        remindOfCall(reminder, (jobId) => {
          window.show();
          const page = window.current()?.webContents;
          if (page) opener.open(jobId, page);
        }),
    });
    const sync = new SyncAccount({
      dataDir,
      server: syncServer,
      version: app.getVersion(),
      // On a Mac every copy of Factwright shares one Keychain item, which locks every profile's
      // sync keys. So a driven copy gets no keychain for sync, on any computer, wherever its data
      // folder is: sync can't turn on in it, and keys in its folder, even ones copied or linked
      // from the user's own, stay locked and as they are.
      keychain: driven ? NO_KEYCHAIN : safeStorage,
      tracker,
      workspace,
      openUrl: (url) => shell.openExternal(url),
      onStatus: (status) => {
        window.send('sync:status', status);
        // Which account this profile syncs with, and on which server, so no other profile here
        // signs in to it.
        if (status.state === 'off') profiles.noteSync(null);
        else if ('email' in status && status.email) {
          profiles.noteSync({ email: status.email, server: status.ownServer ?? null });
        }
      },
      onApprovals: (view) => {
        window.send('sync:approvals', view);
        notifyOfRequests(view.requests, window);
      },
      otherProfiles: () => profiles.otherSyncAccounts(),
      // Changes from other devices: read the workspace again, and show the new list.
      onApplied: () => {
        window.send('jobs:changed', jobs.read());
        reminders.check({ synced: true });
      },
    });
    const jobs = new JobsService({
      workspace,
      tracker,
      trash: (path) => shell.trashItem(path),
      onChange: (list) => {
        window.send('jobs:changed', list);
        sync.requestSync();
        reminders.check();
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
      tools: factwrightTools({ jobs, about, facts: about.facts, workspace, printer, templates }),
      version: app.getVersion(),
    });
    await server.start();

    jobs.watch();
    // Claude fills in the fact bank and builds resumes as it goes, and other devices sync theirs,
    // so the profile follows the workspace too.
    const stopWatchingProfile = watchWorkspace(
      workspace,
      () => {
        window.send('about:changed', about.profile());
      },
      500,
    );
    // Claude's questions, which the user answers in a dialog in the window rather than the terminal.
    const questions = new Desk<QuestionRound, RoundReply>((round) =>
      window.send('claude:question', round),
    );
    // Claude Code's permission prompts, which the user answers in a dialog in the window too.
    const permissionAsks = new Desk<PermissionAsk, PermissionAnswer>((ask) =>
      window.send('claude:permission', ask),
    );
    const claude = new ClaudeSession({
      dataDir,
      pluginDir: pluginDir(),
      server,
      dark: () => nativeTheme.shouldUseDarkColors,
      onOutput: (data) => window.send('claude:output', data),
      onSignal: (signal) => {
        window.send('claude:signal', signal);
        notifyIfAway(window, signal);
      },
      onTrust: () => {
        window.send('claude:trust');
        notifyIfAway(window, 'needs-answer');
      },
      onFiled: (filed) => window.send('facts:filed', filed),
      ask: (round, signal) => questions.ask(round, signal),
      permit: (ask, signal) => permissionAsks.ask(ask, signal),
      templateName: (id) =>
        templates.list().find((template) => template.own && template.id === id)?.name ?? null,
    });
    // Once the window shows, the profile has started, so it opens again next time. A note that
    // couldn't be written then is tried again as the window comes forward, or the app quits.
    window.open().once('ready-to-show', () => profiles.started());
    app.on('browser-window-focus', () => profiles.started());
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
      onChange: (check) => window.send('setup:checked', check),
      busy: () => claude.busy(),
      // The end-to-end tests set a shorter wait, to see the check finish.
      ...(process.env.FACTWRIGHT_SETUP_WAIT_MS && {
        waitMs: Number(process.env.FACTWRIGHT_SETUP_WAIT_MS),
      }),
    });
    await setup.load();
    // A copy installed from Factwright's own release keeps itself up to date. One being
    // developed, or built anywhere else, such as from a fork, has no update settings and doesn't,
    // and the end-to-end tests turn it off.
    const updates =
      app.isPackaged &&
      existsSync(join(process.resourcesPath, 'app-update.yml')) &&
      process.env.FACTWRIGHT_UPDATES !== 'off'
        ? new UpdateWatcher({
            updater: autoUpdater,
            macInstaller: process.platform === 'darwin' ? macInstaller : null,
            busy: () => claude.busy(),
            onStatus: (status) => window.send('updates:changed', status),
            // Updates are the app's, not a profile's, so their log is in the app's own folder.
            log: (message) => logUpdate(home, message),
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
      questions,
      permissionAsks,
      setup,
      jobs,
      revisions: new Revisions({ workspace, jobs: () => jobs.list().jobs }),
      workspace,
      sync,
      dataDir,
      updates,
      profiles,
      reminders,
      opener,
    });
    void sync.start();
    void reminders.start();
    // A call's hour can begin while the computer sleeps, so waking looks again.
    powerMonitor.on('resume', () => reminders.check());
    powerMonitor.on('unlock-screen', () => reminders.check());

    // A request to link this computer is called off before the app goes, so it doesn't wait on
    // the other devices. Quitting waits for that once, for a moment at most.
    let calledOff = false;
    app.on('before-quit', (event) => {
      const callingOff = calledOff ? null : sync.callOffBeforeQuit();
      if (callingOff) {
        calledOff = true;
        event.preventDefault();
        void callingOff.finally(() => app.quit());
        return;
      }
      profiles.started();
      updates?.stop();
      reminders.stop();
      claude.stop();
      setup.stop();
      server.stop();
      printer.close();
      jobs.stop();
      stopWatchingProfile();
      void sync.stop();
    });
    app.on('quit', () => tracker.close());

    // Opening the app again brings its window forward. On a Mac, where the app keeps running with
    // its window closed, that opens it again, and so does clicking the Dock: the hidden window
    // resumes print in doesn't count as one that's open.
    app.on('second-instance', () => window.show());
    app.on('activate', () => window.open());
  });

  app.on('window-all-closed', () => {
    // Mac apps stay open with no windows, until the user quits.
    if (process.platform !== 'darwin') app.quit();
  });
}
