import { app, type BrowserWindow, Notification } from 'electron';
import type { RunSignal } from '../shared/api.ts';
import type { RequestView } from '../shared/sync.ts';
import type { CallReminder } from './reminders.ts';

const MESSAGES: Partial<Record<RunSignal, { title: string; body: string }>> = {
  'needs-answer': { title: 'Claude needs your answer', body: 'Open Factwright to reply.' },
  done: { title: 'Claude is done', body: 'Your run in Factwright finished.' },
  failed: {
    title: 'Claude Code stopped',
    body: 'It closed before finishing. Open Factwright to see why.',
  },
};

/** The requests to link the user has been told about already. */
const toldOf = new Set<string>();

/**
 * Tells the user when another device asks to link, once for each request, unless they're
 * looking at the app already. On a Mac the app keeps running with its window closed, so the
 * notification shows then too, and clicking it brings the window back. They approve in the app,
 * never from the notification.
 */
export function notifyOfRequests(
  requests: RequestView[],
  window: { focused: () => boolean; show: () => void },
): void {
  const fresh = requests.filter((request) => !request.elsewhere && !toldOf.has(request.id));
  const first = fresh[0];
  if (!first) return;
  for (const request of fresh) toldOf.add(request.id);
  if (window.focused()) return;
  const notification = new Notification({
    title: 'A new device wants to link',
    body: `${first.device} asked to sync your job hunt. Open Factwright to check it’s yours.`,
  });
  notification.on('click', () => window.show());
  notification.show();
}

/** Tells the user when Claude needs them or finishes, if they're looking somewhere else. */
export function notifyIfAway(window: BrowserWindow, signal: RunSignal): void {
  const message = MESSAGES[signal];
  if (!message || window.isDestroyed() || window.isFocused()) return;
  const notification = new Notification({ ...message, silent: signal !== 'needs-answer' });
  notification.on('click', () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  notification.show();
  if (signal === 'needs-answer') app.dock?.bounce('informational');
}

/**
 * The reminders on screen. Something has to hold each one, or Electron can let it go, and a click
 * on it then does nothing. The latest few are held, in case a system never says one closed.
 */
const reminding = new Set<Notification>();

/**
 * Reminds the user of a call coming up, whether or not they're in the app, as a calendar would.
 * Clicking it opens the call's job.
 */
export function remindOfCall(reminder: CallReminder, open: (jobId: string) => void): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: reminder.title, body: reminder.body });
  const forget = () => reminding.delete(notification);
  notification.on('click', () => {
    forget();
    open(reminder.jobId);
  });
  notification.on('close', forget);
  notification.on('failed', forget);
  reminding.add(notification);
  for (const held of reminding) {
    if (reminding.size <= 20) break;
    reminding.delete(held);
  }
  notification.show();
}
