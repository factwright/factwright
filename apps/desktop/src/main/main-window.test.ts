import { describe, expect, it } from 'vitest';
import { fakeMainWindow } from './testing.ts';

describe('MainWindow', () => {
  it('opens one window, and keeps to it while it’s open', () => {
    const { window, opened } = fakeMainWindow();
    expect(window.current()).toBeNull();
    const first = window.open();
    expect(window.open()).toBe(first);
    window.show();
    expect(opened).toEqual([first]);
    expect(window.current()).toBe(first);
  });

  it('asks nothing of a window once it’s closed, which would throw', () => {
    const { window, opened, closed } = fakeMainWindow();
    const first = window.open();
    first.close();
    expect(closed.count).toBe(1);
    expect(window.current()).toBeNull();
    expect(window.focused()).toBe(false);
    expect(() => window.send('jobs:changed', [])).not.toThrow();
    expect(first.sent).toEqual([]);
    expect(opened).toHaveLength(1);
  });

  it('opens a new window after the last one closed, and everything reaches the new one', () => {
    const { window, opened, closed } = fakeMainWindow();
    window.open().close();
    window.show();
    const second = opened[1];
    expect(second).toBeDefined();
    expect(window.current()).toBe(second);
    window.send('sync:status', { state: 'off' });
    expect(second?.sent).toEqual([['sync:status', { state: 'off' }]]);
    second?.close();
    expect(closed.count).toBe(2);
  });

  it('brings an open window forward, restoring it first if it was minimized', () => {
    const { window, opened } = fakeMainWindow();
    const first = window.open();
    first.minimized = true;
    expect(window.focused()).toBe(false);
    window.show();
    expect(first.minimized).toBe(false);
    expect(window.focused()).toBe(true);
    expect(opened).toHaveLength(1);
  });

  it('keeps a new window, however late an old one says it closed', () => {
    const { window, opened } = fakeMainWindow();
    const first = window.open();
    first.destroy();
    const second = window.open();
    expect(second).not.toBe(first);
    first.emit('closed');
    expect(window.current()).toBe(second);
    expect(opened).toHaveLength(2);
  });
});
