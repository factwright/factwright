import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestView } from '../shared/sync.ts';
import { notifyIfAway, notifyOfRequests, remindOfCall } from './notify.ts';
import { fakeMainWindow } from './testing.ts';

/** The notifications shown, which the tests click as the user does. */
const { shown } = vi.hoisted(() => ({
  shown: [] as { options: Record<string, unknown>; emit(event: 'click'): void }[],
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
    }
    show() {
      shown.push(this);
    }
  }
  return { app: { dock: { bounce: () => 0 } }, Notification };
});

beforeEach(() => {
  shown.length = 0;
});

describe('notifyIfAway', () => {
  it('tells of a run only while the user is looking elsewhere', () => {
    const { window, opened } = fakeMainWindow();
    window.open();
    window.show();
    notifyIfAway(window, 'done');
    expect(shown).toHaveLength(0);
    if (opened[0]) opened[0].looking = false;
    notifyIfAway(window, 'done');
    expect(shown.map((notification) => notification.options)).toEqual([
      { title: 'Claude is done', body: 'Your run in Factwright finished.', silent: true },
    ]);
  });

  it('says nothing once the window has closed, which stopped the run', () => {
    const { window } = fakeMainWindow();
    window.open().close();
    notifyIfAway(window, 'failed');
    expect(shown).toHaveLength(0);
  });

  it('brings the window back when clicked', () => {
    const { window, opened } = fakeMainWindow();
    const first = window.open();
    first.minimized = true;
    notifyIfAway(window, 'needs-answer');
    shown[0]?.emit('click');
    expect(first.minimized).toBe(false);
    expect(window.focused()).toBe(true);
    expect(opened).toHaveLength(1);
  });

  // On a Mac, the window the run was in can close before the notification is clicked.
  it('opens a new window when clicked after the run’s window closed', () => {
    const { window, opened } = fakeMainWindow();
    window.open();
    notifyIfAway(window, 'needs-answer');
    opened[0]?.close();
    expect(() => shown[0]?.emit('click')).not.toThrow();
    expect(opened).toHaveLength(2);
    expect(window.current()).toBe(opened[1]);
  });
});

describe('notifyOfRequests', () => {
  const request = (id: string): RequestView => ({
    id,
    device: 'Chrome on Windows',
    asked: '2026-10-16T12:00:00.000Z',
    signedIn: '2026-10-16T11:59:00.000Z',
    elsewhere: false,
  });

  it('tells of each request once, even with the window closed, and clicking opens it', () => {
    const { window, opened } = fakeMainWindow();
    window.open().close();
    notifyOfRequests([request('closed-1')], window);
    notifyOfRequests([request('closed-1')], window);
    expect(shown).toHaveLength(1);
    shown[0]?.emit('click');
    expect(opened).toHaveLength(2);
    expect(window.current()).toBe(opened[1]);
  });

  it('says nothing while the user is looking at the window', () => {
    const { window } = fakeMainWindow();
    window.open();
    window.show();
    notifyOfRequests([request('looking-1')], window);
    expect(shown).toHaveLength(0);
  });
});

describe('remindOfCall', () => {
  it('shows the call and whether its prep is ready, and opens its job when clicked', () => {
    const open = vi.fn();
    const reminder = {
      jobId: 'acme--staff',
      callId: 'acme-panel',
      title: 'Panel interview with Acme at 2:00 PM',
      body: 'Your prep sheet is ready. Open Factwright to read it.',
    };
    remindOfCall(reminder, open);
    expect(shown.map((notification) => notification.options)).toEqual([
      { title: reminder.title, body: reminder.body },
    ]);
    expect(open).not.toHaveBeenCalled();
    shown[0]?.emit('click');
    expect(open).toHaveBeenCalledWith('acme--staff');
  });
});
