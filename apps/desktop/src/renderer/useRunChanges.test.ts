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
  let tell: (heard: { runId: string; changes: RunChanges }) => void = () => {};
  return {
    tell: (runId: string, changes: RunChanges) => tell({ runId, changes }),
    api: {
      onRunChanges: vi.fn((listener: typeof tell) => {
        tell = listener;
        return () => {};
      }),
      undoChange: vi.fn(async () => undone),
    },
  };
}

describe('useRunChanges', () => {
  it('follows what each run’s task changed, apart, and lets a run go once its tab closes', () => {
    const { api, tell } = apiWith({ ok: true, changes: FIRST });
    const { result, rerender } = renderHook(({ runs }) => useRunChanges(api, runs), {
      initialProps: { runs: ['run-1', 'run-2'] },
    });
    expect(result.current('run-1').changes).toBeNull();
    act(() => tell('run-1', FIRST));
    expect(result.current('run-1').changes).toEqual(FIRST);
    expect(result.current('run-2').changes).toBeNull();
    rerender({ runs: ['run-2'] });
    expect(result.current('run-1').changes).toBeNull();
  });

  it('takes in what the task changed once a file is put back', async () => {
    const after: RunChanges = {
      ...FIRST,
      files: [{ ...(FIRST.files[0] as RunChanges['files'][0]), canUndo: false, undone: true }],
    };
    const { api, tell } = apiWith({ ok: true, changes: after });
    const { result } = renderHook(() => useRunChanges(api, ['run-1']));
    act(() => tell('run-1', FIRST));
    await act(async () => {
      expect(await result.current('run-1').undo('job.md', false)).toEqual({
        ok: true,
        changes: after,
      });
    });
    expect(api.undoChange).toHaveBeenCalledWith(FIRST.id, 'job.md', false);
    expect(result.current('run-1').changes).toEqual(after);
  });

  it('says so when Undo doesn’t reach the app, or the task’s changes are gone', async () => {
    const { api, tell } = apiWith({ ok: true, changes: FIRST });
    api.undoChange.mockRejectedValueOnce(new Error('gone'));
    const { result } = renderHook(() => useRunChanges(api, ['run-1']));
    act(() => tell('run-1', FIRST));
    await act(async () => {
      expect(await result.current('run-1').undo('job.md', false)).toMatchObject({
        ok: false,
        reason: 'failed',
      });
    });
    expect(result.current('run-1').changes).toEqual(FIRST);
    await act(async () => {
      expect(await result.current('run-2').undo('job.md', false)).toMatchObject({ ok: false });
    });
  });
});
