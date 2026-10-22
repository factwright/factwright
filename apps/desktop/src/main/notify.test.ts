import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestView } from '../shared/sync.ts';
import { notifyIfAway, notifyOfRequests, notifyRunDone, remindOfCall } from './notify.ts';
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
    notifyIfAway(window, 'needs-answer');
    expect(shown).toHaveLength(0);
    if (opened[0]) opened[0].looking = false;
    notifyIfAway(window, 'needs-answer');
    expect(shown.map((notification) => notification.options)).toEqual([
      { title: 'Claude needs your answer', body: 'Open Factwright to reply.', silent: false },
    ]);
  });

  it('leaves a run that’s done to the window, which says what it made', () => {
    const { window, opened } = fakeMainWindow();
    window.open();
    if (opened[0]) opened[0].looking = false;
    notifyIfAway(window, 'done');
    expect(shown).toHaveLength(0);
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

describe('notifyRunDone', () => {
  const note = {
    title: 'Your tailored resume for Acme is ready.',
    body: 'Open Factwright to see it.',
  };

  it('says what a run made, in the window’s words, while the user is looking elsewhere', () => {
    const { window, opened } = fakeMainWindow();
    window.open();
    window.show();
    const onOpen = vi.fn();
    notifyRunDone(window, note, onOpen);
    expect(shown).toHaveLength(0);
    if (opened[0]) opened[0].looking = false;
    notifyRunDone(window, note, onOpen);
    expect(shown.map((notification) => notification.options)).toEqual([{ ...note, silent: true }]);
    // Clicked, it brings the window back and opens what the run made.
    shown[0]?.emit('click');
    expect(window.focused()).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('takes only words, and not too many of them', () => {
    const { window, opened } = fakeMainWindow();
    window.open();
    if (opened[0]) opened[0].looking = false;
    for (const odd of [null, 'Done', { title: 3, body: 'x' }, { title: ' ', body: 'x' }]) {
      notifyRunDone(window, odd, () => {});
    }
    expect(shown).toHaveLength(0);
    notifyRunDone(window, { title: 'a'.repeat(1000), body: 'b'.repeat(1000) }, () => {});
    expect(shown[0]?.options).toEqual({
      title: 'a'.repeat(300),
      body: 'b'.repeat(300),
      silent: true,
    });
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
