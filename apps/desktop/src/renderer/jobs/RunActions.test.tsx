// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunTask } from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import { RunActions, type RunControls } from './RunActions.tsx';
import { sampleJob } from './sample-jobs.ts';

afterEach(cleanup);

const job = sampleJob({ id: 'acme--staff-engineer', company: 'Acme', role: 'Staff Engineer' });

function controls(phase: RunPhase = 'idle', task: RunTask | null = null): RunControls {
  return { phase, task, start: vi.fn(), show: vi.fn() };
}

const action = (name: RegExp) => screen.getByRole('button', { name });

describe('RunActions', () => {
  it('offers each skill, with what it does, and suggests the next step', async () => {
    const { container } = render(<RunActions job={job} status="new" run={controls()} />);
    expect(screen.getByRole('heading', { name: 'Run with your Claude' })).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Tailored resumeA resume for this job, every line traced to a factRun',
      'Fit checkScore the job against your fact bankRun',
      'Salary checkEstimate the pay when the posting doesn’t sayRun',
      'Who to messagePeople worth contacting, with drafts you sendRun',
      'Interview prepA prep sheet for a call or an interviewRun',
      'Application questionsAnswers to the form, in your own voiceRun',
    ]);
    expect(action(/Fit check/).className).toMatch(/suggested/);
    expect(action(/Tailored resume/).className).not.toMatch(/suggested/);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('starts a skill on this job', async () => {
    const run = controls();
    render(<RunActions job={job} status="checked" run={run} />);
    expect(action(/Tailored resume/).className).toMatch(/suggested/);
    await userEvent.click(action(/Interview prep/));
    expect(run.start).toHaveBeenCalledWith({
      skill: 'interview-prep',
      jobId: 'acme--staff-engineer',
    });
  });

  it('says what ran before: a fit check, a resume ready', () => {
    const checked = { ...job, fit: { verdict: 'Good', score: 70, date: '2026-10-07' } };
    const withResume = {
      ...checked,
      files: [
        {
          path: 'applications/a/r.pdf',
          name: 'r.pdf',
          format: 'pdf' as const,
          size: 1,
          modified: '',
        },
      ],
    };
    render(<RunActions job={withResume} status="resume" run={controls()} />);
    expect(action(/Fit check/).textContent).toMatch(/Ran$/);
    expect(action(/Tailored resume/).textContent).toMatch(/Ready$/);
  });

  it('holds the other skills while one runs, and brings back the running one', async () => {
    const run = controls('working', { skill: 'salary-check', jobId: job.id });
    render(<RunActions job={job} status="new" run={run} />);
    expect(action(/Salary check/).textContent).toMatch(/Running$/);
    expect((action(/Fit check/) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(action(/Salary check/));
    expect(run.show).toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
  });

  it('marks the skill that just finished, and lets the next one start', () => {
    render(
      <RunActions
        job={job}
        status="new"
        run={controls('done', { skill: 'salary-check', jobId: job.id })}
      />,
    );
    expect(action(/Salary check/).textContent).toMatch(/Done$/);
    expect((action(/Fit check/) as HTMLButtonElement).disabled).toBe(false);
  });

  it('only follows runs on this job', () => {
    render(
      <RunActions
        job={job}
        status="new"
        run={controls('working', { skill: 'salary-check', jobId: 'other--job' })}
      />,
    );
    expect(action(/Salary check/).textContent).toMatch(/Run$/);
    expect((action(/Salary check/) as HTMLButtonElement).disabled).toBe(true);
  });
});
