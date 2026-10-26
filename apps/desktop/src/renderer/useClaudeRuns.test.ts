// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi, RunPhase, RunsView, RunView } from '../shared/api.ts';
import type { RunTask } from '../shared/runs.ts';
import { startsNow, useClaudeRuns } from './useClaudeRuns.ts';

const TASK: RunTask = { skill: 'analyze-job', jobId: 'acme--staff-engineer' };

const view = (id: string, phase: RunPhase, task: RunTask | null = TASK): RunView => ({
  id,
  task,
  phase,
  waits: null,
  screen: null,
  startedAt: phase === 'in-line' ? null : 1,
  problem: null,
  analyzed: [],
});

function fakeApi(started: () => Promise<string> = async () => 'run-1') {
  let tell: (next: RunsView) => void = () => {};
  const api = {
    startClaude: vi.fn(started),
    claudeRuns: vi.fn(async (): Promise<RunsView> => ({ runs: [], atOnce: 3, setUp: true })),
    onClaudeRuns: (listener: (next: RunsView) => void) => {
      tell = listener;
      return () => {};
    },
    stopClaude: vi.fn(),
    closeRun: vi.fn(),
    replyToClaude: vi.fn(),
  };
  return {
    api: api as unknown as FactwrightApi & typeof api,
    tell: (runs: RunView[], atOnce = 3) => tell({ runs, atOnce, setUp: true }),
  };
}

afterEach(() => localStorage.clear());

describe('useClaudeRuns', () => {
  it('follows the runs the app says it has, and shows the one the user started', async () => {
    const { api, tell } = fakeApi(async () => 'run-2');
    const { result } = renderHook(() => useClaudeRuns(api));
    act(() => tell([view('run-1', 'working')]));
    expect(result.current.selected?.id).toBe('run-1');
    act(() => result.current.start(TASK));
    expect(api.startClaude).toHaveBeenCalledWith(TASK);
    act(() => tell([view('run-1', 'working'), view('run-2', 'starting')]));
    await waitFor(() => expect(result.current.selected?.id).toBe('run-2'));
    // The user can show another.
    act(() => result.current.select('run-1'));
    expect(result.current.selected?.id).toBe('run-1');
  });

  it('runs a task with Claude’s work folded away, and Claude with no task with it in view', () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => useClaudeRuns(api));
    act(() => result.current.start(TASK));
    expect(result.current.open).toBe(false);
    act(() => result.current.start());
    // Claude with nothing to do waits for the user to type, which only the terminal takes.
    expect(result.current.open).toBe(true);
  });

  it('keeps the user’s choice to see Claude’s work for the next task', () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => useClaudeRuns(api));
    act(() => result.current.showWork(true));
    act(() => result.current.start(TASK));
    expect(result.current.open).toBe(true);
    act(() => result.current.showWork(false));
    act(() => result.current.start(TASK));
    expect(result.current.open).toBe(false);
    // Shown for what only the terminal takes, it's no choice of the user's.
    act(() => result.current.show('run-1'));
    act(() => result.current.start(TASK));
    expect(result.current.open).toBe(false);
  });

  it('closes a tab, and shows the one beside it', () => {
    const { api, tell } = fakeApi();
    const { result } = renderHook(() => useClaudeRuns(api));
    act(() => tell([view('run-1', 'done'), view('run-2', 'working'), view('run-3', 'in-line')]));
    act(() => result.current.select('run-2'));
    act(() => result.current.close('run-2'));
    expect(api.closeRun).toHaveBeenCalledWith('run-2');
    act(() => tell([view('run-1', 'done'), view('run-3', 'in-line')]));
    expect(result.current.selected?.id).toBe('run-3');
    act(() => result.current.close('run-3'));
    act(() => tell([view('run-1', 'done')]));
    expect(result.current.selected?.id).toBe('run-1');
  });

  it('shows a start the app refused as a tab of its own, which closes in the window', async () => {
    const { api } = fakeApi(async () => {
      throw new Error('Refused a request to start Claude.');
    });
    const { result } = renderHook(() => useClaudeRuns(api));
    act(() => result.current.start(TASK));
    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    expect(result.current.selected).toMatchObject({ phase: 'failed', problem: 'failed' });
    act(() => result.current.close(result.current.selected?.id ?? ''));
    expect(result.current.runs).toEqual([]);
    expect(api.closeRun).not.toHaveBeenCalled();
  });

  it('starts a run the app asks for in the background, leaving the tab and work shown', async () => {
    const { api, tell } = fakeApi(async () => 'run-2');
    const { result } = renderHook(() => useClaudeRuns(api));
    act(() => tell([view('run-1', 'working')]));
    act(() => result.current.showWork(true));
    act(() => result.current.start(TASK, { background: true }));
    act(() => tell([view('run-1', 'working'), view('run-2', 'starting')]));
    await waitFor(() => expect(api.startClaude).toHaveBeenCalled());
    expect(result.current.selected?.id).toBe('run-1');
    expect(result.current.open).toBe(true);
  });

  it('brings forward a run at one of Claude Code’s own screens, with its work open', () => {
    const { api, tell } = fakeApi();
    const { result } = renderHook(() => useClaudeRuns(api));
    act(() => tell([view('run-1', 'starting'), view('run-2', 'in-line')]));
    act(() => result.current.select('run-2'));
    act(() => tell([{ ...view('run-1', 'starting'), screen: 'trust' }, view('run-2', 'in-line')]));
    expect(result.current.selected?.id).toBe('run-1');
    expect(result.current.open).toBe(true);
    // The user can go elsewhere while it still shows: it comes forward only as a screen comes.
    act(() => result.current.select('run-2'));
    act(() => tell([{ ...view('run-1', 'starting'), screen: 'trust' }, view('run-2', 'in-line')]));
    expect(result.current.selected?.id).toBe('run-2');
  });

  it('stops and replies to the run they’re for', () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => useClaudeRuns(api));
    act(() => result.current.stop('run-2'));
    act(() => result.current.reply('run-1', 'Classic'));
    expect(api.stopClaude).toHaveBeenCalledWith('run-2');
    expect(api.replyToClaude).toHaveBeenCalledWith('run-1', 'Classic');
  });

  it('picks up the runs going before the window listened', async () => {
    const { api } = fakeApi();
    api.claudeRuns.mockResolvedValueOnce({
      runs: [view('run-4', 'working')],
      atOnce: 2,
      setUp: true,
    });
    const { result } = renderHook(() => useClaudeRuns(api));
    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    expect(result.current.atOnce).toBe(2);
  });
});

