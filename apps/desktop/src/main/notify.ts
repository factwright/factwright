import { app, Notification } from 'electron';
import type { RunSignal } from '../shared/api.ts';
import type { RequestView } from '../shared/sync.ts';
import type { MainWindow, WindowLike } from './main-window.ts';
import { present, QUIET } from './quiet.ts';
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
  present(notification);
}

/**
 * Tells the user when Claude needs them or finishes, if they're looking somewhere else. With the
 * window closed there's no run to tell of, as closing it stopped the run. Clicking brings back
 * whichever window is open by then, or opens a new one, since the window the run was in may
 * have closed meanwhile.
 */
export function notifyIfAway(
  window: Pick<MainWindow<WindowLike>, 'current' | 'focused' | 'show'>,
  signal: RunSignal,
): void {
  const message = MESSAGES[signal];
  if (!message || !window.current() || window.focused()) return;
  const notification = new Notification({ ...message, silent: signal !== 'needs-answer' });
  notification.on('click', () => window.show());
  present(notification);
  if (signal === 'needs-answer' && !QUIET) app.dock?.bounce('informational');
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
  present(notification);
}
