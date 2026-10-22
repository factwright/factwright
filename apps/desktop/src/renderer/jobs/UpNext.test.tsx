// @vitest-environment jsdom
import { addDays, type Call, type Job, localDate } from '@factwright/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import type { RunControls } from './RunActions.tsx';
import { jobRows } from './rows.ts';
import { sampleJob } from './sample-jobs.ts';
import { UpNext } from './UpNext.tsx';

const TODAY = localDate();

afterEach(cleanup);

const job = sampleJob({ id: 'acme--staff-engineer', company: 'Acme', role: 'Staff Engineer' });
const resume = {
  path: 'applications/acme/AlexRiveraResume_Acme.pdf',
  name: 'AlexRiveraResume_Acme.pdf',
  format: 'pdf' as const,
  size: 1,
  modified: '',
};
const toApply: Job = { ...job, status: 'apply', statusOn: TODAY };

function controls(phase: RunPhase = 'idle', task: RunTask | null = null): RunControls {
  return { phase, task, start: vi.fn(), show: vi.fn() };
}

/** The box for a job, with Claude's panel, or null for none while Claude Code isn't ready. */
function shown(each: Job, run: RunControls | null = controls(), api?: FactwrightApi) {
  const stub =
    api ??
    ({ updateJob: vi.fn(async () => ({ ok: true as const })) } as unknown as FactwrightApi & {
      updateJob: Mock<FactwrightApi['updateJob']>;
    });
  const onApplied = vi.fn();
  const row = jobRows([each], TODAY)[0];
  if (!row) throw new Error('No row');
  const view = render(<UpNext row={row} api={stub} run={run ?? undefined} onApplied={onApplied} />);
  return { ...view, api: stub as FactwrightApi & { updateJob: Mock }, onApplied };
}

const start = () => screen.getByRole('button', { name: 'Start with Claude' });

describe('UpNext', () => {
  it('says the next step in the list’s words, and starts Claude on the ones Claude does', async () => {
    const run = controls();
    const { container } = shown(toApply, run);
    expect(screen.getByRole('region', { name: 'Up next' }).textContent).toContain(
      'Tailor a resume',
    );
    await userEvent.click(start());
    expect(run.start).toHaveBeenCalledWith({ skill: 'focused-resume', jobId: job.id });
    expect((await axe.run(container)).violations).toEqual([]);
    cleanup();
    const fresh = controls();
    shown(job, fresh);
    expect(screen.getByText('Run a fit check')).toBeTruthy();
    await userEvent.click(start());
    expect(fresh.start).toHaveBeenCalledWith({ skill: 'fit-check', jobId: job.id });
  });

  it('starts the cover letter once the resume is ready, then a Projects page, when asked for', async () => {
    const asks = { ...toApply, files: [resume], apply: 'Send a cover letter and a portfolio.' };
    const run = controls();
    shown(asks, run);
    expect(screen.getByText('The posting asks for a cover letter')).toBeTruthy();
    await userEvent.click(start());
    expect(run.start).toHaveBeenCalledWith({ skill: 'cover-letter', jobId: job.id });
    cleanup();
    const next = controls();
    shown({ ...asks, letters: [resume] }, next);
    expect(screen.getByText('The posting asks for samples of your work')).toBeTruthy();
    await userEvent.click(start());
    expect(next.start).toHaveBeenCalledWith({ skill: 'projects-page', jobId: job.id });
  });

  it('preps for the call coming up', async () => {
    const call: Call = {
      id: 'screen-1',
      kind: 'screen',
      onDate: addDays(TODAY, 1),
      atTime: null,
      minutes: null,
      mode: null,
      place: null,
      people: [],
      state: 'scheduled',
      outcome: null,
      notes: null,
      debrief: null,
    };
    const run = controls();
    shown({ ...job, status: 'screen', statusOn: TODAY, calls: [call] }, run);
    expect(screen.getByText(/^Prep for the recruiter screen tomorrow/)).toBeTruthy();
    await userEvent.click(start());
    expect(run.start).toHaveBeenCalledWith({
      skill: 'interview-prep',
      jobId: job.id,
      callId: 'screen-1',
    });
  });

  it('brings back the run doing the step, and waits while Claude does another', async () => {
    const running = controls('working', { skill: 'focused-resume', jobId: job.id });
    shown(toApply, running);
    await userEvent.click(screen.getByRole('button', { name: 'Running… Show Claude' }));
    expect(running.show).toHaveBeenCalled();
    cleanup();
    shown(toApply, controls('working', { skill: 'salary-check', jobId: 'other--job' }));
    expect((start() as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    // Before Claude Code is ready, it says where to look.
    shown(toApply, null);
    expect((start() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/The card in the sidebar says what to do/)).toBeTruthy();
  });

  it('marks a job ready to apply as applied', async () => {
    const { onApplied } = shown({ ...toApply, files: [resume] });
    expect(screen.getByText('Ready to apply')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Mark as applied' }));
    expect(onApplied).toHaveBeenCalled();
  });

  it('clears the user’s reminder once it’s done, and says when that fails', async () => {
    const due = { ...job, nextAction: 'Email Sam', nextOn: addDays(TODAY, -1) };
    const { api } = shown(due);
    expect(screen.getByText('Overdue: Email Sam')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Done: clear the reminder' }));
    expect(api.updateJob).toHaveBeenCalledWith(job.id, { nextAction: null, nextOn: null });
    api.updateJob.mockResolvedValueOnce({
      ok: false,
      message: 'That job isn’t in your tracker anymore.',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Done: clear the reminder' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That job isn’t in your tracker anymore.',
    );
  });

  it('opens Calls and interviews to say how a call went', async () => {
    const past: Call = {
      id: 'screen-1',
      kind: 'screen',
      onDate: addDays(TODAY, -1),
      atTime: null,
      minutes: null,
      mode: null,
      place: null,
      people: [],
      state: 'scheduled',
      outcome: null,
      notes: null,
      debrief: null,
    };
    const asked = vi.fn();
    window.addEventListener('factwright:show-section', asked);
    try {
      shown({ ...job, status: 'screen', statusOn: TODAY, calls: [past] });
      await userEvent.click(screen.getByRole('button', { name: 'Say how it went' }));
      const event = asked.mock.calls[0]?.[0] as CustomEvent | undefined;
      expect(event?.detail).toBe('calls');
    } finally {
      window.removeEventListener('factwright:show-section', asked);
    }
  });

  it('shows nothing when there’s nothing to do', () => {
    const { container } = shown({ ...job, status: 'rejected', statusOn: TODAY });
    expect(container.textContent).toBe('');
  });
});
