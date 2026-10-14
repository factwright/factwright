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
 * they've loaded. Claude's settings pass on each choice they save, so it shows as it's made.
 */
export function useLevelChoices(api: Pick<FactwrightApi, 'claudeModels' | 'claudeEffort'>): {
  choices: LevelChoices | null;
  saved: (choices: Partial<LevelChoices>) => void;
} {
  const [choices, setChoices] = useState<LevelChoices | null>(null);
  // What was saved while the first load was on its way, which is newer than what it read.
  const saves = useRef<Partial<LevelChoices>>({});

  useEffect(() => {
    Promise.all([api.claudeModels(), api.claudeEffort()]).then(
      ([models, effort]) => setChoices({ models, effort, ...saves.current }),
      // Without them, the levels don't show.
      () => {},
    );
  }, [api]);

  const saved = useCallback((next: Partial<LevelChoices>) => {
    saves.current = { ...saves.current, ...next };
    setChoices((now) => now && { ...now, ...next });
  }, []);

  return { choices, saved };
}
