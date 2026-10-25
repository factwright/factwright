// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QuestionRound } from '../shared/rounds.ts';
import { useClaudeQuestions } from './useClaudeQuestions.ts';

const round = (id: string): QuestionRound => ({
  id,
  questions: [
    {
      question: 'Which round is it?',
      header: null,
      kind: 'choice',
      description: null,
      placeholder: null,
      multiSelect: false,
      options: [],
      number: null,
    },
  ],
});

/** The window's API for Claude's questions, with the round waiting before it listened. */
function fakeApi() {
  let tell: (round: QuestionRound | null) => void = () => {};
  let waiting: (round: QuestionRound | null) => void = () => {};
  const api = {
    claudeQuestion: vi.fn(
      () =>
        new Promise<QuestionRound | null>((resolve) => {
          waiting = resolve;
        }),
    ),
    onClaudeQuestion: vi.fn((listener: (round: QuestionRound | null) => void) => {
      tell = listener;
      return () => {};
    }),
  };
  return {
    api,
    tell: (next: QuestionRound | null) => act(() => tell(next)),
    waiting: async (next: QuestionRound | null) => act(async () => waiting(next)),
  };
}

describe('useClaudeQuestions', () => {
  it('opens each new round, and keeps one put aside closed until the user opens it again', () => {
    const { api, tell } = fakeApi();
    const { result } = renderHook(() => useClaudeQuestions(api));
    expect(result.current).toMatchObject({ round: null, open: false });
    tell(round('a'));
    expect(result.current).toMatchObject({ round: { id: 'a' }, open: true });
    act(() => result.current.hide());
    expect(result.current).toMatchObject({ round: { id: 'a' }, open: false });
    act(() => result.current.show());
    expect(result.current.open).toBe(true);
    act(() => result.current.hide());
    tell(round('b'));
    expect(result.current).toMatchObject({ round: { id: 'b' }, open: true });
    tell(null);
    expect(result.current).toMatchObject({ round: null, open: false });
  });

  it('keeps what the user chose in a round while it’s put aside, and only for that round', () => {
    const { api, tell } = fakeApi();
    const { result } = renderHook(() => useClaudeQuestions(api));
    const chosen = [
      { picks: ['Yes'], other: '', otherOn: false, note: '', noting: false, skipped: false },
    ];
    act(() => result.current.keepDraft(chosen));
    expect(result.current.draft).toBeNull();
    tell(round('a'));
    act(() => result.current.keepDraft(chosen));
    act(() => result.current.hide());
    act(() => result.current.show());
    expect(result.current.draft).toBe(chosen);
    tell(round('b'));
    expect(result.current.draft).toBeNull();
  });

  it('shows a round that was waiting before the window listened, unless a newer one came since', async () => {
    const first = fakeApi();
    const { result } = renderHook(() => useClaudeQuestions(first.api));
    await first.waiting(round('a'));
    expect(result.current).toMatchObject({ round: { id: 'a' }, open: true });

    const second = fakeApi();
    const later = renderHook(() => useClaudeQuestions(second.api));
    second.tell(null);
    await second.waiting(round('a'));
    expect(later.result.current.round).toBeNull();
  });
});
