// @vitest-environment jsdom
import { addDays, type Call, type Job, localDate } from '@factwright/core';
import { cleanup, render, screen, within } from '@testing-library/react';
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

const call = (fields: Partial<Call>): Call => ({
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
  ...fields,
});

/** The box for a job, with Claude's panel, or null for none while Claude Code isn't ready. */
function shown(each: Job, run: RunControls | null = controls(), api?: FactwrightApi) {
  const stub =
    api ??
    ({ updateJob: vi.fn(async () => ({ ok: true as const })) } as unknown as FactwrightApi & {
      updateJob: Mock<FactwrightApi['updateJob']>;
    });
  const onMove = vi.fn();
  const row = jobRows([each], TODAY)[0];
  if (!row) throw new Error('No row');
  // A job to sort has its moves here, as the panel works it out.
  const { status, backFromLater } = row.progress;
  const sorting = status === 'new' || status === 'review' || (status === 'later' && backFromLater);
  const view = render(
    <UpNext row={row} api={stub} run={run ?? undefined} sorting={sorting} onMove={onMove} />,
  );
  return { ...view, api: stub as FactwrightApi & { updateJob: Mock }, onMove };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('UpNext', () => {
  it('says the next step on its button, and starts Claude on the ones Claude does', async () => {
    const run = controls();
    const { container } = shown(toApply, run);
    const box = screen.getByRole('region', { name: 'Up next' });
    // The button says it all, so the step isn't said twice.
    expect(box.textContent).toBe('Up nextTailor a resume');
    await userEvent.click(button('Tailor a resume'));
    expect(run.start).toHaveBeenCalledWith({ skill: 'focused-resume', jobId: job.id });
    expect((await axe.run(container)).violations).toEqual([]);
    cleanup();
    const fresh = controls();
    shown(job, fresh);
    await userEvent.click(button('Run a fit check'));
    expect(fresh.start).toHaveBeenCalledWith({ skill: 'fit-check', jobId: job.id });
  });

  it('sorts a new job, with the move the step suggests first', async () => {
    const { onMove } = shown(job);
    const moves = screen.getByRole('group', { name: 'Sort this job' });
    expect(
      within(moves)
        .getAllByRole('button')
        .map((each) => each.textContent),
    ).toEqual(['To review', 'To apply', 'Later', 'Pass']);
    await userEvent.click(within(moves).getByRole('button', { name: 'Later' }));
    expect(onMove).toHaveBeenCalledWith('later');
    cleanup();
    // Checked, it's to apply or pass, and a fit check that says skip suggests passing.
    const checked = { ...job, status: 'review' as const, statusOn: TODAY };
    const good = { ...checked, fit: { verdict: 'Good', score: 70, date: TODAY } };
    shown(good);
    expect(screen.getByText('Apply or pass?')).toBeTruthy();
    expect(button('To apply').className).toMatch(/primary/);
    cleanup();
    const skip = { ...checked, fit: { verdict: 'Skip: on-site', score: 30, date: TODAY } };
    shown(skip);
    expect(screen.getByText('Fit check says skip. Pass?')).toBeTruthy();
    expect(button('Pass').className).toMatch(/primary/);
    expect(button('To apply').className).not.toMatch(/primary/);
  });

  it('writes the cover letter once the resume is ready, then a Projects page, when asked for', async () => {
    const asks = { ...toApply, files: [resume], apply: 'Send a cover letter and a portfolio.' };
    const run = controls();
    shown(asks, run);
    expect(screen.getByText('The posting asks for a cover letter')).toBeTruthy();
    await userEvent.click(button('Write the cover letter'));
    expect(run.start).toHaveBeenCalledWith({ skill: 'cover-letter', jobId: job.id });
    cleanup();
    const next = controls();
    shown({ ...asks, letters: [resume] }, next);
    expect(screen.getByText('The posting asks for samples of your work')).toBeTruthy();
    await userEvent.click(button('Make a Projects page'));
    expect(next.start).toHaveBeenCalledWith({ skill: 'projects-page', jobId: job.id });
  });

  it('marks a job ready to apply as applied', async () => {
    const { onMove } = shown({ ...toApply, files: [resume] });
    expect(screen.getByText('Ready to apply')).toBeTruthy();
    await userEvent.click(button('Mark as applied'));
    expect(onMove).toHaveBeenCalledWith('applied');
  });

  it('adds a call once the user has applied, and finds people to message when it’s quiet', async () => {
    const asked = vi.fn();
    window.addEventListener('factwright:add-call', asked);
    try {
      shown({ ...job, status: 'applied', statusOn: TODAY, appliedOn: TODAY });
      expect(screen.getByText('Applied today')).toBeTruthy();
      await userEvent.click(button('Add a call'));
      expect(asked).toHaveBeenCalled();
    } finally {
      window.removeEventListener('factwright:add-call', asked);
    }
    cleanup();
    const quiet = { ...job, status: 'applied' as const, statusOn: addDays(TODAY, -12) };
    const run = controls();
    const { onMove } = shown(quiet, run);
    expect(screen.getByText('Applied 12 days ago. Follow up?')).toBeTruthy();
    await userEvent.click(button('Find people to message'));
    expect(run.start).toHaveBeenCalledWith({ skill: 'who-to-message', jobId: job.id });
    await userEvent.click(button('Mark no reply'));
    expect(onMove).toHaveBeenCalledWith('ghosted');
  });

  it('preps for the call coming up, practices, then drafts thank-you notes after it', async () => {
    const run = controls();
    const booked = { ...job, status: 'screen' as const, statusOn: TODAY, calls: [call({})] };
    shown(booked, run);
    expect(screen.getByText(/^Prep for the recruiter screen tomorrow/)).toBeTruthy();
    await userEvent.click(button('Prep for the call'));
    expect(run.start).toHaveBeenCalledWith({
      skill: 'interview-prep',
      jobId: job.id,
      callId: 'screen-1',
    });
    cleanup();
    const prep = { callId: 'screen-1', kind: 'prep' as const, path: 'p', modified: '' };
    const practice = controls();
    shown({ ...booked, callDocs: [prep] }, practice);
    expect(screen.getByText(/^Recruiter screen tomorrow/)).toBeTruthy();
    await userEvent.click(button('Practice for the call'));
    expect(practice.start).toHaveBeenCalledWith({
      skill: 'interview-prep',
      jobId: job.id,
      callId: 'screen-1',
      practice: true,
    });
    cleanup();
    const had = call({ onDate: addDays(TODAY, -1), state: 'done', outcome: 'advanced' });
    const after = controls();
    shown({ ...job, status: 'screen', statusOn: TODAY, calls: [had] }, after);
    expect(screen.getByText('Send thank-you notes for the recruiter screen')).toBeTruthy();
    await userEvent.click(button('Draft thank-you notes'));
    expect(after.start).toHaveBeenCalledWith({
      skill: 'thank-you',
      jobId: job.id,
      callId: 'screen-1',
    });
  });

  it('says Claude is on the step while it runs, and waits while Claude does another', () => {
    shown(toApply, controls('working', { skill: 'focused-resume', jobId: job.id }));
    // The step still says what it is.
    expect(screen.getByRole('region', { name: 'Up next' }).textContent).toBe(
      'Up nextTailor a resumeClaude is on it',
    );
    expect(screen.queryByRole('button', { name: 'Tailor a resume' })).toBeNull();
    cleanup();
    shown(toApply, controls('working', { skill: 'salary-check', jobId: 'other--job' }));
    expect((button('Tailor a resume') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    // Before Claude Code is ready, it says where to look.
    shown(toApply, null);
    expect((button('Tailor a resume') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/The card in the sidebar says what to do/)).toBeTruthy();
  });

  it('accepts or declines an offer', async () => {
    const { onMove } = shown({ ...job, status: 'offer', statusOn: TODAY });
    expect(screen.getByText('Decide on the offer')).toBeTruthy();
    await userEvent.click(button('Accept'));
    expect(onMove).toHaveBeenCalledWith('accepted');
    await userEvent.click(button('Decline'));
    expect(onMove).toHaveBeenCalledWith('declined');
  });

  it('clears the user’s reminder once it’s done, and says when that fails', async () => {
    const due = { ...job, nextAction: 'Email Sam', nextOn: addDays(TODAY, -1) };
    const { api } = shown(due);
    expect(screen.getByText('Overdue: Email Sam')).toBeTruthy();
    await userEvent.click(button('Done: clear the reminder'));
    expect(api.updateJob).toHaveBeenCalledWith(job.id, { nextAction: null, nextOn: null });
    api.updateJob.mockResolvedValueOnce({
      ok: false,
      message: 'That job isn’t in your tracker anymore.',
    });
    await userEvent.click(button('Done: clear the reminder'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That job isn’t in your tracker anymore.',
    );
  });

  it('opens Calls and interviews to say how a call went', async () => {
    const asked = vi.fn();
    window.addEventListener('factwright:show-section', asked);
    try {
      shown({
        ...job,
        status: 'screen',
        statusOn: TODAY,
        calls: [call({ onDate: addDays(TODAY, -1) })],
      });
      await userEvent.click(button('Say how it went'));
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
