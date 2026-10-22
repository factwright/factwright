// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RunStep, TurnEnd } from '../shared/activity.ts';
import type { FactwrightApi } from '../shared/api.ts';
import { useRunActivity } from './useRunActivity.ts';

function fakeApi() {
  let step: (value: RunStep) => void = () => {};
  let end: (value: TurnEnd) => void = () => {};
  const api = {
    onClaudeStep: (listener: (value: RunStep) => void) => {
      step = listener;
      return () => {};
    },
    onClaudeTurnEnd: (listener: (value: TurnEnd) => void) => {
      end = listener;
      return () => {};
    },
  } as unknown as FactwrightApi;
  return { api, step: (value: RunStep) => step(value), end: (value: TurnEnd) => end(value) };
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
    const { result } = renderHook(({ taskId }) => useRunActivity(api, taskId), {
      initialProps: { taskId: 1 },
    });
    expect(result.current).toEqual({ steps: [], lastAt: null, end: null });
    act(() => step(read('running')));
    act(() => step(read('running', 'toolu_2')));
    act(() => step(read('done')));
    expect(result.current.steps).toEqual([read('done'), read('running', 'toolu_2')]);
    expect(result.current.lastAt).not.toBeNull();
    // A start heard after its end leaves the end be.
    act(() => step(read('running')));
    expect(result.current.steps[0]).toEqual(read('done'));
    act(() => end({ said: 'Done.', error: null }));
    expect(result.current.end).toEqual({ said: 'Done.', error: null });
  });

  it('starts another task with nothing done', () => {
    const { api, step } = fakeApi();
    const { result, rerender } = renderHook(({ taskId }) => useRunActivity(api, taskId), {
      initialProps: { taskId: 1 },
    });
    act(() => step(read('done')));
    rerender({ taskId: 2 });
    expect(result.current).toEqual({ steps: [], lastAt: null, end: null });
    act(() => step(read('running', 'toolu_3')));
    expect(result.current.steps).toEqual([read('running', 'toolu_3')]);
  });
});
