import { statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
} from 'electron';
import type { EditResult, PdfResult, SaveFileResult, StartResult } from '../shared/api.ts';
import { effortFor, needsMore, parseEffort } from '../shared/effort.ts';
import { modelFor, parseModels } from '../shared/models.ts';
import { parsePermissions } from '../shared/permissions.ts';
import { scopeOf } from '../shared/runs.ts';
import { registerAboutIpc } from './about/ipc.ts';
import type { TemplatePreviews } from './about/previews.ts';
import type { AboutStore } from './about/store.ts';
import { loadEffort, saveEffort } from './claude/effort.ts';
import { loadModels, saveModels } from './claude/models.ts';
import { loadPermissions, savePermissions } from './claude/permissions.ts';
import type { SetupChecker } from './claude/self-test.ts';
import type { ClaudeSession } from './claude/session.ts';
import { claudeStatus, nodeStatusDeps } from './claude/status.ts';
import {
  parseCallChanges,
  parseDate,
  parseJobChanges,
  parseNewCall,
  parseNewJob,
} from './jobs/input.ts';
import type { JobsService } from './jobs/service.ts';
import {
  MAX_PREVIEW_BYTES,
  openableFile,
  parseRunTask,
  parseTerminalSize,
  previewablePdf,
  runPrompt,
  saveableFileName,
} from './policy.ts';
import type { SyncAccount } from './sync/account.ts';

/** The most the window may send to Claude Code at once: a long paste, but not a flood. */
const MAX_INPUT_LENGTH = 100_000;

/** The most text the window may copy or save at once, such as a long journey spreadsheet. */
const MAX_TEXT_LENGTH = 5_000_000;

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;

/** The answer to an edit the window sent in a shape the app doesn't take. */
const REFUSED: EditResult = { ok: false, message: 'That change couldn’t be saved.' };

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 300;

export interface IpcDeps {
  /** Whether a page is the app's own, the only page whose requests are answered. */
  isAppPage: (url: string) => boolean;
  /** What the user tells Factwright about themselves, and the templates' previews. */
  about: AboutStore;
  previews: TemplatePreviews;
  claude: ClaudeSession;
  /** Checks that Factwright's setup still works with each version of Claude Code. */
  setup: SetupChecker;
  jobs: JobsService;
  workspace: string;
  sync: SyncAccount;
  /** The app's own data folder, which holds what Claude may do without asking. */
  dataDir: string;
}

