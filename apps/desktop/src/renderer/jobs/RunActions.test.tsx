// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import { RunActions, type RunControls } from './RunActions.tsx';
import { sampleJob } from './sample-jobs.ts';

beforeAll(() => {
  // jsdom doesn't open dialogs on its own.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(cleanup);

/** The window's API, only as far as the questions need it. */
function apiStub(): FactwrightApi & { updateJob: Mock<FactwrightApi['updateJob']> } {
  return { updateJob: vi.fn(async () => ({ ok: true }) as const) } as unknown as FactwrightApi & {
    updateJob: Mock<FactwrightApi['updateJob']>;
  };
}

const job = sampleJob({ id: 'acme--staff-engineer', company: 'Acme', role: 'Staff Engineer' });

function controls(phase: RunPhase = 'idle', task: RunTask | null = null): RunControls {
  return { phase, task, start: vi.fn(), show: vi.fn() };
}

const action = (name: RegExp) => screen.getByRole('button', { name });

describe('RunActions', () => {
  it('offers each skill, with what it does, and suggests the next step', async () => {
    const { container } = render(
      <RunActions job={job} status="new" run={controls()} api={apiStub()} />,
    );
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
    render(<RunActions job={job} status="checked" run={run} api={apiStub()} />);
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
    render(<RunActions job={withResume} status="resume" run={controls()} api={apiStub()} />);
    expect(action(/Fit check/).textContent).toMatch(/Ran$/);
    expect(action(/Tailored resume/).textContent).toMatch(/Ready$/);
    cleanup();
    const answered = { ...job, docKinds: ['answers' as const] };
    render(<RunActions job={answered} status="new" run={controls()} api={apiStub()} />);
    expect(action(/Application questions/).textContent).toMatch(/Ran$/);
  });

  it('holds the other skills while one runs, and brings back the running one', async () => {
    const run = controls('working', { skill: 'salary-check', jobId: job.id });
    render(<RunActions job={job} status="new" run={run} api={apiStub()} />);
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
        api={apiStub()}
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
        api={apiStub()}
      />,
    );
    expect(action(/Salary check/).textContent).toMatch(/Run$/);
    expect((action(/Salary check/) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the application questions', () => {
  const open = async (on = job) => {
    const run = controls();
    const api = apiStub();
    render(<RunActions job={on} status="checked" run={run} api={api} />);
    await userEvent.click(action(/Application questions/));
    return { run, api, dialog: screen.getByRole('dialog', { name: 'Application questions' }) };
  };
  const box = (n: number) => screen.getByRole('textbox', { name: `Question ${n}` });

  it('asks for the form’s questions, saves them, then has Claude answer them', async () => {
    const { run, api, dialog } = await open();
    expect(run.start).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box(1));
    await userEvent.type(box(1), '  Why do you want to work at Acme?  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));
    expect(document.activeElement).toBe(box(2));
    await userEvent.type(box(2), 'Are you authorized to work in the US?');
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));
    expect((await axe.run(dialog)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Answer with Claude' }));
    expect(api.updateJob).toHaveBeenCalledWith(job.id, {
      questions: ['Why do you want to work at Acme?', 'Are you authorized to work in the US?'],
    });
    expect(run.start).toHaveBeenCalledWith({ skill: 'answer-questions', jobId: job.id });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.updateJob).toHaveBeenCalledTimes(1);
  });

  it('needs at least one question', async () => {
    const { run, api } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Answer with Claude' }));
    expect(screen.getByRole('alert').textContent).toBe('Paste at least one question first.');
    expect(api.updateJob).not.toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
  });

  it('keeps what was pasted when it closes, and shows it again', async () => {
    const { run, api } = await open();
    await userEvent.type(box(1), 'What’s your notice period?');
    await userEvent.click(screen.getByRole('button', { name: 'Save for later' }));
    expect(api.updateJob).toHaveBeenCalledWith(job.id, {
      questions: ['What’s your notice period?'],
    });
    expect(run.start).not.toHaveBeenCalled();
    cleanup();
    const saved = { ...job, questions: ['First question', 'Second question'] };
    const again = await open(saved);
    expect((box(1) as HTMLTextAreaElement).value).toBe('First question');
    expect((box(2) as HTMLTextAreaElement).value).toBe('Second question');
    await userEvent.click(screen.getByRole('button', { name: 'Remove question 1' }));
    expect((box(1) as HTMLTextAreaElement).value).toBe('Second question');
    expect(document.activeElement).toBe(box(1));
    // The dialog's own close button keeps them too.
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(again.api.updateJob).toHaveBeenCalledWith(job.id, { questions: ['Second question'] });
  });

  it('saves nothing when nothing changed, and says when saving fails', async () => {
    const saved = { ...job, questions: ['First question'] };
    const { run, api } = await open(saved);
    await userEvent.click(screen.getByRole('button', { name: 'Save for later' }));
    expect(api.updateJob).not.toHaveBeenCalled();
    cleanup();
    const failing = await open(saved);
    failing.api.updateJob.mockResolvedValue({
      ok: false,
      message: 'That job isn’t in your tracker anymore.',
    });
    await userEvent.type(box(1), '?');
    await userEvent.click(screen.getByRole('button', { name: 'Answer with Claude' }));
    expect(screen.getByRole('alert').textContent).toBe('That job isn’t in your tracker anymore.');
    expect(failing.run.start).not.toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
  });
});
