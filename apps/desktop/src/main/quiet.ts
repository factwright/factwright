import { app, type Notification } from 'electron';

/**
 * Quiet mode, which the app's own tests run it in (e2e/app.ts sets FACTWRIGHT_QUIET=on), so it
 * stays out of the way of whoever is using the computer meanwhile. Its window is never shown or
 * brought forward, so it never takes the keyboard. It has no Dock icon, and notifications are only
 * asked for, never shown. The tests drive the page without the window showing. An installed copy
 * ignores the setting, as it does every setting for development.
 */
export const QUIET = !app.isPackaged && process.env.FACTWRIGHT_QUIET === 'on';

/**
 * Shows a notification. In quiet mode it only says it was asked for, with the app's
 * 'quiet-notification' event, which a test can listen for and click it through.
 */
export function present(notification: Notification): void {
  if (QUIET) app.emit('quiet-notification', notification);
  else notification.show();
}
