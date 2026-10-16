import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';

/** Reminders before calls, on this computer: whether they come, and turning them on or off. */
export interface ReminderSwitch {
  on: boolean;
  turn: (on: boolean) => void;
}

/** Whether reminders before calls are on, once that's known, and a way to turn them on or off. */
export function useCallReminders(
  api: Pick<FactwrightApi, 'callReminders' | 'setCallReminders'>,
): ReminderSwitch | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api.callReminders().then(
      (value) => {
        if (live) setOn(value);
      },
      // Without an answer, the switch stays out of sight.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api]);
  const turn = useCallback(
    (next: boolean) => {
      setOn(next);
      // A change the app couldn't make goes back.
      api.setCallReminders(next).then(setOn, () => setOn(!next));
    },
    [api],
  );
  return useMemo(() => (on === null ? null : { on, turn }), [on, turn]);
}
