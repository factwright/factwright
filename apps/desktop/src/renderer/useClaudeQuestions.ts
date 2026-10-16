import { useCallback, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import type { QuestionRound } from '../shared/rounds.ts';
import { useWaiting } from './useWaiting.ts';

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
}

export interface ClaudeQuestions {
  /** The round of Claude's questions waiting on the user, or null. */
  round: QuestionRound | null;
  /** Whether its dialog is open. The user can put it aside and open it again from Claude's panel. */
  open: boolean;
  show: () => void;
  hide: () => void;
  /** What the user chose in the round so far, which its dialog carries on from, or null. */
  draft: Choice[] | null;
  /** Keeps what the user has chosen in the round, while its dialog is put aside. */
  keepDraft: (choices: Choice[]) => void;
}

/** Follows the rounds of questions Claude waits on the user to answer, opening each new one. */
export function useClaudeQuestions(
  api: Pick<FactwrightApi, 'claudeQuestion' | 'onClaudeQuestion'>,
): ClaudeQuestions {
  const { item: round, open, show, hide } = useWaiting(api.claudeQuestion, api.onClaudeQuestion);
  // What the user chose in a round, by its ID, so putting it aside loses nothing.
  const [draft, setDraft] = useState<{ id: string; choices: Choice[] } | null>(null);
  const id = round?.id ?? null;
  return {
    round,
    open,
    show,
    hide,
    draft: draft !== null && draft.id === id ? draft.choices : null,
    keepDraft: useCallback(
      (choices: Choice[]) => {
        if (id !== null) setDraft({ id, choices });
      },
      [id],
    ),
  };
}
