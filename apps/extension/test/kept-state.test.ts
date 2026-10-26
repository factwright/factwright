import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The browser's storage for a session, in memory, as it is, never on the disk. */
const browser = vi.hoisted(() => {
  const state = { session: {} as Record<string, unknown> };
  const session = {
    get: async (key: string) =>
      key in state.session ? { [key]: structuredClone(state.session[key]) } : {},
    set: async (more: Record<string, unknown>) => {
      Object.assign(state.session, structuredClone(more));
    },
  };
  (globalThis as { chrome?: unknown }).chrome = { storage: { session } };
  return { state, session };
});

import { keptState } from '../src/kept-state.ts';

interface Kept {
  via: 'computer' | 'sync';
  text: string;
  at: number;
}

const chrome = (globalThis as unknown as { chrome: { storage: { session?: unknown } } }).chrome;

beforeEach(() => {
  browser.state.session = {};
  chrome.storage.session = browser.session;
});

describe('what the extension keeps of what it did on a tab', () => {
  it('keeps what came from Factwright on this computer for the session, and nothing read through sync', async () => {
    const kept = keptState<Kept>(
      'kept',
      (each) => each.via === 'sync',
      10,
      (each) => each.at,
    );
    await kept.change((all) => {
      all.mine = { via: 'computer', text: 'From this computer', at: 1 };
      all.synced = { via: 'sync', text: 'Ana María Ruiz', at: 2 };
    });
    expect(JSON.stringify(browser.state.session)).not.toContain('Ana María');
    expect(browser.state.session).toEqual({
      kept: { mine: { via: 'computer', text: 'From this computer', at: 1 } },
    });
    // Both are there for the background that keeps them.
    expect(Object.keys(await kept.all()).sort()).toEqual(['mine', 'synced']);
    // One read through sync again, in place of one from this computer, leaves the session too.
    await kept.change((all) => {
      all.mine = { via: 'sync', text: 'Through sync now', at: 3 };
    });
    expect(browser.state.session).toEqual({ kept: {} });
    expect((await kept.all()).mine?.text).toBe('Through sync now');
  });

  it('keeps the newest alone, as many as it may', async () => {
    const kept = keptState<Kept>(
      'kept',
      (each) => each.via === 'sync',
      2,
      (each) => each.at,
    );
    await kept.change((all) => {
      all.oldest = { via: 'computer', text: '', at: 1 };
      all.newer = { via: 'sync', text: '', at: 2 };
      all.newest = { via: 'computer', text: '', at: 3 };
    });
    expect(Object.keys(await kept.all()).sort()).toEqual(['newer', 'newest']);
  });

  it('says what a change says, after the changes before it', async () => {
    const kept = keptState<Kept>(
      'kept',
      () => false,
      10,
      (each) => each.at,
    );
    const first = kept.change((all) => {
      all.one = { via: 'computer', text: 'one', at: 1 };
      return 'first';
    });
    const second = kept.change((all) => Object.keys(all).length);
    expect(await first).toBe('first');
    expect(await second).toBe(1);
  });

  it('keeps everything in memory in a browser that keeps nothing for a session', async () => {
    chrome.storage.session = undefined;
    const kept = keptState<Kept>(
      'kept',
      () => false,
      10,
      (each) => each.at,
    );
    await kept.change((all) => {
      all.mine = { via: 'computer', text: 'From this computer', at: 1 };
    });
    expect((await kept.all()).mine?.text).toBe('From this computer');
  });
});
