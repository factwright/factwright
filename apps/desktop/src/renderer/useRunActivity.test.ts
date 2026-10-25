// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RunStep, TurnEnd } from '../shared/activity.ts';
import type { FactwrightApi } from '../shared/api.ts';
import { useRunActivity } from './useRunActivity.ts';

function fakeApi() {
  let step: (heard: { runId: string; step: RunStep }) => void = () => {};
  let end: (heard: { runId: string; end: TurnEnd }) => void = () => {};
  const api = {
    onClaudeStep: (listener: typeof step) => {
      step = listener;
      return () => {};
    },
    onClaudeTurnEnd: (listener: typeof end) => {
      end = listener;
      return () => {};
    },
  } as unknown as FactwrightApi;
  return {
    api,
    step: (value: RunStep, runId = 'run-1') => step({ runId, step: value }),
    end: (value: TurnEnd, runId = 'run-1') => end({ runId, end: value }),
  };
}

const read = (state: RunStep['state'], id = 'toolu_1'): RunStep => ({
  id,
  tool: 'Read',
  detail: 'facts/platform.md',
  state,
});

describe('useRunActivity', () => {
  it('keeps each step as it stands, in the order they started, and how the turn ended', () => {
    const { api, step, end } = fakeApi();
    const { result } = renderHook(() => useRunActivity(api, ['run-1']));
    expect(result.current('run-1')).toEqual({ steps: [], lastAt: null, end: null });
    act(() => step(read('running')));
    act(() => step(read('running', 'toolu_2')));
    act(() => step(read('done')));
    expect(result.current('run-1').steps).toEqual([read('done'), read('running', 'toolu_2')]);
    expect(result.current('run-1').lastAt).not.toBeNull();
    // A start heard after its end leaves the end be.
    act(() => step(read('running')));
    expect(result.current('run-1').steps[0]).toEqual(read('done'));
    act(() => end({ said: 'Done.', error: null }));
    expect(result.current('run-1').end).toEqual({ said: 'Done.', error: null });
  });

  it('keeps each run’s apart, and lets a run go once its tab closes', () => {
    const { api, step } = fakeApi();
    const { result, rerender } = renderHook(({ runs }) => useRunActivity(api, runs), {
      initialProps: { runs: ['run-1', 'run-2'] },
    });
    act(() => step(read('done')));
    act(() => step(read('running', 'toolu_3'), 'run-2'));
    expect(result.current('run-1').steps).toEqual([read('done')]);
    expect(result.current('run-2').steps).toEqual([read('running', 'toolu_3')]);
    rerender({ runs: ['run-2'] });
    expect(result.current('run-1')).toEqual({ steps: [], lastAt: null, end: null });
    expect(result.current('run-2').steps).toHaveLength(1);
  });
});
