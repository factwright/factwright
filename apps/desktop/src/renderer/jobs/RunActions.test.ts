import { describe, expect, it, vi } from 'vitest';
import type { RunPhase } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { isSameRun, requestedRun, runControlsFor, runState } from './RunActions.tsx';

const RESUME: RunTask = { skill: 'focused-resume', jobId: 'acme--staff' };
const LETTER: RunTask = { skill: 'cover-letter', jobId: 'acme--staff' };
const GLOBEX: RunTask = { skill: 'fit-check', jobId: 'globex--pm' };

const runs = (...each: [RunTask, RunPhase][]) =>
  each.map(([task, phase], at) => ({ id: `run-${at + 1}`, task, phase }));

describe('a run the app asks for, as for drafts of a form’s questions', () => {
  it('starts once Claude Code is ready, when it can start without waiting in line', () => {
    expect(requestedRun(true, true)).toBe('started');
    expect(requestedRun(true, false)).toBe('busy');
    expect(requestedRun(false, true)).toBe('not-ready');
  });
});

describe('the job panel’s run controls', () => {
  it('says a task is running, or in line, and nothing of runs that are over', () => {
    const controls = runControlsFor(
      runs([RESUME, 'working'], [LETTER, 'in-line'], [GLOBEX, 'done']),
      vi.fn(),
      vi.fn(),
    );
    expect(controls.stateOf(RESUME)).toBe('running');
    // A quick resume is the job's tailored resume, made another way.
    expect(controls.stateOf({ ...RESUME, quick: true })).toBe('running');
    expect(controls.stateOf(LETTER)).toBe('in-line');
    expect(controls.stateOf(GLOBEX)).toBeNull();
    expect(controls.tasksOn('acme--staff')).toEqual([
      { task: RESUME, state: 'running' },
      { task: LETTER, state: 'in-line' },
    ]);
    expect(controls.tasksOn('globex--pm')).toEqual([]);
  });

  it('shows a task’s tab: the run going for it, or the last one there was', () => {
    const show = vi.fn();
    const controls = runControlsFor(runs([GLOBEX, 'done'], [RESUME, 'working']), vi.fn(), show);
    controls.show(RESUME);
    controls.show(GLOBEX);
    controls.show(LETTER);
    expect(show.mock.calls).toEqual([['run-2'], ['run-1'], [undefined]]);
  });

  it('tells a call’s practice from its prep', () => {
    const prep: RunTask = { skill: 'interview-prep', jobId: 'acme--staff', callId: 'c1' };
    expect(isSameRun(prep, { ...prep, practice: true })).toBe(false);
    expect(isSameRun(prep, { ...prep })).toBe(true);
  });
});

describe('where a task stands for its button', () => {
  it('waits only until Claude Code is ready, whatever runs on other jobs', () => {
    const controls = runControlsFor(runs([GLOBEX, 'working']), vi.fn(), vi.fn());
    expect(runState(controls, RESUME)).toEqual({ running: false, inLine: false, disabled: false });
    expect(runState(undefined, RESUME).disabled).toBe(true);
  });

  it('keeps a task that changes the job’s files first waiting while the job has another', () => {
    const controls = runControlsFor(runs([LETTER, 'working']), vi.fn(), vi.fn());
    const again: RunTask = { ...RESUME, again: true };
    expect(runState(controls, again, true).disabled).toBe(true);
    expect(runState(controls, again).disabled).toBe(false);
    const elsewhere = runControlsFor(runs([GLOBEX, 'in-line']), vi.fn(), vi.fn());
    expect(runState(elsewhere, again, true).disabled).toBe(false);
  });
});
