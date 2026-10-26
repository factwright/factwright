// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FactwrightApi, WaitingAsk, WaitingRound } from '../shared/api.ts';
import { useWaitingTurns } from './useWaitingTurns.ts';

const round = (runId: string, since: number): WaitingRound => ({
  id: `${runId}/toolu_${since}`,
  runId,
  since,
  questions: [
    {
      question: `Question ${since}?`,
      header: null,
      kind: 'text',
      description: null,
      placeholder: null,
      multiSelect: false,
      options: [],
      number: null,
    },
  ],
});

const ask = (runId: string, since: number): WaitingAsk => ({
  id: `${runId}/perm_${since}`,
  runId,
  since,
  kind: 'read',
  file: 'facts/acme.md',
  outside: false,
});

function fakeApi(start: { rounds?: WaitingRound[]; asks?: WaitingAsk[] } = {}) {
  let rounds: (next: WaitingRound[]) => void = () => {};
  let asks: (next: WaitingAsk[]) => void = () => {};
  const api = {
    claudeQuestions: async () => start.rounds ?? [],
    onClaudeQuestions: (listener: typeof rounds) => {
      rounds = listener;
      return () => {};
    },
    claudePermissions: async () => start.asks ?? [],
    onClaudePermissions: (listener: typeof asks) => {
      asks = listener;
      return () => {};
    },
  } as unknown as FactwrightApi;
  return {
    api,
    rounds: (next: WaitingRound[]) => rounds(next),
    asks: (next: WaitingAsk[]) => asks(next),
  };
}

/** The turn shown, by its ID, or null. */
const shownId = (turns: ReturnType<typeof useWaitingTurns>) => turns.shown?.item.id ?? null;

describe('useWaitingTurns', () => {
  it('takes every run’s questions and OKs in the order they came in, one at a time', () => {
    const { api, rounds, asks } = fakeApi();
    const { result } = renderHook(() => useWaitingTurns(api));
    act(() => rounds([round('run-1', 1), round('run-3', 4)]));
    act(() => asks([ask('run-2', 2)]));
    expect(result.current.turns.map((turn) => turn.item.id)).toEqual([
      'run-1/toolu_1',
      'run-2/perm_2',
      'run-3/toolu_4',
    ]);
    expect(shownId(result.current)).toBe('run-1/toolu_1');
    // Answered, the next one shows.
    act(() => rounds([round('run-3', 4)]));
    expect(shownId(result.current)).toBe('run-2/perm_2');
  });

  it('goes back and forth between them, and to a run’s own', () => {
    const { api, rounds } = fakeApi();
    const { result } = renderHook(() => useWaitingTurns(api));
    act(() => rounds([round('run-1', 1), round('run-2', 2), round('run-3', 3)]));
    act(() => result.current.go(1));
    expect(shownId(result.current)).toBe('run-2/toolu_2');
    act(() => result.current.go(1));
    act(() => result.current.go(1));
    expect(shownId(result.current)).toBe('run-3/toolu_3');
    act(() => result.current.go(-1));
    expect(shownId(result.current)).toBe('run-2/toolu_2');
    act(() => result.current.show('run-1'));
    expect(shownId(result.current)).toBe('run-1/toolu_1');
  });

  it('puts them aside until something new comes, or the user asks for one', () => {
    const { api, rounds } = fakeApi();
    const { result } = renderHook(() => useWaitingTurns(api));
    act(() => rounds([round('run-1', 1), round('run-2', 2)]));
    act(() => result.current.hide());
    expect(result.current.shown).toBeNull();
    act(() => rounds([round('run-1', 1), round('run-2', 2), round('run-3', 3)]));
    expect(shownId(result.current)).toBe('run-3/toolu_3');
    // Answered, what was put aside stays put aside.
    act(() => rounds([round('run-1', 1), round('run-2', 2)]));
    expect(result.current.shown).toBeNull();
    act(() => result.current.show());
    expect(shownId(result.current)).toBe('run-1/toolu_1');
  });

  it('keeps what the user chose in each round while they’re at another', () => {
    const { api, rounds } = fakeApi();
    const { result } = renderHook(() => useWaitingTurns(api));
    act(() => rounds([round('run-1', 1), round('run-2', 2)]));
    const choice = {
      picks: [],
      other: 'Two years',
      otherOn: true,
      note: '',
      noting: false,
      skipped: false,
    };
    act(() => result.current.keepDraft('run-1/toolu_1', [choice]));
    act(() => result.current.go(1));
    expect(result.current.draft('run-1/toolu_1')).toEqual([choice]);
    expect(result.current.draft('run-2/toolu_2')).toBeNull();
    // Gone, its draft goes too.
    act(() => rounds([round('run-2', 2)]));
    expect(result.current.draft('run-1/toolu_1')).toBeNull();
  });

  it('picks up what waited before the window listened', async () => {
    const { api } = fakeApi({ rounds: [round('run-1', 1)], asks: [ask('run-2', 2)] });
    const { result } = renderHook(() => useWaitingTurns(api));
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
    expect(shownId(result.current)).toBe('run-1/toolu_1');
  });
});
