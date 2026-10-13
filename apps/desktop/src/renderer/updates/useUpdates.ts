import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { UpdateStatus } from '../../shared/updates.ts';

/** Where an update to Factwright stands, kept up to date as it downloads. */
export function useUpdates(api: Pick<FactwrightApi, 'updateStatus' | 'onUpdateChanged'>) {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'none' });
  useEffect(() => {
    let live = true;
    api.updateStatus().then(
      (current) => {
        if (live) setStatus(current);
      },
      // Without it, the app just doesn't show an update: there's nothing for the user to do.
      () => {},
    );
    const stop = api.onUpdateChanged((next) => setStatus(next));
    return () => {
      live = false;
      stop();
    };
  }, [api]);
  return status;
}
