import { useCallback, useEffect, useRef, useState } from 'react';
import type { AboutYou, AnswerChanges } from '../../shared/about.ts';
import type { FactwrightApi } from '../../shared/api.ts';
import type { Profile } from '../../shared/profile.ts';

/** How long typing pauses before answers and notes are saved. */
const SAVE_AFTER_MS = 500;

type ProfileApi = Pick<
  FactwrightApi,
  'profile' | 'saveAnswers' | 'saveNotes' | 'changeConfidential' | 'onProfileChanged'
>;

/** Changes not saved yet: answers, and the notes when they changed. */
interface Unsaved {
  answers: AnswerChanges;
  notes: string | null;
}

const NOTHING: Unsaved = { answers: {}, notes: null };

const isEmpty = (unsaved: Unsaved) =>
  Object.keys(unsaved.answers).length === 0 && unsaved.notes === null;

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
  /** Saves the user's list of confidential names, as what they added and removed. */
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
 * a change from elsewhere never overwrites what they're in the middle of typing, or what's on its
 * way to being saved. A save that fails keeps its changes, to try again with the next one.
 */
export function useProfile(api: ProfileApi): ProfileState {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  // Typed and not sent yet, then sent and not saved yet.
  const pending = useRef<Unsaved>(NOTHING);
  const saving = useRef<Unsaved>(NOTHING);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest from the main process, before anything unsaved goes on top.
  const latest = useRef<Profile | null>(null);

  /** Shows the profile with what's not saved yet on top of it. */
  const show = useCallback((next: Profile) => {
    latest.current = next;
    const [sent, typed] = [saving.current, pending.current];
    setProfile({
      ...next,
      answers: { ...next.answers, ...sent.answers, ...typed.answers },
      notes: typed.notes ?? sent.notes ?? next.notes,
    });
  }, []);

  useEffect(() => {
    let live = true;
    api.profile().then(
      (loaded) => live && show(loaded),
      () => live && setProblem('Your profile didn’t load. Restart Factwright to try again.'),
    );
    const stop = api.onProfileChanged((changed) => show(changed));
    return () => {
      live = false;
      stop();
    };
  }, [api, show]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const batch = pending.current;
    if (isEmpty(batch)) return;
    pending.current = NOTHING;
    saving.current = batch;
    let failed: Unsaved = NOTHING;
    if (Object.keys(batch.answers).length > 0) {
      try {
        const kept = await api.saveAnswers(batch.answers);
        if (latest.current) latest.current = { ...latest.current, answers: kept };
      } catch {
        failed = { ...failed, answers: batch.answers };
      }
    }
    if (batch.notes !== null) {
      try {
        const result = await api.saveNotes(batch.notes);
        if (!result.ok) throw new Error(result.message);
        if (latest.current) latest.current = { ...latest.current, notes: batch.notes };
      } catch {
        failed = { ...failed, notes: batch.notes };
      }
    }
    // What didn't save goes back under anything typed since, for the next save to carry.
    pending.current = {
      answers: { ...failed.answers, ...pending.current.answers },
      notes: pending.current.notes ?? failed.notes,
    };
    saving.current = NOTHING;
    if (latest.current) show(latest.current);
    setProblem(
      isEmpty(failed)
        ? null
        : 'That didn’t save yet. It tries again as you go on; if it keeps failing, check that Factwright can write to its folder.',
    );
    setSaved(isEmpty(pending.current));
  }, [api, show]);

  const later = useCallback(() => {
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }, [flush]);

  // Anything still waiting is saved when the screen goes away.
  useEffect(() => () => void flush(), [flush]);

  const update = useCallback(
    (changes: AnswerChanges) => {
      pending.current = { ...pending.current, answers: { ...pending.current.answers, ...changes } };
      if (latest.current) show(latest.current);
      later();
    },
    [later, show],
  );

  const setNotes = useCallback(
    (text: string) => {
      pending.current = { ...pending.current, notes: text };
      if (latest.current) show(latest.current);
      later();
    },
    [later, show],
  );

  const saveConfidential = useCallback(
    async (names: string[]) => {
      const before = latest.current?.confidential ?? [];
      const has = (list: readonly string[], name: string) =>
        list.some((each) => each.toLowerCase() === name.toLowerCase());
      const add = names.filter((name) => !has(before, name));
      const remove = before.filter((name) => !has(names, name));
      if (latest.current) show({ ...latest.current, confidential: names });
      try {
        const kept = await api.changeConfidential({ add, remove });
        if (latest.current) show({ ...latest.current, confidential: kept });
      } catch {
        setProblem('That didn’t save. Try again.');
      }
    },
    [api, show],
  );

  const take = useCallback(
    (answers: AboutYou) => {
      if (latest.current) show({ ...latest.current, answers });
    },
    [show],
  );

  const refresh = useCallback(async () => {
    try {
      show(await api.profile());
    } catch {
      // The next change from the workspace brings it up to date.
    }
  }, [api, show]);

  return { profile, update, setNotes, saved, flush, saveConfidential, take, refresh, problem };
}

/** Whether the user still has to get started: no fact bank, and nothing handed to Claude yet. */
export const needsGettingStarted = (profile: Profile) =>
  profile.status.facts.claims === 0 && profile.answers.startedOn === null;
