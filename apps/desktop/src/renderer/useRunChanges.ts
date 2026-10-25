import { useCallback, useEffect, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import type { RunChanges, UndoResult } from '../shared/run-changes.ts';

/** What the task at hand changed, and putting a file of it back. */
export interface RunChangesState {
  /** What it changed and read, as the app last said, or null before it says anything. */
  changes: RunChanges | null;
  /** Puts a file back as it was before the task, taking in what the task changed then. */
  undo: (path: string, anyway: boolean) => Promise<UndoResult>;
}

/**
 * Follows what Claude's task at hand changed in the job hunt, and the pages it read, as the app
 * says once each of its turns ends. Another task, by its ID, starts with nothing changed.
 */
export function useRunChanges(
  api: Pick<FactwrightApi, 'onRunChanges' | 'undoChange'>,
  taskId: number,
): RunChangesState {
  const [heard, setHeard] = useState<{ taskId: number; changes: RunChanges | null }>({
    taskId,
    changes: null,
  });
  if (heard.taskId !== taskId) setHeard({ taskId, changes: null });
  useEffect(() => api.onRunChanges((changes) => setHeard((was) => ({ ...was, changes }))), [api]);
  const changes = heard.taskId === taskId ? heard.changes : null;
  const id = changes?.id;
  const undo = useCallback(
    async (path: string, anyway: boolean): Promise<UndoResult> => {
      if (!id) return { ok: false, reason: 'failed', message: 'That task’s changes are gone.' };
      const result = await api.undoChange(id, path, anyway).catch(
        (): UndoResult => ({
          ok: false,
          reason: 'failed',
          message: 'That didn’t go through. Try again in a moment.',
        }),
      );
      // What the task changed, as it stands now, unless another task took its place meanwhile.
      if (result.ok) {
        setHeard((was) => (was.changes?.id === id ? { ...was, changes: result.changes } : was));
      }
      return result;
    },
    [api, id],
  );
  return { changes, undo };
}
