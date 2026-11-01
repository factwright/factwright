import { type Session, shell, type WebContents } from 'electron';
import { isSafeExternalUrl, windowMayLoad } from './policy.ts';

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

/**
 * Keeps the window's session off the web, whatever the page does. The content security policy
 * covers what a page loads, but not a link Chromium is told to download, as it is by the download
 * attribute or a click with Alt held. The app's own requests don't use this session.
 */
export function keepOffTheWeb(session: Session, devUrl?: string): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !windowMayLoad(details.url, devUrl) });
  });
}

/** Sends the content security policy with every response from the dev server. */
export function applyDevPolicy(session: Session, policy: string): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    });
  });
}
