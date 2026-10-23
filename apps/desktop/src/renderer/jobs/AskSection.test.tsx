// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi, JobExtras } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import type { RunPhase } from '../useClaudeRun.ts';
import { AskDialog, AskSection } from './AskSection.tsx';
import type { RunControls } from './RunActions.tsx';
import { sampleJob } from './sample-jobs.ts';

const TODAY = localDate();

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

const job = sampleJob({ id: 'acme--staff-engineer', company: 'Acme', role: 'Staff Engineer' });
const ASK = { id: '2026-10-12-what-should-i-expect', question: 'What should I expect?', on: TODAY };

function apiStub(
  extras: Omit<JobExtras, 'posting' | 'calls' | 'outreach'> & Partial<JobExtras> = {
    asked: {},
    shots: [],
  },
) {
  return {
    platform: 'darwin',
    jobExtras: vi.fn(async () => ({ posting: null, calls: {}, outreach: [], ...extras })),
    askAboutJob: vi.fn(async () => ({ ok: true as const, askId: '2026-10-12-whats-their-stack' })),
    removeAsk: vi.fn(async () => ({ ok: true }) as const),
    addShot: vi.fn(async () => ({ ok: true as const, path: 'screenshots/x/ask-1.png' })),
    readShot: vi.fn(async () => new Uint8Array([1, 2, 3])),
  } as unknown as FactwrightApi & {
    askAboutJob: Mock<FactwrightApi['askAboutJob']>;
    removeAsk: Mock<FactwrightApi['removeAsk']>;
    addShot: Mock<FactwrightApi['addShot']>;
  };
}

function controls(phase: RunPhase = 'idle', task: RunTask | null = null): RunControls {
  return { phase, task, start: vi.fn(), show: vi.fn() };
}

/** The dialog a question is asked in, from the row of Claude's skills, and what it calls. */
function asking(api = apiStub()) {
  const onAsked = vi.fn();
  render(<AskDialog job={job} api={api} onAsked={onAsked} onClose={() => {}} />);
  return { api, onAsked, dialog: screen.getByRole('dialog', { name: 'Ask about Acme' }) };
}

describe('AskDialog', () => {
  it('keeps a question, with its screenshot, then starts Claude on it', async () => {
    const { api, onAsked, dialog } = asking();
    await userEvent.click(within(dialog).getByRole('button', { name: /What’s the team/ }));
    const box = within(dialog).getByRole('textbox', {
      name: 'Your question',
    }) as HTMLTextAreaElement;
    expect(box.value).toBe('What’s the team and its culture like, from what people say?');
    expect(document.activeElement).toBe(box);
    await userEvent.clear(box);
    await userEvent.type(box, 'What’s their stack?');
    const picture = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'email.png', {
      type: 'image/png',
    });
    await userEvent.upload(dialog.querySelector('input[type="file"]') as HTMLInputElement, picture);
    expect(await within(dialog).findByRole('img', { name: 'Screenshot 1' })).toBeTruthy();
    expect((await axe.run(dialog)).violations).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask Claude' }));
    expect(api.askAboutJob).toHaveBeenCalledWith(job.id, 'What’s their stack?');
    await waitFor(() => expect(onAsked).toHaveBeenCalledWith('2026-10-12-whats-their-stack'));
    expect(api.addShot).toHaveBeenCalledWith(
      job.id,
      { name: 'email.png', bytes: expect.any(Uint8Array) },
      { kind: 'ask', ask: '2026-10-12-whats-their-stack' },
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('needs a question, and says why one wasn’t kept', async () => {
    const { api, onAsked } = asking();
    await userEvent.click(screen.getByRole('button', { name: 'Ask Claude' }));
    expect(screen.getByRole('alert').textContent).toBe('Type your question first.');
    api.askAboutJob.mockResolvedValueOnce({
      ok: false,
      message: 'That job isn’t in your tracker anymore.',
    });
    await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Why?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask Claude' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That job isn’t in your tracker anymore.',
    );
    expect(onAsked).not.toHaveBeenCalled();
  });

  it('keeps the question when a screenshot isn’t saved, and doesn’t ask it twice', async () => {
    const api = apiStub();
    api.addShot.mockResolvedValueOnce({ ok: false, message: 'email.png is empty.' });
    const { onAsked, dialog } = asking(api);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Your question' }), 'Why?');
    await userEvent.upload(
      dialog.querySelector('input[type="file"]') as HTMLInputElement,
      new File([new Uint8Array([1])], 'email.png', { type: 'image/png' }),
    );
    await within(dialog).findByRole('img', { name: 'Screenshot 1' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask Claude' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Your question is kept, but a screenshot isn’t: email.png is empty. Remove it and ask, or try again.',
    );
    expect(onAsked).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove screenshot 1' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask Claude' }));
    await waitFor(() => expect(onAsked).toHaveBeenCalledOnce());
    expect(api.askAboutJob).toHaveBeenCalledOnce();
  });
});

