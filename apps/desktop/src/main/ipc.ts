import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from 'electron';
import type { ClaudeSession } from './claude/session.ts';
import { claudeStatus, nodeStatusDeps } from './claude/status.ts';
import { parseTerminalSize } from './policy.ts';

/** The most the window may send to Claude Code at once: a long paste, but not a flood. */
const MAX_INPUT_LENGTH = 100_000;

/** Answers the window's requests, after checking each one came from the app's own page. */
export function registerIpc(isAppPage: (url: string) => boolean, session: ClaudeSession): void {
  const fromApp = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    isAppPage(event.senderFrame?.url ?? '');

  ipcMain.handle('claude:status', (event) => {
    if (!fromApp(event)) throw new Error('Refused a request from a page outside the app.');
    return claudeStatus(nodeStatusDeps());
  });

  ipcMain.handle('claude:start', (event, size: unknown) => {
    const valid = parseTerminalSize(size);
    if (!fromApp(event) || !valid) throw new Error('Refused a request to start Claude.');
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
}
