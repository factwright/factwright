import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import { claudeStatus, nodeStatusDeps } from './claude/status.ts';

/** Answers the window's requests, after checking each one came from the app's own page. */
export function registerIpc(isAppPage: (url: string) => boolean): void {
  ipcMain.handle('claude:status', (event) => {
    assertFromApp(event, isAppPage);
    return claudeStatus(nodeStatusDeps());
  });
}

function assertFromApp(event: IpcMainInvokeEvent, isAppPage: (url: string) => boolean): void {
  if (!isAppPage(event.senderFrame?.url ?? '')) {
    throw new Error('Refused a request from a page that is not part of the app.');
  }
}
