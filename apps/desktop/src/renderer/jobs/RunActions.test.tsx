// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
function apiStub() {
  return {
    platform: 'darwin',
    updateJob: vi.fn(async () => ({ ok: true }) as const),
    jobExtras: vi.fn(async () => ({ asked: {}, shots: [], posting: null })),
    readShot: vi.fn(async () => null),
    addShot: vi.fn(async (jobId: string) => ({
      ok: true as const,
      path: `screenshots/${jobId}/form-2026-10-12-1.png`,
    })),
    removeShot: vi.fn(async () => ({ ok: true }) as const),
  } as unknown as FactwrightApi & {
    updateJob: Mock<FactwrightApi['updateJob']>;
    addShot: Mock<FactwrightApi['addShot']>;
    removeShot: Mock<FactwrightApi['removeShot']>;
  };
}

/** A picture pasted into the window, as the system's clipboard gives it. */
function paste(file: File) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      getData: () => '',
    },
  });
  window.dispatchEvent(event);
  return event;
}

const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])], 'image.png', {
  type: 'image/png',
});

const job = sampleJob({ id: 'acme--staff-engineer', company: 'Acme', role: 'Staff Engineer' });

function controls(phase: RunPhase = 'idle', task: RunTask | null = null): RunControls {
  return { phase, task, start: vi.fn(), show: vi.fn() };
}

const action = (name: RegExp) => screen.getByRole('button', { name });

