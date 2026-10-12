import { useCallback, useEffect, useRef, useState } from 'react';
import type { AboutYou, AnswerChanges } from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import type { Profile } from '../../shared/profile.ts';

/** How long typing pauses before answers and notes are saved. */
const SAVE_AFTER_MS = 500;

type ProfileApi = Pick<
  FactwrightApi,
  'profile' | 'saveAnswers' | 'saveNotes' | 'saveConfidential' | 'onProfileChanged'
>;

export interface ProfileState {
  /** Null while it loads. */
  profile: Profile | null;
  /** Changes answers now on screen, and saves them a moment after typing stops. */
  update: (changes: AnswerChanges) => void;
  /** Changes the notes now on screen, and saves them a moment after typing stops. */
  setNotes: (text: string) => void;
  /** Whether everything typed so far is saved. */
  saved: boolean;
  /** Saves anything still waiting, such as before Claude starts. */
  flush: () => Promise<void>;
  saveConfidential: (names: string[]) => Promise<void>;
  /** Takes answers the main process sent back, such as after a file was removed. */
  take: (answers: AboutYou) => void;
  /** Reads the profile again now, such as after a file was added. */
  refresh: () => Promise<void>;
  /** A problem saving, in plain words, or null. */
  problem: string | null;
}

/**
 * The user's profile, kept in step with the workspace: Claude fills in the fact bank as it goes,
 * and other devices sync theirs. What the user types shows at once and saves a moment later, so
 * a change from elsewhere never overwrites what they're in the middle of typing.
 */
export function useProfile(api: ProfileApi): ProfileState {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const pending = useRef<{ answers: AnswerChanges; notes: string | null }>({
    answers: {},
    notes: null,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** What's on screen: the latest from the main process, with what's still waiting on top. */
  const withPending = useCallback((latest: Profile): Profile => {
    const { answers, notes } = pending.current;
    return {
      ...latest,
      answers: { ...latest.answers, ...answers },
      notes: notes ?? latest.notes,
    };
  }, []);

  useEffect(() => {
    let live = true;
    api.profile().then(
      (loaded) => live && setProfile(withPending(loaded)),
      () => live && setProblem('Your profile didn’t load. Restart Factwright to try again.'),
    );
    const stop = api.onProfileChanged((latest) => setProfile(withPending(latest)));
    return () => {
      live = false;
      stop();
    };
  }, [api, withPending]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const { answers, notes } = pending.current;
    pending.current = { answers: {}, notes: null };
    try {
      if (Object.keys(answers).length > 0) {
        const kept = await api.saveAnswers(answers);
        setProfile((current) => current && withPending({ ...current, answers: kept }));
      }
      if (notes !== null) {
        const result = await api.saveNotes(notes);
        if (!result.ok) throw new Error(result.message);
      }
      setProblem(null);
    } catch {
      setProblem(
        'That didn’t save. Check that Factwright can write to its folder, then try again.',
      );
    }
    setSaved(Object.keys(pending.current.answers).length === 0 && pending.current.notes === null);
  }, [api, withPending]);

  const later = useCallback(() => {
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }, [flush]);

  // Anything still waiting is saved when the screen goes away.
  useEffect(() => () => void flush(), [flush]);

  const update = useCallback(
    (changes: AnswerChanges) => {
      pending.current.answers = { ...pending.current.answers, ...changes };
      setProfile(
        (current) => current && { ...current, answers: { ...current.answers, ...changes } },
      );
      later();
    },
    [later],
  );

  const setNotes = useCallback(
    (text: string) => {
      pending.current.notes = text;
      setProfile((current) => current && { ...current, notes: text });
      later();
    },
    [later],
  );

  const saveConfidential = useCallback(
    async (names: string[]) => {
      setProfile((current) => current && { ...current, confidential: names });
      try {
        const kept = await api.saveConfidential(names);
        setProfile((current) => current && { ...current, confidential: kept });
      } catch {
        setProblem('That didn’t save. Try again.');
      }
    },
    [api],
  );

  const take = useCallback(
    (answers: AboutYou) => setProfile((current) => current && withPending({ ...current, answers })),
    [withPending],
  );

  const refresh = useCallback(async () => {
    try {
      const latest = await api.profile();
      setProfile(withPending(latest));
    } catch {
      // The next change from the workspace brings it up to date.
    }
  }, [api, withPending]);

  return { profile, update, setNotes, saved, flush, saveConfidential, take, refresh, problem };
}

/** Whether the user still has to get started: no fact bank, and nothing handed to Claude yet. */
export const needsGettingStarted = (profile: Profile) =>
  profile.status.facts.claims === 0 && profile.answers.startedOn === null;
