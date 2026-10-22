import { useEffect, useState } from 'react';
import type { RunStep, TurnEnd } from '../shared/activity.ts';
import type { FactwrightApi } from '../shared/api.ts';

/** The most steps kept for one task, the latest, however long it runs. */
const MAX_STEPS = 200;

/** What Claude has done in the task at hand, when it last did something, and how it stopped. */
export interface RunActivity {
  /** Its tool calls, in the order they started, each as it stands now. */
  steps: readonly RunStep[];
  /** When the last call started or ended, in milliseconds, or null before the first. */
  lastAt: number | null;
  /** How Claude's last turn ended: what it said, or the error that ended it. */
  end: TurnEnd | null;
}

/** A step heard again takes the place of what was heard of it before, such as once it's done. */
function merged(steps: readonly RunStep[], step: RunStep): readonly RunStep[] {
  const at = steps.findIndex((each) => each.id === step.id);
  if (at < 0) return [...steps, step].slice(-MAX_STEPS);
  // A start heard after its end, as a hook can arrive late, leaves the end be.
  if (step.state === 'running' && steps[at]?.state !== 'running') return steps;
  return steps.map((each, i) => (i === at ? step : each));
}

const NOTHING: RunActivity = { steps: [], lastAt: null, end: null };

/**
 * Follows what Claude does in the task at hand, a tool call at a time, and how each of its turns
 * ends, as Claude Code's hooks tell it. Another task, by its ID, starts with nothing done.
 */
export function useRunActivity(api: FactwrightApi, taskId: number): RunActivity {
  const [heard, setHeard] = useState<{ taskId: number; activity: RunActivity }>({
    taskId,
    activity: NOTHING,
  });
  if (heard.taskId !== taskId) setHeard({ taskId, activity: NOTHING });
  useEffect(() => {
    const stopSteps = api.onClaudeStep((step) =>
      setHeard((was) => ({
        ...was,
        activity: { ...was.activity, steps: merged(was.activity.steps, step), lastAt: Date.now() },
      })),
    );
    const stopEnds = api.onClaudeTurnEnd((end) =>
      setHeard((was) => ({ ...was, activity: { ...was.activity, end } })),
    );
    return () => {
      stopSteps();
      stopEnds();
    };
  }, [api]);
  return heard.taskId === taskId ? heard.activity : NOTHING;
}
