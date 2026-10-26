// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RunProgress, RunStep, TurnEnd } from '../shared/activity.ts';
import type { FactwrightApi } from '../shared/api.ts';
import { NOTHING_DONE, useRunActivity } from './useRunActivity.ts';

function fakeApi() {
  let step: (heard: { runId: string; step: RunStep }) => void = () => {};
  let progress: (heard: { runId: string; progress: RunProgress }) => void = () => {};
  let end: (heard: { runId: string; end: TurnEnd }) => void = () => {};
  const api = {
    onClaudeStep: (listener: typeof step) => {
      step = listener;
      return () => {};
    },
    onClaudeProgress: (listener: typeof progress) => {
      progress = listener;
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
    progress: (value: RunProgress, runId = 'run-1') => progress({ runId, progress: value }),
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
    expect(result.current('run-1')).toEqual(NOTHING_DONE);
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
    expect(result.current('run-1')).toEqual(NOTHING_DONE);
    expect(result.current('run-2').steps).toHaveLength(1);
  });

  it('keeps where each run’s task stands: where Claude is on its to-do list, and its helpers at work', () => {
    const { api, step, progress } = fakeApi();
    const { result } = renderHook(() => useRunActivity(api, ['run-1', 'run-2']));
    expect(result.current('run-1')).toMatchObject({ todo: null, helpers: [] });
    const todo = {
      at: 2,
      of: 2,
      item: {
        text: 'Write the resume',
        doing: 'Writing the resume',
        state: 'in_progress' as const,
      },
    };
    act(() => step(read('done')));
    act(() => progress({ todo, helpers: [{ id: 'agent-a1', what: 'Fact-check it' }] }));
    expect(result.current('run-1')).toMatchObject({
      todo,
      helpers: [{ id: 'agent-a1', what: 'Fact-check it' }],
    });
    // Its steps stay as they were, and another run's task is its own.
    expect(result.current('run-1').steps).toEqual([read('done')]);
    expect(result.current('run-2')).toEqual(NOTHING_DONE);
    act(() => progress({ todo, helpers: [] }));
    expect(result.current('run-1').helpers).toEqual([]);
  });
});
