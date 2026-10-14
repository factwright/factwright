import { useCallback, useEffect, useRef, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import type { EffortChoices } from '../shared/effort.ts';
import type { ModelChoices } from '../shared/models.ts';

/** The user's choices of model and effort, together. */
export interface LevelChoices {
  models: ModelChoices;
  effort: EffortChoices;
}

/**
 * The user's choices of model and effort, for showing the levels Claude runs at, or null until
 * they've loaded. Reload them after Claude's settings change them.
 */
export function useLevelChoices(api: Pick<FactwrightApi, 'claudeModels' | 'claudeEffort'>): {
  choices: LevelChoices | null;
  reload: () => void;
} {
  const [choices, setChoices] = useState<LevelChoices | null>(null);
  // Only the newest load's answer counts, if two overlap.
  const latest = useRef(0);

  const reload = useCallback(() => {
    const id = ++latest.current;
    Promise.all([api.claudeModels(), api.claudeEffort()]).then(
      ([models, effort]) => id === latest.current && setChoices({ models, effort }),
      // What showed stays, until the next load.
      () => {},
    );
  }, [api]);

  useEffect(reload, [reload]);

  return { choices, reload };
}
