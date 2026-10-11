import { statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
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
import type { EditResult, SaveFileResult } from '../shared/api.ts';
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
import { openableFile, parseTerminalSize, saveableFileName } from './policy.ts';

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
  claude: ClaudeSession;
  jobs: JobsService;
  workspace: string;
}

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Answers the window's requests, after checking each one came from the app's own page. */
export function registerIpc({ isAppPage, claude: session, jobs, workspace }: IpcDeps): void {
  const fromApp = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    isAppPage(event.senderFrame?.url ?? '');

  /** A request that expects an answer. Ones from outside the app are refused. */
  const answer = (channel: string, reply: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!fromApp(event)) throw new Error('Refused a request from a page outside the app.');
      return reply(...args);
    });
  };

  answer('claude:status', () => claudeStatus(nodeStatusDeps()));

  answer('claude:start', (size) => {
    const valid = parseTerminalSize(size);
    if (!valid) throw new Error('Refused a request to start Claude.');
    return session.start(valid);
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
}