describe('AskSection', () => {
  it('says what to ask until there’s a question, then the user’s questions', async () => {
    const run = controls();
    const api = apiStub();
    render(<AskSection job={job} api={api} run={run} today={TODAY} />);
    expect(screen.getByText(/such as what to expect from a call/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ask a question' }));
    const dialog = screen.getByRole('dialog', { name: 'Ask about Acme' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Your question' }),
      'What’s their stack?',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask Claude' }));
    expect(api.askAboutJob).toHaveBeenCalledWith(job.id, 'What’s their stack?');
    expect(run.start).toHaveBeenCalledWith({
      skill: 'ask',
      jobId: job.id,
      askId: '2026-10-12-whats-their-stack',
    });
    cleanup();
    // While Claude answers one, another waits.
    render(
      <AskSection
        job={job}
        api={apiStub()}
        run={controls('working', { skill: 'ask', jobId: job.id, askId: ASK.id })}
        today={TODAY}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Ask a question' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();
    const shown = render(
      <AskSection job={{ ...job, asks: [ASK] }} api={apiStub()} run={controls()} today={TODAY} />,
    );
    const section = screen.getByRole('region', { name: 'Questions for Claude' });
    await waitFor(() => expect(section.textContent).toContain('1 question · 1 not answered yet'));
    expect((await axe.run(shown.container)).violations).toEqual([]);
  });

  it('shows Claude’s answer under the question, without the heading it was saved with', async () => {
    const api = apiStub({
      asked: {
        [ASK.id]: `# What should I expect?\n\nAsked ${TODAY}. Answered ${TODAY}.\n\nA **short** screen.`,
      },
      shots: [],
    });
    render(<AskSection job={{ ...job, asks: [ASK] }} api={api} run={controls()} today={TODAY} />);
    expect(await screen.findByText('Answered')).toBeTruthy();
    expect(screen.getByText('short').tagName).toBe('STRONG');
    expect(screen.queryByText(/Asked .* Answered/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask again' })).toBeTruthy();
  });

  it('says a question is waiting, or being answered, and lets the user answer it now', async () => {
    const run = controls();
    const asked = { ...job, asks: [ASK] };
    render(<AskSection job={asked} api={apiStub()} run={run} today={TODAY} />);
    expect(await screen.findByText('Waiting')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Answer now' }));
    expect(run.start).toHaveBeenCalledWith({ skill: 'ask', jobId: job.id, askId: ASK.id });
    cleanup();
    render(
      <AskSection
        job={asked}
        api={apiStub()}
        run={controls('working', { skill: 'ask', jobId: job.id })}
        today={TODAY}
      />,
    );
    expect(await screen.findByText('Answering')).toBeTruthy();
    expect(screen.getByText('Claude is working on it in its panel.')).toBeTruthy();
  });

  it('asks again about an answered question, by its ID', async () => {
    const run = controls();
    const api = apiStub({ asked: { [ASK.id]: 'A short screen.' }, shots: [] });
    render(<AskSection job={{ ...job, asks: [ASK] }} api={api} run={run} today={TODAY} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ask again' }));
    expect(run.start).toHaveBeenCalledWith({ skill: 'ask', jobId: job.id, askId: ASK.id });
  });

  it('removes a question once the user confirms it', async () => {
    const api = apiStub();
    render(<AskSection job={{ ...job, asks: [ASK] }} api={api} run={controls()} today={TODAY} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('status').textContent).toBe('Remove the question and its answer?');
    // The focus moves to the choices that took the button's place, and back.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove' }));
    expect(api.removeAsk).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(api.removeAsk).toHaveBeenCalledWith(job.id, ASK.id);
  });
});
