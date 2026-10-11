// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FactwrightApi, RunSignal, StartResult } from '../shared/api.ts';
import type { RunTask } from '../shared/runs.ts';
import { useClaudeRun } from './useClaudeRun.ts';

const SIZE = { cols: 100, rows: 30 };
const TASK: RunTask = { skill: 'fit-check', jobId: 'acme--staff-engineer' };

function fakeApi(task: StartResult = { ok: true }) {
  let signal: (value: RunSignal) => void = () => {};
  const api = {
    startClaude: vi.fn(async () => ({ ok: true }) as StartResult),
    runTask: vi.fn(async () => task),
    resizeClaude: vi.fn(),
    stopClaude: vi.fn(),
    onClaudeSignal: (listener: (value: RunSignal) => void) => {
      signal = listener;
      return () => {};
    },
  };
  return {
    api: api as unknown as FactwrightApi & typeof api,
    signal: (value: RunSignal) => signal(value),
  };
}

describe('useClaudeRun', () => {
  it('starts Claude with a skill to run on a job, once the terminal has its size', async () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => useClaudeRun(api));
    act(() => result.current.requestStart(TASK));
    expect(result.current.phase).toBe('starting');
    expect(result.current.task).toEqual(TASK);
    await act(async () => result.current.onTerminalSize(SIZE));
    expect(api.startClaude).toHaveBeenCalledWith(SIZE, TASK);
    await act(async () => result.current.onTerminalSize(SIZE));
    expect(api.startClaude).toHaveBeenCalledTimes(1);
    expect(api.resizeClaude).toHaveBeenCalledWith(SIZE);
  });

  it('gives Claude that’s open and done the next task, without a new run', async () => {
    const { api, signal } = fakeApi();
    const { result } = renderHook(() => useClaudeRun(api));
    act(() => result.current.requestStart());
    await act(async () => result.current.onTerminalSize(SIZE));
    expect(api.startClaude).toHaveBeenCalledWith(SIZE, undefined);
    const runId = result.current.runId;
    act(() => signal('done'));
    await act(async () => result.current.requestStart(TASK));
    expect(api.runTask).toHaveBeenCalledWith(TASK);
    expect(result.current.runId).toBe(runId);
    expect(result.current.phase).toBe('working');
  });

  it('starts again when Claude closed before the task reached it', async () => {
    const { api, signal } = fakeApi({ ok: false, reason: 'not-running' });
    const { result } = renderHook(() => useClaudeRun(api));
    act(() => signal('done'));
    await act(async () => result.current.requestStart(TASK));
    expect(result.current.phase).toBe('starting');
    await act(async () => result.current.onTerminalSize(SIZE));
    expect(api.startClaude).toHaveBeenCalledWith(SIZE, TASK);
  });
});
