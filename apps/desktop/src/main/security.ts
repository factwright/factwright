import { type Session, shell, type WebContents } from 'electron';
import { isSafeExternalUrl } from './policy.ts';

/** Keeps a window on the app's own page: no navigating away, no new windows, no embedded pages. */
export function hardenContents(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    // A reload is the one navigation the app makes.
    if (url !== contents.getURL()) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/** Refuses every web permission, such as the camera or notifications. The app asks for none. */
export function denyPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}

/** Sends the content security policy with every response from the dev server. */
export function applyDevPolicy(session: Session, policy: string): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    });
  });
}
