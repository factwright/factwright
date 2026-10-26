import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FactwrightApi, WaitingAsk, WaitingRound } from '../shared/api.ts';

/** What the user has chosen for one of a round's questions so far. */
export interface Choice {
  picks: string[];
  /** Their own words, which count only while their own answer is chosen. */
  other: string;
  /** Whether their own answer is chosen: always, for a question with no options. */
  otherOn: boolean;
  note: string;
  /** Whether the box for a note is showing. */
  noting: boolean;
  /** Whether the user skipped the question. What they chose before stays, for if they answer it after all. */
  skipped: boolean;
}

/** Something one of Claude's runs waits on the user to answer: a round of questions, or an OK. */
export type Turn =
  | { kind: 'questions'; item: WaitingRound }
  | { kind: 'permission'; item: WaitingAsk };

export interface WaitingTurns {
  /** Everything waiting on the user, from every run, in the order it came in. */
  turns: readonly Turn[];
  /** The one the dialog shows, or null while it's put aside, or nothing waits. */
  shown: Turn | null;
  /** Shows the dialog: at a run's first turn, or at the first one the user didn't put aside. */
  show: (runId?: string) => void;
  /** Puts the dialog aside: what waits stays waiting, and anything new opens it again. */
  hide: () => void;
  /** Goes to the turn before, or after, the one shown. */
  go: (offset: -1 | 1) => void;
  /** What the user chose in a round of questions so far, kept while it waits, or null. */
  draft: (roundId: string) => Choice[] | null;
  /** Keeps what the user has chosen in a round, while they're at another or put it aside. */
  keepDraft: (roundId: string, choices: Choice[]) => void;
}

/** Follows what one of the app's lists of things waiting says, from when the window listens. */
function useWaitingList<T>(
  current: () => Promise<T[]>,
  subscribe: (listener: (items: T[]) => void) => () => void,
): T[] {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    let live = true;
    let heard = false;
    const stop = subscribe((next) => {
      heard = true;
      if (live) setItems(next);
    });
    // What was waiting before the window listened, such as after it reloaded. Anything heard
    // since is newer.
    current().then(
      (waiting) => {
        if (live && !heard) setItems(waiting);
      },
      () => {},
    );
    return () => {
      live = false;
      stop();
    };
  }, [current, subscribe]);
  return items;
}

/**
 * Follows what Claude's runs wait on the user to answer in the app, the rounds of Claude's
 * questions and Claude Code's permission prompts, as one line of turns in the order they came in,
 * which the dialog goes through one at a time. The user can switch between them, or put them
 * aside, until something new comes.
 */
export function useWaitingTurns(
  api: Pick<
    FactwrightApi,
    'claudeQuestions' | 'onClaudeQuestions' | 'claudePermissions' | 'onClaudePermissions'
  >,
): WaitingTurns {
  const rounds = useWaitingList(api.claudeQuestions, api.onClaudeQuestions);
  const asks = useWaitingList(api.claudePermissions, api.onClaudePermissions);
  const turns = useMemo<Turn[]>(
    () =>
      [
        ...rounds.map((item): Turn => ({ kind: 'questions', item })),
        ...asks.map((item): Turn => ({ kind: 'permission', item })),
      ].sort((a, b) => a.item.since - b.item.since),
    [rounds, asks],
  );
  // What the user put aside, which stays closed until they open it again, and the turn they went
  // to, if they did.
  const [aside, setAside] = useState<ReadonlySet<string>>(new Set());
  const [chosen, setChosen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, Choice[]>>>({});
  const shown =
    turns.find((turn) => turn.item.id === chosen) ??
    turns.find((turn) => !aside.has(turn.item.id)) ??
    null;

  // What's gone takes its draft with it.
  const ids = turns.map((turn) => turn.item.id).join(' ');
  useEffect(() => {
    const waiting = new Set(ids.split(' '));
    setDrafts((all) =>
      Object.keys(all).every((id) => waiting.has(id))
        ? all
        : Object.fromEntries(Object.entries(all).filter(([id]) => waiting.has(id))),
    );
  }, [ids]);

  const goTo = useCallback((turn: Turn | undefined) => {
    if (!turn) return;
    const id = turn.item.id;
    setAside((was) => {
      const next = new Set(was);
      next.delete(id);
      return next;
    });
    setChosen(id);
  }, []);

  return {
    turns,
    shown,
    show: (runId) =>
      goTo(
        runId === undefined
          ? (turns.find((turn) => !aside.has(turn.item.id)) ?? turns[0])
          : turns.find((turn) => turn.item.runId === runId),
      ),
    hide: () => {
      setAside(new Set(turns.map((turn) => turn.item.id)));
      setChosen(null);
    },
    go: (offset) => {
      const at = shown ? turns.indexOf(shown) : -1;
      goTo(turns[at + offset]);
    },
    draft: (roundId) => drafts[roundId] ?? null,
    keepDraft: useCallback(
      (roundId: string, choices: Choice[]) => setDrafts((all) => ({ ...all, [roundId]: choices })),
      [],
    ),
  };
}
