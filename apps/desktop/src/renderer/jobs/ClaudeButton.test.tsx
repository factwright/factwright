// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunTask } from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import { ClaudeButton } from './ClaudeButton.tsx';
import type { RunControls } from './RunActions.tsx';
import { sampleJob } from './sample-jobs.ts';

afterEach(cleanup);

const job = sampleJob({ id: 'acme--staff-engineer', company: 'Acme', role: 'Staff Engineer' });

function controls(phase: RunPhase = 'idle', task: RunTask | null = null): RunControls {
  return { phase, task, start: vi.fn(), show: vi.fn() };
}

const action = (name: RegExp) => screen.getByRole('button', { name });

describe('ClaudeButton', () => {
  const fit: RunTask = { skill: 'fit-check', jobId: job.id };

  it('starts Claude on its task', async () => {
    const run = controls();
    const { container } = render(<ClaudeButton run={run} task={fit} label="Run a fit check" />);
    await userEvent.click(screen.getByRole('button', { name: 'Run a fit check' }));
    expect(run.start).toHaveBeenCalledWith(fit);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('says Claude is on it while its task runs, and holds while Claude does another', () => {
    render(<ClaudeButton run={controls('working', fit)} task={fit} label="Run a fit check" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Claude is on it')).toBeTruthy();
    cleanup();
    const salary: RunTask = { skill: 'salary-check', jobId: job.id };
    render(<ClaudeButton run={controls('working', salary)} task={fit} label="Run a fit check" />);
    expect(action(/^Run a fit check$/).hasAttribute('disabled')).toBe(true);
    cleanup();
    render(<ClaudeButton run={controls('done', fit)} task={fit} label="Run a fit check" />);
    expect(action(/^Run a fit check$/).hasAttribute('disabled')).toBe(false);
  });

  it('waits until Claude Code is ready', () => {
    render(<ClaudeButton run={undefined} task={fit} label="Run a fit check" />);
    expect(action(/^Run a fit check$/).hasAttribute('disabled')).toBe(true);
  });

  it('follows its own job and call only', () => {
    const other: RunTask = { skill: 'fit-check', jobId: 'other--job' };
    render(<ClaudeButton run={controls('working', other)} task={fit} label="Run a fit check" />);
    expect(action(/^Run a fit check$/).hasAttribute('disabled')).toBe(true);
    cleanup();
    // Prep for one of the job's calls isn't the job's own Interview prep.
    const call: RunTask = { skill: 'interview-prep', jobId: job.id, callId: 'call-1' };
    const prep: RunTask = { skill: 'interview-prep', jobId: job.id };
    render(<ClaudeButton run={controls('working', call)} task={prep} label="Interview prep" />);
    expect(action(/^Interview prep$/).hasAttribute('disabled')).toBe(true);
  });

  it('starts another way when it asks something first', async () => {
    const run = controls();
    const onStart = vi.fn();
    render(
      <ClaudeButton
        run={run}
        task={{ skill: 'answer-questions', jobId: job.id }}
        label="Answer the questions"
        adds
        onStart={onStart}
      />,
    );
    await userEvent.click(action(/^Answer the questions$/));
    expect(onStart).toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
  });
});