describe('RunActions for a job with calls', () => {
  it('leaves Interview prep alone while Claude preps for one of the job’s calls', () => {
    const task: RunTask = { skill: 'interview-prep', jobId: job.id, callId: 'call-1' };
    render(<RunActions job={job} run={controls('working', task)} api={apiStub()} />);
    const prep = screen.getByRole('button', { name: /^Interview prep/ });
    expect(prep.textContent).not.toContain('running');
    expect((prep as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('RunActions', () => {
  const resume = {
    path: 'applications/a/r.pdf',
    name: 'r.pdf',
    format: 'pdf' as const,
    size: 1,
    modified: '',
  };

  it('offers every skill in one row, then a question, with what each does on hover', async () => {
    const { container } = render(<RunActions job={job} run={controls()} api={apiStub()} />);
    const row = screen.getByRole('group', { name: 'Run with your Claude' });
    expect(
      within(row)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Tailored resume',
      'Cover letter',
      'Projects page',
      'Fit check',
      'Salary check',
      'Who to message',
      'Interview prep',
      'Application questions',
      'Ask a question',
    ]);
    await userEvent.hover(action(/^Tailored resume/));
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'A resume for this job, every line traced to a fact',
    );
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('starts a skill on this job', async () => {
    const run = controls();
    render(<RunActions job={job} run={run} api={apiStub()} />);
    await userEvent.click(action(/^Interview prep/));
    expect(run.start).toHaveBeenCalledWith({
      skill: 'interview-prep',
      jobId: 'acme--staff-engineer',
    });
    await userEvent.click(action(/^Cover letter/));
    expect(run.start).toHaveBeenLastCalledWith({ skill: 'cover-letter', jobId: job.id });
  });

  it('says what ran before: a fit check, a resume ready', () => {
    const checked = { ...job, fit: { verdict: 'Good', score: 70, date: '2026-10-07' } };
    const withResume = { ...checked, files: [resume] };
    render(<RunActions job={withResume} run={controls()} api={apiStub()} />);
    expect(action(/^Fit check/).textContent).toBe('Fit check, ran before');
    expect(action(/^Tailored resume/).textContent).toBe('Tailored resume, ready');
    expect(action(/^Cover letter/).textContent).toBe('Cover letter');
    cleanup();
    const withLetter = { ...withResume, letters: withResume.files, projectPages: [resume] };
    render(<RunActions job={withLetter} run={controls()} api={apiStub()} />);
    expect(action(/^Cover letter/).textContent).toBe('Cover letter, ready');
    expect(action(/^Projects page/).textContent).toBe('Projects page, ready');
    cleanup();
    const answered = { ...job, docKinds: ['answers' as const] };
    render(<RunActions job={answered} run={controls()} api={apiStub()} />);
    expect(action(/^Application questions/).textContent).toBe('Application questions, ran before');
  });

  it('holds the other skills while one runs, and brings back the running one', async () => {
    const run = controls('working', { skill: 'salary-check', jobId: job.id });
    render(<RunActions job={job} run={run} api={apiStub()} />);
    expect(action(/^Salary check/).textContent).toBe('Salary check, running');
    expect((action(/^Fit check/) as HTMLButtonElement).disabled).toBe(true);
    expect((action(/^Ask a question/) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(action(/^Salary check/));
    expect(run.show).toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
  });

  it('marks the skill that just finished, and lets the next one start', () => {
    render(
      <RunActions
        job={job}
        run={controls('done', { skill: 'salary-check', jobId: job.id })}
        api={apiStub()}
      />,
    );
    expect(action(/^Salary check/).textContent).toBe('Salary check, done');
    expect((action(/^Fit check/) as HTMLButtonElement).disabled).toBe(false);
  });

  it('only follows runs on this job', () => {
    render(
      <RunActions
        job={job}
        run={controls('working', { skill: 'salary-check', jobId: 'other--job' })}
        api={apiStub()}
      />,
    );
    expect(action(/^Salary check/).textContent).toBe('Salary check');
    expect((action(/^Salary check/) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks Claude about the job, and brings back the run answering it', async () => {
    const run = controls();
    const api = Object.assign(apiStub(), {
      askAboutJob: vi.fn(async () => ({ ok: true as const, askId: '2026-10-12-1' })),
    });
    render(<RunActions job={job} run={run} api={api} />);
    await userEvent.click(action(/^Ask a question/));
    const dialog = screen.getByRole('dialog', { name: 'Ask about Acme' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Your question' }),
      'What’s the team like?',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask Claude' }));
    expect(api.askAboutJob).toHaveBeenCalledWith(job.id, 'What’s the team like?');
    expect(run.start).toHaveBeenCalledWith({ skill: 'ask', jobId: job.id, askId: '2026-10-12-1' });
    cleanup();
    const answering = controls('working', { skill: 'ask', jobId: job.id, askId: '2026-10-12-1' });
    render(<RunActions job={job} run={answering} api={apiStub()} />);
    expect(action(/^Ask a question/).textContent).toBe('Ask a question, running');
    await userEvent.click(action(/^Ask a question/));
    expect(answering.show).toHaveBeenCalled();
  });
});

describe('the application questions', () => {
  const open = async (on = job) => {
    const run = controls();
    const api = apiStub();
    render(<RunActions job={on} run={run} api={api} />);
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

  it('needs at least one question, or a screenshot of them', async () => {
    const { run, api } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Answer with Claude' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Paste at least one question, or a screenshot of them, first.',
    );
    expect(api.updateJob).not.toHaveBeenCalled();
    expect(run.start).not.toHaveBeenCalled();
  });

  it('takes screenshots of the form, kept with the job the moment they’re added', async () => {
    const { run, api, dialog } = await open();
    expect(paste(PNG).defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(api.addShot).toHaveBeenCalledWith(
        job.id,
        { name: 'image.png', bytes: expect.any(Uint8Array) },
        { kind: 'form' },
      ),
    );
    expect(await screen.findByRole('img', { name: 'Screenshot 1' })).toBeTruthy();
    expect((await axe.run(dialog)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Answer with Claude' }));
    expect(run.start).toHaveBeenCalledWith({ skill: 'answer-questions', jobId: job.id });
  });

  it('takes pasted text as text, even when a picture of it comes along', async () => {
    const { api } = await open();
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => PNG }],
        getData: (type: string) => (type === 'text/plain' ? 'Why Acme?' : ''),
      },
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(api.addShot).not.toHaveBeenCalled();
  });

  it('removes a screenshot, and says why one wasn’t kept', async () => {
    const { api } = await open();
    paste(PNG);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove screenshot 1' }));
    expect(api.removeShot).toHaveBeenCalledWith(`screenshots/${job.id}/form-2026-10-12-1.png`);
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    api.addShot.mockResolvedValueOnce({ ok: false, message: 'image.png is empty.' });
    paste(PNG);
    expect((await screen.findByRole('alert')).textContent).toBe('image.png is empty.');
  });

  it('shows screenshots of the form added before', async () => {
    const run = controls();
    const api = apiStub();
    const path = `screenshots/${job.id}/form-2026-10-11-1.png`;
    vi.mocked(api.jobExtras).mockResolvedValue({
      asked: {},
      posting: null,
      calls: {},
      shots: [
        { path, name: 'form-2026-10-11-1.png', kind: 'form', ask: null, size: 8, modified: '' },
      ],
    });
    vi.mocked(api.readShot).mockResolvedValue(new Uint8Array([1, 2, 3]));
    render(<RunActions job={job} run={run} api={api} />);
    await userEvent.click(action(/Application questions/));
    const picture = (await screen.findByRole('img', { name: 'Screenshot 1' })) as HTMLImageElement;
    expect(picture.src).toBe('data:image/png;base64,AQID');
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
