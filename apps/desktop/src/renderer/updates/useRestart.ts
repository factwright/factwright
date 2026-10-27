import { useState } from 'react';

/**
 * Restart now, for an update that's ready, wherever the window offers it. Over something the user
 * is writing and hasn't saved, it asks first. Claude Code that's done closes before the app
 * restarts, which can take a few seconds, so it says it's restarting meanwhile, and it says when
 * the app didn't restart, as when Claude started working meanwhile.
 */
export function useRestart(unsaved: () => boolean, onRestart: () => Promise<boolean>) {
  const [asking, setAsking] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [refused, setRefused] = useState(false);
  const restart = async () => {
    setAsking(false);
    setRefused(false);
    setRestarting(true);
    const restarted = await onRestart().catch(() => false);
    if (restarted) return;
    setRestarting(false);
    setRefused(true);
  };
  return {
    /** Whether it's asking about something that isn't saved. */
    asking,
    restarting,
    /** Whether the last try didn't restart. */
    refused,
    /** Restart now, which asks first over something that isn't saved. */
    request: () => (unsaved() ? setAsking(true) : void restart()),
    /** Restart anyway, over what isn't saved. */
    restartAnyway: () => void restart(),
    /** Not now, to the question about what isn't saved. */
    cancel: () => setAsking(false),
  };
}
