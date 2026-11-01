import { useEffect, useRef, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';

/** Each version's short notes, built into the app. */
const SHORT_NOTES = import.meta.glob<string>('../../../release-notes/*.short.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** A version's short notes, or null for one without them, as a copy being developed may be. */
export const shortNotes = (version: string): string | null =>
  SHORT_NOTES[`../../../release-notes/${version}.short.md`]?.trim() || null;

/**
 * What to do about what's new as the window opens: show it, pass it by for good, or leave it for
 * the next open. Someone still on Get started has no older version to compare with, so it's passed
 * by, and so is a version with nothing to say. With a run or another dialog going, it waits, so it
 * never takes the keyboard from either.
 */
export function stepAtOpen({
  gettingStarted,
  hasNotes,
  busy,
}: {
  gettingStarted: boolean;
  hasNotes: boolean;
  busy: boolean;
}): 'show' | 'pass-by' | 'next-open' {
  if (gettingStarted || !hasNotes) return 'pass-by';
  return busy ? 'next-open' : 'show';
}

/**
 * What's new in the version just installed, to show once as the window opens. It looks once, when
 * the window has what it opens on, and never comes up later over work under way. It keeps that
 * it's been said before it shows, so a copy that can't keep that doesn't say it at every open.
 */
export function useJustUpdated(
  api: Pick<FactwrightApi, 'whatsNewDue' | 'whatsNewSeen'>,
  {
    opened,
    gettingStarted,
    runGoing,
  }: {
    /** Whether the window has what it opens on, so it's settled what shows. */
    opened: boolean;
    /** Whether Get started is what shows. */
    gettingStarted: boolean;
    /** Whether a run of the user's is going, which may need an answer. */
    runGoing: boolean;
  },
) {
  // The version due, null for none, or undefined until the app says.
  const [due, setDue] = useState<string | null | undefined>(undefined);
  const [shown, setShown] = useState<{ version: string; notes: string } | null>(null);
  const looked = useRef(false);
  useEffect(() => {
    api.whatsNewDue().then(setDue, () => setDue(null));
  }, [api]);
  useEffect(() => {
    if (looked.current || due === undefined || !opened) return;
    looked.current = true;
    if (due === null) return;
    const notes = shortNotes(due);
    const step = stepAtOpen({
      gettingStarted,
      hasNotes: notes !== null,
      busy: runGoing || document.querySelector('dialog[open]') !== null,
    });
    if (step === 'next-open') return;
    api.whatsNewSeen().then(
      () => {
        if (step === 'show' && notes) setShown({ version: due, notes });
      },
      // It says nothing this time, and looks again at the next open.
      () => {},
    );
  }, [api, due, opened, gettingStarted, runGoing]);
  return { shown, close: () => setShown(null) };
}