describe('whether a task starts now', () => {
  it('waits while a run is still getting past Claude Code’s first screens', () => {
    const other: RunTask = { skill: 'analyze-job', jobId: 'globex--pm' };
    const starting = [view('run-1', 'starting', other)];
    expect(startsNow({ runs: starting, atOnce: 3, setUp: false }, TASK)).toBe(false);
    expect(startsNow({ runs: starting, atOnce: 3, setUp: true }, TASK)).toBe(true);
    expect(startsNow({ runs: [], atOnce: 3, setUp: false }, TASK)).toBe(true);
  });

  it('starts while fewer run than may, and nothing else is on its job', () => {
    const other: RunTask = { skill: 'analyze-job', jobId: 'globex--pm' };
    const runs = (phases: RunPhase[], task: RunTask = other) =>
      phases.map((phase, at) => view(`run-${at}`, phase, task));
    expect(startsNow({ runs: runs(['working', 'done']), atOnce: 2, setUp: true }, TASK)).toBe(true);
    expect(
      startsNow({ runs: runs(['working', 'needs-answer']), atOnce: 2, setUp: true }, TASK),
    ).toBe(false);
    expect(
      startsNow(
        { runs: runs(['working'], { ...TASK, skill: 'cover-letter' }), atOnce: 3, setUp: true },
        TASK,
      ),
    ).toBe(false);
    expect(startsNow({ runs: runs(['in-line'], TASK), atOnce: 3, setUp: true }, TASK)).toBe(false);
    expect(startsNow({ runs: runs(['done'], TASK), atOnce: 3, setUp: true }, TASK)).toBe(true);
  });

  it('counts no run Claude started on its own, which steps aside', () => {
    const own: RunTask = { skill: 'analyze-job', jobIds: ['acme--staff-engineer'], auto: true };
    const picked: RunTask = { skill: 'analyze-job', jobIds: ['acme--staff-engineer'] };
    const going = (task: RunTask) => [view('run-1', 'working', task)];
    expect(startsNow({ runs: going(own), atOnce: 1, setUp: true }, TASK)).toBe(true);
    // One the user started on several jobs holds each of them, and its turn.
    expect(startsNow({ runs: going(picked), atOnce: 3, setUp: true }, TASK)).toBe(false);
  });
});
