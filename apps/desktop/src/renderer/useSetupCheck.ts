import { useCallback, useEffect, useState } from 'react';
import type { FactwrightApi, SetupCheck } from '../shared/api.ts';

/**
 * The latest check that Factwright's setup works with the user's Claude Code, kept up to date as
 * new checks finish, and a way to check again.
 */
export function useSetupCheck(api: FactwrightApi): {
  check: SetupCheck | null;
  checking: boolean;
  checkAgain: () => void;
} {
  const [check, setCheck] = useState<SetupCheck | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    // A check that finishes while this answer is on its way is newer, so it wins.
    api.setupCheck().then(
      (latest) => live && latest && setCheck((current) => current ?? latest),
      () => {},
    );
    const stop = api.onSetupCheck(setCheck);
    return () => {
      live = false;
      stop();
    };
  }, [api]);

  const checkAgain = useCallback(() => {
    setChecking(true);
    api
      .checkSetup()
      .then(
        (next) => next && setCheck(next),
        () => {},
      )
      .finally(() => setChecking(false));
  }, [api]);

  return { check, checking, checkAgain };
}