/** A file's size in bytes, or null when it isn't a file. */
const fileSize = (path: string) => {
  try {
    const found = statSync(path);
    return found.isFile() ? found.size : null;
  } catch {
    return null;
  }
};

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Answers the window's requests, after checking each one came from the app's own page. */
export function registerIpc({
  isAppPage,
  about,
  previews,
  claude: session,
  setup,
  jobs,
  workspace,
  sync,
  dataDir,
}: IpcDeps): void {
  const fromApp = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    isAppPage(event.senderFrame?.url ?? '');

  /** A request that expects an answer. Ones from outside the app are refused. */
  const answer = (channel: string, reply: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!fromApp(event)) throw new Error('Refused a request from a page outside the app.');
      return reply(...args);
    });
  };

  // Each status check also notices a new version of Claude Code, which gets its setup checked.
  answer('claude:status', async () => {
    const status = await claudeStatus(nodeStatusDeps());
    if (status.state === 'ready') setup.checkIfNeeded(status.version);
    return status;
  });

  answer('setup:latest', () => setup.current());

  // Which model Claude runs on, for everything and for each task. A change applies from the next
  // start, or the next task that needs another model.
  answer('claude:models', () => loadModels(dataDir));
  answer('claude:set-models', async (value) => {
    const models = parseModels(value);
    if (!models) throw new Error('Refused models Claude Code doesn’t know.');
    await saveModels(dataDir, models);
    return models;
  });
  answer('claude:effort', () => loadEffort(dataDir));
  answer('claude:set-effort', async (value) => {
    const effort = parseEffort(value);
    if (!effort) throw new Error('Refused effort levels Claude Code doesn’t know.');
    await saveEffort(dataDir, effort);
    return effort;
  });

  // What Claude may do without asking. A change applies from Claude's next start.
  answer('claude:permissions', () => loadPermissions(dataDir));
  answer('claude:set-permissions', async (value) => {
    const permissions = parsePermissions(value);
    if (!permissions) throw new Error('Refused permissions that aren’t two yes-or-no answers.');
    await savePermissions(dataDir, permissions);
    return permissions;
  });

  answer('setup:check', async () => {
    const status = await claudeStatus(nodeStatusDeps());
    return status.state === 'ready' ? setup.check(status.version) : setup.current();
  });

  /** A task the window asked for, if it's a job search, or names a skill and a job the app knows. */
  const knownTask = (value: unknown) => {
    const task = parseRunTask(value);
    if (!task || !('jobId' in task)) return task;
    return jobs.list().jobs.some((job) => job.id === task.jobId) ? task : null;
  };

  answer('claude:start', (size, task) => {
    // The user's run comes first: a setup check that's going steps aside for it.
    setup.yieldToRun();
    const valid = parseTerminalSize(size);
    const run = task === undefined ? undefined : knownTask(task);
    if (!valid || run === null) throw new Error('Refused a request to start Claude.');
    return Promise.all([loadModels(dataDir), loadEffort(dataDir)]).then(([models, effort]) =>
      session.start(valid, {
        prompt: run ? runPrompt(run) : undefined,
        model: modelFor(models, run),
        effort: effortFor(effort, run),
        scope: scopeOf(run),
      }),
    );
  });

  // A task for the run that's open. One that needs another model or more effort, or may change
  // other files without asking, starts a new run instead. One that needs less effort runs at the
  // open run's.
  answer('claude:task', async (task): Promise<StartResult> => {
    const run = knownTask(task);
    if (!run) throw new Error('Refused a task for Claude.');
    const [models, effort] = await Promise.all([loadModels(dataDir), loadEffort(dataDir)]);
    const differs = <T>(open: T | undefined, wanted: T) => open !== undefined && open !== wanted;
    const thinking = session.effort();
    if (
      differs(session.model(), modelFor(models, run)) ||
      (thinking !== undefined && needsMore(thinking, effortFor(effort, run))) ||
      differs(session.scope(), scopeOf(run))
    ) {
      return { ok: false, reason: 'new-run' };
    }
    return session.send(runPrompt(run));
  });

  ipcMain.on('claude:input', (event, data: unknown) => {
    if (fromApp(event) && typeof data === 'string' && data.length <= MAX_INPUT_LENGTH) {
      session.write(data);
    }
  });

  ipcMain.on('claude:resize', (event, size: unknown) => {
    const valid = parseTerminalSize(size);
    if (fromApp(event) && valid) session.resize(valid);
  });

  ipcMain.on('claude:stop', (event) => {
    if (fromApp(event)) session.stop();
  });

  answer('jobs:list', () => jobs.list());

  answer('jobs:docs', (jobId) => (isId(jobId) ? jobs.docs(jobId) : null));

  answer('jobs:update', (jobId, changes) => {
    const valid = parseJobChanges(changes);
    return isId(jobId) && valid ? jobs.updateJob(jobId, valid) : REFUSED;
  });

  answer('jobs:add', (job) => {
    const valid = parseNewJob(job);
    return valid ? jobs.addJob(valid) : REFUSED;
  });

  answer('calls:add', (jobId, call) => {
    const valid = parseNewCall(call);
    return isId(jobId) && valid ? jobs.addCall(jobId, valid) : REFUSED;
  });

  answer('calls:update', (callId, changes) => {
    const valid = parseCallChanges(changes);
    return isId(callId) && valid ? jobs.updateCall(callId, valid) : REFUSED;
  });

  answer('calls:delete', (callId) => (isId(callId) ? jobs.deleteCall(callId) : REFUSED));

  answer('history:redate', (changeId, at) => {
    const date = parseDate(at);
    return isId(changeId) && date ? jobs.redateStatusChange(changeId, date) : REFUSED;
  });

  answer('history:undo', (changeId) =>
    isId(changeId) ? jobs.undoStatusChange(changeId) : REFUSED,
  );

  answer('files:open', async (path): Promise<EditResult> => {
    const file = typeof path === 'string' ? openableFile(workspace, path) : null;
    if (!file || !isFile(file)) {
      return { ok: false, message: 'That file isn’t in your workspace anymore.' };
    }
    const failed = await shell.openPath(file);
    return failed ? { ok: false, message: 'Your computer couldn’t open that file.' } : { ok: true };
  });

  answer('files:pdf', async (path): Promise<PdfResult> => {
    const file = typeof path === 'string' ? previewablePdf(workspace, path) : null;
    const size = file ? fileSize(file) : null;
    if (!file || size === null) {
      return { ok: false, message: 'That file isn’t in your workspace anymore.' };
    }
    if (size > MAX_PREVIEW_BYTES) {
      return { ok: false, message: 'That PDF is too big to preview here. Open it instead.' };
    }
    return { ok: true, data: new Uint8Array(await readFile(file)) };
  });

  answer('clipboard:write', (text): EditResult => {
    if (!isText(text)) return REFUSED;
    clipboard.writeText(text);
    return { ok: true };
  });

  // The user picks where the file goes, in the system's own save dialog.
  ipcMain.handle(
    'files:save',
    async (event, name: unknown, text: unknown): Promise<SaveFileResult> => {
      if (!fromApp(event)) throw new Error('Refused a request from a page outside the app.');
      const fileName = saveableFileName(name);
      if (!fileName || !isText(text)) return { ok: false, message: 'That file couldn’t be saved.' };
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { defaultPath: join(app.getPath('downloads'), fileName) };
      const choice = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { ok: true, saved: false };
      try {
        await writeFile(choice.filePath, text);
        return { ok: true, saved: true };
      } catch {
        return { ok: false, message: 'That folder can’t be written to. Pick another one.' };
      }
    },
  );

  /** Codes and keys people type: 32 letters and numbers, with spaces or dashes. */
  const isTyped = (value: unknown): value is string =>
    typeof value === 'string' && value.length <= 100;

  answer('sync:status', () => sync.status());
  answer('sync:sign-in', () => sync.signInWithBrowser());
  ipcMain.on('sync:cancel-sign-in', (event) => {
    if (fromApp(event)) sync.cancelSignIn();
  });
  answer('sync:recovery-key', () => sync.newRecoveryKey());
  answer('sync:turn-on', () => sync.turnOn());
  answer('sync:link', (code) => (isTyped(code) ? sync.linkWithCode(code) : REFUSED));
  answer('sync:recover', (key) => (isTyped(key) ? sync.useRecoveryKey(key) : REFUSED));
  answer('sync:link-code', () => sync.makeLinkCode());
  ipcMain.on('sync:cancel-link-code', (event, id: unknown) => {
    if (fromApp(event) && isId(id)) void sync.cancelLinkCode(id);
  });
  ipcMain.on('sync:now', (event) => {
    if (fromApp(event)) sync.requestSync();
  });
  answer('sync:account', () => sync.account());
  answer('sync:remove-device', (id) => (isId(id) ? sync.removeDevice(id) : REFUSED));
  answer('sync:sign-out', () => sync.signOut());
  answer('sync:account-page', () => sync.openAccountPage());

  registerAboutIpc(answer, { about, previews });
}
