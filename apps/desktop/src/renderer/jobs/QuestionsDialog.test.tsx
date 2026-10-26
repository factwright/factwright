// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi, RunPhase } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { ApplicationSection } from './ApplicationSection.tsx';
import { type RunControls, runControlsFor } from './RunActions.tsx';
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
    jobExtras: vi.fn(async () => ({ asked: {}, shots: [], posting: null, outreach: [] })),
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

/** The job panel's run controls, with a run of a task in a phase, or none. */
function controls(phase: RunPhase | null = null, task: RunTask | null = null): RunControls {
  const runs = phase && task ? [{ id: 'run-1', task, phase }] : [];
  return { ...runControlsFor(runs, vi.fn(), vi.fn()), show: vi.fn() };
}

const action = (name: RegExp) => screen.getByRole('button', { name });

describe('the application questions', () => {
  const open = async (on = job) => {
    const run = controls();
    const api = apiStub();
    render(<ApplicationSection job={on} api={api} today="2026-10-12" run={run} />);
    await userEvent.click(action(/^(Answer the questions|Add questions)$/));
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
      form: null,
      calls: {},
      outreach: [],
      versions: [],
      shots: [
        { path, name: 'form-2026-10-11-1.png', kind: 'form', ask: null, size: 8, modified: '' },
      ],
    });
    vi.mocked(api.readShot).mockResolvedValue(new Uint8Array([1, 2, 3]));
    render(<ApplicationSection job={job} api={api} today="2026-10-12" run={run} />);
    await userEvent.click(action(/^Answer the questions$/));
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
