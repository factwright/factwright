import { appendFileSync, existsSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INBOX_FOLDER, localDate } from '@factwright/core';
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
import type { WaitingAsk, WaitingRound } from '../shared/api.ts';
import type { PermissionAnswer } from '../shared/permission-asks.ts';
import { PRIVATE_FILE } from '../shared/private.ts';
import type { RoundReply } from '../shared/rounds.ts';
import { type RunTask, startedOnItsOwn } from '../shared/runs.ts';
import { TemplatePreviews } from './about/previews.ts';
import { PrivateAnswers } from './about/private.ts';
import { AboutStore } from './about/store.ts';
import { AnalyzeNew } from './claude/analyze-new.ts';
import { loadAtOnce } from './claude/at-once.ts';
import { Desk, fromRun } from './claude/desk.ts';
import { useClaudeFolder } from './claude/launch.ts';
import { taskPreparer } from './claude/prepare.ts';
import { RunChanges } from './claude/run-changes.ts';
import { FormDrafts, RunRequests } from './claude/run-requests.ts';
import { RunServer } from './claude/run-server.ts';
import { ClaudeRuns } from './claude/runs.ts';
import { checkSetup, SetupChecker } from './claude/self-test.ts';
import { openRun, prepareLaunch, startHidden } from './claude/session.ts';
import { answerAsk, type FillDeps } from './extension/fill.ts';
import { JobInbox } from './extension/inbox.ts';
import { helperName, registerSaveHelper, runProgram } from './extension/register.ts';
import { createSaveHelper } from './extension/save-helper.ts';
import { registerIpc } from './ipc.ts';
import { Revisions } from './jobs/revisions.ts';
import { JobsService } from './jobs/service.ts';
import { Tracker } from './jobs/tracker.ts';
import { Versions } from './jobs/versions.ts';
import { watchWorkspace, workspaceDir } from './jobs/workspace.ts';
import { MainWindow } from './main-window.ts';
import { notifyIfAway, notifyOfRequests, notifyRunDone, remindOfCall } from './notify.ts';
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
import { QUIET } from './quiet.ts';
import { CallReminders } from './reminders.ts';
import { ElectronResumePrinter } from './resume/printer.ts';
import { TemplateLibrary } from './resume/templates.ts';
import { applyDevPolicy, denyPermissions, hardenContents } from './security.ts';
import { SyncAccount } from './sync/account.ts';
import { Claims } from './sync/claims.ts';
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

/**
 * A file holding what Greenhouse's job API answers for a job's form, which the tests' copy reads
 * in its place, so the tests never reach Greenhouse.
 */
const formFeedFile = develop('FACTWRIGHT_FORM_FEED');

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

