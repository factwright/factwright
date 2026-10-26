import { useCallback, useEffect, useState } from 'react';
import type { RunHelper, RunStep, TodoItem, TurnEnd } from '../shared/activity.ts';
import type { FactwrightApi } from '../shared/api.ts';

/** The most steps kept for one task, the latest, however long it runs. */
const MAX_STEPS = 200;

/**
 * What Claude has done in a run's task, when it last did something, how it stopped, and where
 * the task stands: Claude's to-do list, and its helpers at work.
 */
export interface RunActivity {
  /** Its tool calls, in the order they started, each as it stands now. */
  steps: readonly RunStep[];
  /** When the last call started or ended, in milliseconds, or null before the first. */
  lastAt: number | null;
  /** How Claude's last turn ended: what it said, or the error that ended it. */
  end: TurnEnd | null;
  /** The to-do list Claude keeps, each item as it stands now, or none. */
  todos: readonly TodoItem[];
  /** The helpers at work on the task, in the order Claude started them. */
  helpers: readonly RunHelper[];
}

/** A step heard again takes the place of what was heard of it before, such as once it's done. */
function merged(steps: readonly RunStep[], step: RunStep): readonly RunStep[] {
  const at = steps.findIndex((each) => each.id === step.id);
  if (at < 0) return [...steps, step].slice(-MAX_STEPS);
  // A start heard after its end, as a hook can arrive late, leaves the end be.
  if (step.state === 'running' && steps[at]?.state !== 'running') return steps;
  return steps.map((each, i) => (i === at ? step : each));
}

export const NOTHING_DONE: RunActivity = {
  steps: [],
  lastAt: null,
  end: null,
  todos: [],
  helpers: [],
};

/**
 * Follows what Claude does in each run, a tool call at a time, how each of its turns ends, and
 * where its task stands, as Claude Code's hooks tell it, by the run's ID. A run whose tab closed
 * is let go. Each run is one task, so a new one starts with nothing done.
 */
export function useRunActivity(
  api: Pick<FactwrightApi, 'onClaudeStep' | 'onClaudeProgress' | 'onClaudeTurnEnd'>,
  runIds: readonly string[],
): (runId: string) => RunActivity {
  const [heard, setHeard] = useState<Readonly<Record<string, RunActivity>>>({});
  useEffect(() => {
    const change = (runId: string, next: (was: RunActivity) => RunActivity) =>
      setHeard((all) => ({ ...all, [runId]: next(all[runId] ?? NOTHING_DONE) }));
    const stopSteps = api.onClaudeStep(({ runId, step }) =>
      change(runId, (was) => ({ ...was, steps: merged(was.steps, step), lastAt: Date.now() })),
    );
    const stopProgress = api.onClaudeProgress(({ runId, progress: { todos, helpers } }) =>
      change(runId, (was) => ({ ...was, todos, helpers, lastAt: Date.now() })),
    );
    const stopEnds = api.onClaudeTurnEnd(({ runId, end }) =>
      change(runId, (was) => ({ ...was, end })),
    );
    return () => {
      stopSteps();
      stopProgress();
      stopEnds();
    };
  }, [api]);
  // The runs whose tabs closed take nothing kept with them.
  const key = runIds.join(' ');
  useEffect(() => {
    const open = new Set(key.split(' '));
    setHeard((all) =>
      Object.keys(all).every((runId) => open.has(runId))
        ? all
        : Object.fromEntries(Object.entries(all).filter(([runId]) => open.has(runId))),
    );
  }, [key]);
  return useCallback((runId: string) => heard[runId] ?? NOTHING_DONE, [heard]);
}
