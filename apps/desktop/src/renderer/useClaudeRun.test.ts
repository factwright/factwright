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
  let trust: () => void = () => {};
  let firstRun: () => void = () => {};
  const api = {
    startClaude: vi.fn(async () => ({ ok: true }) as StartResult),
    runTask: vi.fn(async () => task),
    resizeClaude: vi.fn(),
    stopClaude: vi.fn(),
    onClaudeSignal: (listener: (value: RunSignal) => void) => {
      signal = listener;
      return () => {};
    },
    onClaudeTrust: (listener: () => void) => {
      trust = listener;
      return () => {};
    },
    onClaudeFirstRun: (listener: () => void) => {
      firstRun = listener;
      return () => {};
    },
  };
  return {
    api: api as unknown as FactwrightApi & typeof api,
    signal: (value: RunSignal) => signal(value),
    trust: () => trust(),
    firstRun: () => firstRun(),
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

  it('gives Claude that’s open and ready, with nothing to do yet, the task too', async () => {
    const { api, signal } = fakeApi();
    const { result } = renderHook(() => useClaudeRun(api));
    act(() => result.current.requestStart());
    await act(async () => result.current.onTerminalSize(SIZE));
    const runId = result.current.runId;
    act(() => signal('ready'));
    expect(result.current.phase).toBe('ready');
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

  it('makes way for a new run when the task needs another model, without showing the old one stop', async () => {
    const { api, signal } = fakeApi({ ok: false, reason: 'new-run' });
    const { result } = renderHook(() => useClaudeRun(api));
    act(() => signal('done'));
    const runId = result.current.runId;
    await act(async () => result.current.requestStart(TASK));
    expect(api.stopClaude).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe('starting');
    expect(result.current.runId).toBe(runId + 1);
    // The old run's closing comes in first, and isn't shown.
    act(() => signal('stopped'));
    expect(result.current.phase).toBe('starting');
    await act(async () => result.current.onTerminalSize(SIZE));
    expect(api.startClaude).toHaveBeenCalledWith(SIZE, TASK);
    // The new run's own signals are.
    act(() => signal('working'));
    expect(result.current.phase).toBe('working');
    act(() => signal('stopped'));
    expect(result.current.phase).toBe('stopped');
  });

  it('explains the question about trust until the user answers it, and brings the panel back', async () => {
    const { api, signal, trust } = fakeApi();
    const { result } = renderHook(() => useClaudeRun(api));
    act(() => result.current.requestStart());
    await act(async () => result.current.onTerminalSize(SIZE));
    act(() => result.current.hide());
    act(() => trust());
    expect(result.current.trustAsked).toBe(true);
    expect(result.current.open).toBe(true);
    // Moving through the choices isn't an answer yet; Enter is.
    act(() => result.current.typed('\x1b[B'));
    expect(result.current.trustAsked).toBe(true);
    act(() => result.current.typed('\r'));
    expect(result.current.trustAsked).toBe(false);
    // A hook also means Claude Code is past it, as does a new run.
    act(() => trust());
    act(() => signal('working'));
    expect(result.current.trustAsked).toBe(false);
    act(() => trust());
    act(() => result.current.close());
    expect(result.current.trustAsked).toBe(false);
  });

  it('explains each of Claude Code’s first-run screens until the user answers it', async () => {
    const { api, signal, trust, firstRun } = fakeApi();
    const { result } = renderHook(() => useClaudeRun(api));
    act(() => result.current.requestStart());
    await act(async () => result.current.onTerminalSize(SIZE));
    act(() => result.current.hide());
    act(() => firstRun());
    expect(result.current.firstRun).toBe(true);
    expect(result.current.open).toBe(true);
    // Moving through a screen's choices isn't an answer yet; Enter is. The next screen says so.
    act(() => result.current.typed('\x1b[B'));
    expect(result.current.firstRun).toBe(true);
    act(() => result.current.typed('\r'));
    expect(result.current.firstRun).toBe(false);
    act(() => firstRun());
    expect(result.current.firstRun).toBe(true);
    // The question about trust comes after them.
    act(() => trust());
    expect(result.current.firstRun).toBe(false);
    expect(result.current.trustAsked).toBe(true);
    // A hook also means Claude Code is past them, as does closing the panel.
    act(() => firstRun());
    act(() => signal('working'));
    expect(result.current.firstRun).toBe(false);
    act(() => firstRun());
    act(() => result.current.close());
    expect(result.current.firstRun).toBe(false);
  });
});