/** The job a run drafts a form's questions for, as the browser extension asked, or null. */
const draftsFor = (task: RunTask | null): string | null =>
  task && 'form' in task ? task.jobId : null;

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
    // In quiet mode, for the app's tests, it has no Dock icon to show or bounce.
    if (QUIET) app.dock?.hide();
    else if (!app.isPackaged) app.dock?.setIcon(DEV_ICON);
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
        claude.closeAll();
      },
      quiet: QUIET,
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
      ownName: () => about.answers().you.name,
      trash: (path) => shell.trashItem(path),
      // Only work going waits, in any run: Claude Code that's done closes as the app restarts.
      busy: () => claude.working(),
      stopped,
      restart: async () => {
        // An update that's ready installs as the app restarts, then opens the profile chosen.
        if (await updates?.install()) return;
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
    // Claude analyzing new jobs on its own, and the claims on jobs that keep two computers from
    // both analyzing one, once everything they need is open, further down.
    let analyzeNew: AnalyzeNew | null = null;
    let claims: Claims | null = null;
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
        // A round that got through may let jobs that waited for sync be claimed now.
        if (status.state === 'on' && status.activity === 'idle') analyzeNew?.look();
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
        // Another computer may have claimed a job a run of Claude's own here is on, and a job
        // saved on another device may be one for Claude to analyze on its own.
        claims?.synced();
        analyzeNew?.look();
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
        // A job saved may be one for Claude to analyze on its own.
        analyzeNew?.look();
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
    // Profile's street, postal code and equal-opportunity answers for applications, kept beside
    // the tracker, never in the workspace, so they never sync and Claude's tools never reach them.
    const kept = new PrivateAnswers(join(dataDir, PRIVATE_FILE));
    const printer = new ElectronResumePrinter();
    const previews = new TemplatePreviews(printer, templates);
    const server = new RunServer({
      tools: factwrightTools({
        jobs,
        about,
        facts: about.facts,
        workspace,
        printer,
        templates,
        // Analyze job merges a job only while no other task is on it, here or on another
        // computer whose claim holds it.
        busy: (jobId) => claude.holds(jobId) || (claims?.elsewhere(jobId) ?? false),
      }),
      version: app.getVersion(),
    });
    await server.start();

    jobs.watch();
    // The runs drafting forms' questions, as the browser extension follows them.
    const formDrafts = new FormDrafts();
    // How many runs may go at once, as the user chose, read before anything can start one.
    const atOnce = await loadAtOnce(dataDir);
    // Claude's questions, from every run, which the user answers in turn in a dialog in the
    // window rather than the terminal.
    const questions = new Desk<WaitingRound, RoundReply>((rounds) =>
      window.send('claude:question', rounds),
    );
    // Claude Code's permission prompts, which the user answers in the window's dialog too.
    const permissionAsks = new Desk<WaitingAsk, PermissionAnswer>((asks) =>
      window.send('claude:permission', asks),
    );
    const revisions = new Revisions({ workspace, jobs: () => jobs.list().jobs });
    const versions = new Versions({
      workspace,
      jobs: () => jobs.list().jobs,
      trash: (path) => shell.trashItem(path),
    });
    // What each of Claude's tasks changes, with a copy of each file from before it, kept beside the
    // workspace rather than in it, so Claude can't reach them, for Undo on the task's card.
    const runChanges = new RunChanges({
      workspace,
      folder: join(dataDir, 'undo'),
      trash: (path) => shell.trashItem(path),
    });
    // The user's Claude runs, side by side, each in a tab of the window's panel, and the line of
    // tasks waiting their turn. Each run's questions and permission prompts name it.
    const claude = new ClaudeRuns({
      open: (id, size, options, events) =>
        openRun(
          id,
          size,
          options,
          {
            dataDir,
            pluginDir: pluginDir(),
            server,
            dark: () => nativeTheme.shouldUseDarkColors,
            ask: (round, signal) => questions.ask(fromRun(id, round), signal),
            permit: (ask, signal) => permissionAsks.ask(fromRun(id, ask), signal),
            templateName: (template) =>
              templates.list().find((each) => each.own && each.id === template)?.name ?? null,
            changes: runChanges.forRun(),
          },
          events,
        ),
      prepare: taskPreparer({ dataDir, revisions, versions }),
      atOnce,
      onView: (view) => {
        window.send('claude:runs', view);
        // Each run with work going holds its jobs' claims, and a run that ended lets go.
        claims?.heard(view);
        // A run that ended, or a slot that freed, may let Claude analyze new jobs on its own.
        analyzeNew?.look();
      },
      onOwnEnded: (run, end, analyzed) => analyzeNew?.ended(run, end, analyzed),
      onOutput: (runId, data) => window.send('claude:output', { runId, data }),
      onSignal: (run, signal) => {
        // A run Claude started on its own stays quiet: its tab and the jobs show how it went.
        if (!startedOnItsOwn(run.task)) notifyIfAway(window, signal);
        const drafting = draftsFor(run.task);
        if (drafting) formDrafts.heard(signal, drafting);
      },
      // Claude Code's first-run screens and its question about trust wait on the user too.
      onScreen: (run) => {
        if (!startedOnItsOwn(run.task)) notifyIfAway(window, 'needs-answer');
        const drafting = draftsFor(run.task);
        if (drafting) formDrafts.waitsOnYou(drafting);
      },
      onStep: (runId, step) => window.send('claude:step', { runId, step }),
      onTurnEnd: (runId, end) => window.send('claude:turn-end', { runId, end }),
      onFiled: (runId, filed) => window.send('facts:filed', { runId, filed }),
      onChanges: (runId, changes) => window.send('claude:changes', { runId, changes }),
    });
    // Jobs the extension saved on this computer, which the helper each browser starts drops
    // in the profile's inbox: the ones that came while the app was closed now, the rest as they
    // come. The runs come first, as an ask can need them as soon as the inbox starts.
    // The extension's asks as it fills an application form come the same way, while the app
    // is open.
    // Your Claude drafting a form's questions, which the extension asks for: the window starts
    // the run, as only it has Claude's panel, without coming to the front.
    const runRequests = new RunRequests((request) => window.send('claude:run-request', request));
    const drafts: FillDeps['drafts'] = {
      start: async (jobId) => {
        // The window says so before it starts the run, so this comes before the run's signals.
        const started = await runRequests.start({ skill: 'answer-questions', jobId, form: true });
        if (started === 'started') formDrafts.started(jobId);
        return started;
      },
      // A question or permission prompt in the window from the run drafting them waits on the
      // user too.
      state: (jobId) =>
        formDrafts.state(
          jobId,
          claude
            .list()
            .some(
              (run) =>
                draftsFor(run.task) === jobId &&
                (questions.waitsFor(run.id) || permissionAsks.waitsFor(run.id)),
            ),
        ),
    };
    const inbox = new JobInbox({
      folder: join(dataDir, INBOX_FOLDER),
      add: (job) => jobs.addSaved(job),
      added: () => jobs.sendList(),
      answer: (ask) => answerAsk(ask, { jobs, about, kept, workspace, drafts }),
    });
    try {
      inbox.start();
    } catch {
      // The inbox never keeps the app from opening: what's in it waits for the next start.
    }
    // Each browser on this computer may start the helper, for the extension alone, once the
    // app has told it where the helper is. Windows tells each browser it finds as the app starts.
    // On a Mac, the user sets each browser up in the Browser extension window, as macOS asks them
    // first, and a start keeps the ones set up current. A copy another program drives, as the tests
    // do, leaves the browsers as they are, and so does one run from the code, unless it's given an
    // unpacked extension's ID to allow too.
    const unpacked = develop('FACTWRIGHT_EXTENSION_ID');
    const helperDeps =
      !driven && (app.isPackaged || unpacked)
        ? {
            platform: process.platform,
            userHome: app.getPath('home'),
            env: {
              APPDATA: app.getPath('appData'),
              LOCALAPPDATA: process.env.LOCALAPPDATA,
              SystemRoot: process.env.SystemRoot,
            },
            appHome: home,
            helper: app.isPackaged
              ? process.platform === 'darwin'
                ? join(process.resourcesPath, 'helper', helperName(process.platform))
                : join(dirname(process.execPath), helperName(process.platform))
              : join(app.getAppPath(), 'helper', 'out', helperName(process.platform)),
            version: app.getVersion(),
            extraChromeIds: unpacked ? [unpacked] : [],
            run: runProgram,
          }
        : null;
    if (helperDeps) {
      void registerSaveHelper(helperDeps).catch((error: unknown) => {
        // The next start tries again. A copy run from the code says why, such as an ID mistyped.
        if (!app.isPackaged) console.error('Registering the helper with the browsers:', error);
      });
    }
    const saveHelper = createSaveHelper(helperDeps, {
      platform: process.platform,
      openExternal: (url) => shell.openExternal(url),
    });
    // Claude fills in the fact bank and builds resumes as it goes, and other devices sync theirs,
    // so the profile follows the workspace too.
    const stopWatchingProfile = watchWorkspace(
      workspace,
      () => {
        window.send('about:changed', about.profile());
      },
      500,
    );
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
      onChange: (check) => {
        window.send('setup:checked', check);
        // Claude past its first screens may analyze new jobs on its own now.
        analyzeNew?.look();
      },
      busy: () => claude.busy(),
      // The end-to-end tests set a shorter wait, to see the check finish.
      ...(process.env.FACTWRIGHT_SETUP_WAIT_MS && {
        waitMs: Number(process.env.FACTWRIGHT_SETUP_WAIT_MS),
      }),
    });
    await setup.load();
    // Claude analyzing new jobs on its own while it's free, once Claude Code is ready and past its
    // first screens, with the window open to show its run. The tests turn it off, or wait less.
    let claudeReady = false;
    claims = new Claims({
      tracker,
      sync: sync.claimSync(),
      stepAside: (runId) => claude.stepAside(runId),
    });
    claims.heard(claude.view());
    const analyzing = new AnalyzeNew({
      dataDir,
      jobs: () => jobs.list().jobs,
      runs: claude,
      ready: () =>
        claudeReady &&
        develop('FACTWRIGHT_ANALYZE_NEW') !== 'off' &&
        window.current() !== null &&
        (claude.view().setUp || setup.current()?.result === 'passed'),
      today: () => localDate(new Date()),
      claims,
      ...(develop('FACTWRIGHT_ANALYZE_WAIT_MS') && {
        quietMs: Number(develop('FACTWRIGHT_ANALYZE_WAIT_MS')),
      }),
    });
    await analyzing.load();
    analyzeNew = analyzing;
    analyzing.look();
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
            // Only work going waits, in any run: Claude Code that's done closes first, then it
            // installs.
            busy: () => claude.working(),
            // No run of Claude's own starts once the restart begins.
            closeClaude: () => {
              analyzing.stop();
              return claude.closeIdle();
            },
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
      kept,
      templates,
      previews,
      claude,
      questions,
      permissionAsks,
      setup,
      jobs,
      revisions,
      versions,
      workspace,
      sync,
      dataDir,
      runChanges,
      updates,
      profiles,
      reminders,
      opener,
      saveHelper,
      tellRunDone: (note) => notifyRunDone(window, note, () => window.send('claude:open-result')),
      runRequests,
      analyzeNew: analyzing,
      onClaudeStatus: (status) => {
        claudeReady = status.state === 'ready';
        analyzing.look();
      },
      formFeed: formFeedFile
        ? async () => JSON.parse(await readFile(formFeedFile, 'utf8')) as unknown
        : undefined,
    });
    void sync.start();
    // Coming back to the app, or the computer waking, asks a paused computer's account whether it
    // has sync again, as after subscribing from another device.
    app.on('browser-window-focus', () => sync.lookAgain());
    powerMonitor.on('resume', () => sync.lookAgain());
    powerMonitor.on('unlock-screen', () => sync.lookAgain());
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
      analyzing.stop();
      claims?.stop();
      claude.closeAll();
      setup.stop();
      server.stop();
      printer.close();
      inbox.stop();
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
