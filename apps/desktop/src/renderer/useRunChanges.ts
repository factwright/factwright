import { useCallback, useEffect, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import type { RunChanges, UndoResult } from '../shared/run-changes.ts';

/** What a run's task changed, and putting a file of it back. */
export interface RunChangesState {
  /** What it changed and read, as the app last said, or null before it says anything. */
  changes: RunChanges | null;
  /** Puts a file back as it was before the task, taking in what the task changed then. */
  undo: (path: string, anyway: boolean) => Promise<UndoResult>;
}

/**
 * Follows what each run's task changed in the job hunt, and the pages it read, as the app says
 * once each of its turns ends, by the run's ID. A run whose tab closed is let go.
 */
export function useRunChanges(
  api: Pick<FactwrightApi, 'onRunChanges' | 'undoChange'>,
  runIds: readonly string[],
): (runId: string) => RunChangesState {
  const [heard, setHeard] = useState<Readonly<Record<string, RunChanges>>>({});
  useEffect(
    () =>
      api.onRunChanges(({ runId, changes }) => setHeard((all) => ({ ...all, [runId]: changes }))),
    [api],
  );
  const key = runIds.join(' ');
  useEffect(() => {
    const open = new Set(key.split(' '));
    setHeard((all) =>
      Object.keys(all).every((runId) => open.has(runId))
        ? all
        : Object.fromEntries(Object.entries(all).filter(([runId]) => open.has(runId))),
    );
  }, [key]);
  const undo = useCallback(
    async (runId: string, id: string | undefined, path: string, anyway: boolean) => {
      if (!id) {
        return {
          ok: false,
          reason: 'failed',
          message: 'That task’s changes are gone.',
        } satisfies UndoResult;
      }
      const result = await api.undoChange(id, path, anyway).catch(
        (): UndoResult => ({
          ok: false,
          reason: 'failed',
          message: 'That didn’t go through. Try again in a moment.',
        }),
      );
      // What the task changed, as it stands now, unless its run's tab closed meanwhile.
      if (result.ok) {
        setHeard((all) => (all[runId]?.id === id ? { ...all, [runId]: result.changes } : all));
      }
      return result;
    },
    [api],
  );
  return useCallback(
    (runId: string): RunChangesState => {
      const changes = heard[runId] ?? null;
      return { changes, undo: (path, anyway) => undo(runId, changes?.id, path, anyway) };
    },
    [heard, undo],
  );
}
