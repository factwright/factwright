// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunChanges, UndoResult } from '../shared/run-changes.ts';
import { useRunChanges } from './useRunChanges.ts';

const FIRST: RunChanges = {
  id: '20261025-140311-123-a1b2c3',
  files: [
    {
      path: 'job.md',
      change: 'changed',
      lines: { added: 1, removed: 0 },
      canUndo: true,
      undone: false,
    },
  ],
  pages: [],
  morePages: 0,
};

function apiWith(undone: UndoResult) {
  let tell: (changes: RunChanges) => void = () => {};
  return {
    tell: (changes: RunChanges) => tell(changes),
    api: {
      onRunChanges: vi.fn((listener: (changes: RunChanges) => void) => {
        tell = listener;
        return () => {};
      }),
      undoChange: vi.fn(async () => undone),
    },
  };
}

describe('useRunChanges', () => {
  it('follows what the task at hand changed, and starts the next task with nothing', () => {
    const { api, tell } = apiWith({ ok: true, changes: FIRST });
    const { result, rerender } = renderHook(({ task }) => useRunChanges(api, task), {
      initialProps: { task: 1 },
    });
    expect(result.current.changes).toBeNull();
    act(() => tell(FIRST));
    expect(result.current.changes).toEqual(FIRST);
    rerender({ task: 2 });
    expect(result.current.changes).toBeNull();
  });

  it('takes in what the task changed once a file is put back', async () => {
    const after: RunChanges = {
      ...FIRST,
      files: [{ ...(FIRST.files[0] as RunChanges['files'][0]), canUndo: false, undone: true }],
    };
    const { api, tell } = apiWith({ ok: true, changes: after });
    const { result } = renderHook(() => useRunChanges(api, 1));
    act(() => tell(FIRST));
    await act(async () => {
      expect(await result.current.undo('job.md', false)).toEqual({ ok: true, changes: after });
    });
    expect(api.undoChange).toHaveBeenCalledWith(FIRST.id, 'job.md', false);
    expect(result.current.changes).toEqual(after);
  });

  it('says so when Undo doesn’t reach the app', async () => {
    const { api, tell } = apiWith({ ok: true, changes: FIRST });
    api.undoChange.mockRejectedValueOnce(new Error('gone'));
    const { result } = renderHook(() => useRunChanges(api, 1));
    act(() => tell(FIRST));
    await act(async () => {
      expect(await result.current.undo('job.md', false)).toMatchObject({
        ok: false,
        reason: 'failed',
      });
    });
    expect(result.current.changes).toEqual(FIRST);
  });
});
