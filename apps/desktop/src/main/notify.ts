import { app, type BrowserWindow, Notification } from 'electron';
import type { RunSignal } from '../shared/api.ts';

const MESSAGES: Partial<Record<RunSignal, { title: string; body: string }>> = {
  'needs-answer': { title: 'Claude needs your answer', body: 'Open Factwright to reply.' },
  done: { title: 'Claude is done', body: 'Your run in Factwright finished.' },
  failed: {
    title: 'Claude Code stopped',
    body: 'It closed before finishing. Open Factwright to see why.',
  },
};

/** Tells the user when Claude needs them or finishes, if they're looking somewhere else. */
export function notifyIfAway(window: BrowserWindow, signal: RunSignal): void {
  const message = MESSAGES[signal];
  if (!message || window.isFocused()) return;
  const notification = new Notification({ ...message, silent: signal !== 'needs-answer' });
  notification.on('click', () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  notification.show();
  if (signal === 'needs-answer') app.dock?.bounce('informational');
}
