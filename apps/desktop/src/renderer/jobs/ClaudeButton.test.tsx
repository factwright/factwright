// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunPhase } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { ClaudeButton } from './ClaudeButton.tsx';
import { type RunControls, runControlsFor } from './RunActions.tsx';
import { sampleJob } from './sample-jobs.ts';

afterEach(cleanup);

const job = sampleJob({ id: 'acme--staff-engineer', company: 'Acme', role: 'Staff Engineer' });

/** The job panel's run controls, with a run of a task in a phase, or none. */
function controls(phase: RunPhase | null = null, task: RunTask | null = null): RunControls {
  const runs = phase && task ? [{ id: 'run-1', task, phase }] : [];
  return { ...runControlsFor(runs, vi.fn(), vi.fn()), show: vi.fn() };
}

const action = (name: RegExp) => screen.getByRole('button', { name });

describe('ClaudeButton', () => {
  const fit: RunTask = { skill: 'analyze-job', jobId: job.id };

  it('starts Claude on its task', async () => {
    const run = controls();
    const { container } = render(<ClaudeButton run={run} task={fit} label="Analyze job" />);
    await userEvent.click(screen.getByRole('button', { name: 'Analyze job' }));
    expect(run.start).toHaveBeenCalledWith(fit);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('says Claude is on it while its task runs, or that it’s in line, and starts beside another', () => {
    render(<ClaudeButton run={controls('working', fit)} task={fit} label="Analyze job" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Claude is on it')).toBeTruthy();
    cleanup();
    render(<ClaudeButton run={controls('in-line', fit)} task={fit} label="Analyze job" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('In line')).toBeTruthy();
    cleanup();
    // Clicked while Claude does another task on the job, it waits in line for it.
    const salary: RunTask = { skill: 'salary-check', jobId: job.id };
    render(<ClaudeButton run={controls('working', salary)} task={fit} label="Analyze job" />);
    expect(action(/^Analyze job$/).hasAttribute('disabled')).toBe(false);
    cleanup();
    render(<ClaudeButton run={controls('done', fit)} task={fit} label="Analyze job" />);
    expect(action(/^Analyze job$/).hasAttribute('disabled')).toBe(false);
  });

  it('waits for the job’s other tasks when it changes the job’s files first', () => {
    const salary: RunTask = { skill: 'salary-check', jobId: job.id };
    const again: RunTask = { skill: 'focused-resume', jobId: job.id, again: true };
    render(
      <ClaudeButton run={controls('working', salary)} task={again} label="New version" alone />,
    );
    expect(action(/^New version$/).hasAttribute('disabled')).toBe(true);
  });

  it('waits until Claude Code is ready', () => {
    render(<ClaudeButton run={undefined} task={fit} label="Analyze job" />);
    expect(action(/^Analyze job$/).hasAttribute('disabled')).toBe(true);
  });

  it('follows its own job and call only', () => {
    const other: RunTask = { skill: 'analyze-job', jobId: 'other--job' };
    render(<ClaudeButton run={controls('working', other)} task={fit} label="Analyze job" />);
    expect(action(/^Analyze job$/).hasAttribute('disabled')).toBe(false);
    cleanup();
    // Prep for one of the job's calls isn't the job's own Interview prep.
    const call: RunTask = { skill: 'interview-prep', jobId: job.id, callId: 'call-1' };
    const prep: RunTask = { skill: 'interview-prep', jobId: job.id };
    render(<ClaudeButton run={controls('working', call)} task={prep} label="Interview prep" />);
    expect(action(/^Interview prep$/)).toBeTruthy();
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
