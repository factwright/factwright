// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shortNotes, stepAtOpen, useJustUpdated } from './useJustUpdated.ts';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

/** A version that has short notes, which stay in the app's release-notes folder for good. */
const VERSION = '0.19.0';

const OPENING = { opened: true, gettingStarted: false, runGoing: false };

function apiWith(due: string | null = VERSION) {
  return {
    whatsNewDue: vi.fn(async () => due),
    whatsNewSeen: vi.fn(async () => {}),
  };
}

/** Lets what the app answered come in. */
const settle = () => act(async () => {});

describe('shortNotes', () => {
  it('finds a version’s notes among those built into the app', () => {
    expect(shortNotes(VERSION)).toMatch(/^- /);
  });

  it('has none for a version without them', () => {
    expect(shortNotes('0.0.1')).toBeNull();
  });
});

describe('stepAtOpen', () => {
  it('shows what’s new as the window opens', () => {
    expect(stepAtOpen({ gettingStarted: false, hasNotes: true, busy: false })).toBe('show');
  });

  it('passes it by for someone on Get started, who has no older version to compare with', () => {
    expect(stepAtOpen({ gettingStarted: true, hasNotes: true, busy: false })).toBe('pass-by');
    expect(stepAtOpen({ gettingStarted: true, hasNotes: true, busy: true })).toBe('pass-by');
  });

  it('passes by a version with nothing to say', () => {
    expect(stepAtOpen({ gettingStarted: false, hasNotes: false, busy: false })).toBe('pass-by');
    expect(stepAtOpen({ gettingStarted: false, hasNotes: false, busy: true })).toBe('pass-by');
  });

  it('leaves it for the next open while the user is busy', () => {
    expect(stepAtOpen({ gettingStarted: false, hasNotes: true, busy: true })).toBe('next-open');
  });
});

describe('useJustUpdated', () => {
  it('shows the version due once the window has what it opens on, and keeps that first', async () => {
    const api = apiWith();
    const { result, rerender } = renderHook((props) => useJustUpdated(api, props), {
      initialProps: { ...OPENING, opened: false },
    });
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).not.toHaveBeenCalled();
    rerender(OPENING);
    await waitFor(() =>
      expect(result.current.shown).toEqual({ version: VERSION, notes: shortNotes(VERSION) }),
    );
    expect(api.whatsNewSeen).toHaveBeenCalledTimes(1);
    act(() => result.current.close());
    expect(result.current.shown).toBeNull();
  });

  it('waits for the app to say what’s due when the window is ready first', async () => {
    let answer: (due: string | null) => void = () => {};
    const api = {
      ...apiWith(),
      whatsNewDue: vi.fn(() => new Promise<string | null>((resolve) => (answer = resolve))),
    };
    const { result } = renderHook(() => useJustUpdated(api, OPENING));
    await settle();
    expect(result.current.shown).toBeNull();
    await act(async () => answer(VERSION));
    await waitFor(() => expect(result.current.shown?.version).toBe(VERSION));
  });

  it('shows nothing, and keeps nothing, with nothing due', async () => {
    const api = apiWith(null);
    const { result } = renderHook(() => useJustUpdated(api, OPENING));
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).not.toHaveBeenCalled();
  });

  it('shows nothing when the app won’t say what’s due', async () => {
    const api = { ...apiWith(), whatsNewDue: vi.fn(() => Promise.reject(new Error('No'))) };
    const { result } = renderHook(() => useJustUpdated(api, OPENING));
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).not.toHaveBeenCalled();
  });

  it('never shows over Get started, and passes that version by', async () => {
    const api = apiWith();
    const { result, rerender } = renderHook((props) => useJustUpdated(api, props), {
      initialProps: { ...OPENING, gettingStarted: true },
    });
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).toHaveBeenCalledTimes(1);
    // Finishing Get started later doesn't bring it up.
    rerender(OPENING);
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).toHaveBeenCalledTimes(1);
  });

  it('leaves it for the next open when a run of the user’s is going, and never comes up later', async () => {
    const api = apiWith();
    const { result, rerender } = renderHook((props) => useJustUpdated(api, props), {
      initialProps: { ...OPENING, runGoing: true },
    });
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).not.toHaveBeenCalled();
    // The run ends, and the window stays as it is: it waits for the next open, still due.
    rerender(OPENING);
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).not.toHaveBeenCalled();
  });

  it('leaves it for the next open with another dialog up', async () => {
    const other = document.createElement('dialog');
    other.setAttribute('open', '');
    document.body.append(other);
    const api = apiWith();
    const { result } = renderHook(() => useJustUpdated(api, OPENING));
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).not.toHaveBeenCalled();
  });

  it('passes by a version with no notes, saying nothing', async () => {
    const api = apiWith('0.0.1');
    const { result } = renderHook(() => useJustUpdated(api, OPENING));
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).toHaveBeenCalledTimes(1);
  });

  it('says nothing when it can’t keep that it’s been said, rather than at every open', async () => {
    const api = { ...apiWith(), whatsNewSeen: vi.fn(() => Promise.reject(new Error('Full'))) };
    const { result } = renderHook(() => useJustUpdated(api, OPENING));
    await settle();
    expect(api.whatsNewSeen).toHaveBeenCalledTimes(1);
    expect(result.current.shown).toBeNull();
  });

  it('looks only once, however the window changes after', async () => {
    const api = apiWith();
    const { result, rerender } = renderHook((props) => useJustUpdated(api, props), {
      initialProps: OPENING,
    });
    await waitFor(() => expect(result.current.shown).not.toBeNull());
    act(() => result.current.close());
    rerender({ ...OPENING, opened: false });
    rerender({ ...OPENING, runGoing: true });
    rerender(OPENING);
    await settle();
    expect(result.current.shown).toBeNull();
    expect(api.whatsNewSeen).toHaveBeenCalledTimes(1);
  });
});
