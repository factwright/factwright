// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi, JobExtras, RunPhase } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { AskDialog, AskSection } from './AskSection.tsx';
import { type RunControls, runControlsFor } from './RunActions.tsx';
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
/** The user's reply to Claude's answer to ASK, carrying the conversation on. */
const REPLY = {
  id: '2026-10-13-and-pay',
  question: 'And pay?\nThey asked twice.',
  on: TODAY,
  thread: ASK.id,
};
/** Claude's answer as save_answer keeps it, with the question and dates on top. */
const saved = (question: string, answer: string) =>
  `# ${question}\n\nAsked ${TODAY}. Answered ${TODAY}.\n\n${answer}`;

function apiStub(
  extras: Omit<JobExtras, 'posting' | 'form' | 'calls' | 'outreach' | 'versions'> &
    Partial<JobExtras> = {
    asked: {},
    shots: [],
  },
) {
  return {
    platform: 'darwin',
    jobExtras: vi.fn(async () => ({
      posting: null,
      form: null,
      calls: {},
      outreach: [],
      versions: [],
      ...extras,
    })),
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

/** The job panel's run controls, with a run of a task in a phase, or none. */
function controls(phase: RunPhase | null = null, task: RunTask | null = null): RunControls {
  const runs = phase && task ? [{ id: 'run-1', task, phase }] : [];
  return { ...runControlsFor(runs, vi.fn(), vi.fn()), show: vi.fn() };
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
    // While Claude answers one, another can be asked, and waits in line for it.
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
    ).toBe(false);
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

  it('shows a conversation: each reply under the answer before it, with Claude’s answer', async () => {
    const api = apiStub({
      asked: {
        [ASK.id]: saved(ASK.question, 'A short screen.'),
        [REPLY.id]: saved('And pay?', 'Ask for **the range** first.'),
      },
      shots: [],
    });
    const shown = render(
      <AskSection job={{ ...job, asks: [ASK, REPLY] }} api={api} run={controls()} today={TODAY} />,
    );
    const section = screen.getByRole('region', { name: 'Questions for Claude' });
    // One conversation counts as one question.
    await waitFor(() => expect(section.textContent).toContain('1 question'));
    expect(section.textContent).not.toContain('not answered yet');
    expect(within(section).getByText(/^1 reply/)).toBeTruthy();
    expect(within(section).getByText('A short screen.')).toBeTruthy();
    expect(within(section).getByText(/^You ·/)).toBeTruthy();
    expect(within(section).getByText(/^And pay\?/).textContent).toBe('And pay?\nThey asked twice.');
    expect(within(section).getByText('the range').tagName).toBe('STRONG');
    expect(within(section).getByText('Answered')).toBeTruthy();
    expect((await axe.run(shown.container)).violations).toEqual([]);
  });

  it('sends a reply to Claude’s latest answer, and starts Claude on it', async () => {
    const run = controls();
    const api = apiStub({ asked: { [ASK.id]: saved(ASK.question, 'A short screen.') }, shots: [] });
    api.askAboutJob.mockResolvedValue({ ok: true, askId: REPLY.id });
    render(<AskSection job={{ ...job, asks: [ASK] }} api={api} run={run} today={TODAY} />);
    const box = (await screen.findByRole('textbox', { name: 'Your reply' })) as HTMLTextAreaElement;
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    await waitFor(() => expect(screen.getByText('Answered')).toBeTruthy());
    expect(send.disabled).toBe(true);
    // Shift-Enter starts a line, and Enter sends.
    await userEvent.type(box, 'And pay?{Shift>}{Enter}{/Shift}They asked twice.');
    expect(send.disabled).toBe(false);
    await userEvent.keyboard('{Enter}');
    expect(api.askAboutJob).toHaveBeenCalledWith(job.id, 'And pay?\nThey asked twice.', ASK.id);
    await waitFor(() =>
      expect(run.start).toHaveBeenCalledWith({ skill: 'ask', jobId: job.id, askId: REPLY.id }),
    );
    expect(box.value).toBe('');
    expect(document.activeElement).toBe(box);
    // Send works too, and the reply goes to the latest in the conversation.
    cleanup();
    const replied = apiStub({
      asked: {
        [ASK.id]: saved(ASK.question, 'A short screen.'),
        [REPLY.id]: saved('And pay?', 'Ask for the range.'),
      },
      shots: [],
    });
    render(
      <AskSection
        job={{ ...job, asks: [ASK, REPLY] }}
        api={replied}
        run={controls()}
        today={TODAY}
      />,
    );
    await userEvent.type(await screen.findByRole('textbox', { name: 'Your reply' }), 'Thanks!');
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(replied.askAboutJob).toHaveBeenCalledWith(job.id, 'Thanks!', REPLY.id);
    // Send goes quiet once it's sent, and the keyboard goes back to the box.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Your reply' })),
    );
    // A screen reader hears how to send, as the box shows nothing of it.
    const described = screen.getByRole('textbox', { name: 'Your reply' });
    expect(
      document.getElementById(described.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Enter sends, and Shift-Enter starts a new line.');
  });

  it('holds a reply until Claude has answered, and says why one wasn’t kept', async () => {
    // Not answered yet: the user can write a reply, but it waits for the answer.
    const api = apiStub();
    render(<AskSection job={{ ...job, asks: [ASK] }} api={api} run={controls()} today={TODAY} />);
    expect(await screen.findByText('Waiting')).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Your reply' }), 'Hello?{Enter}');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.askAboutJob).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(
      'You can send this once Claude has answered.',
    );
    cleanup();
    // Claude is answering it again.
    const answered = apiStub({ asked: { [ASK.id]: 'A short screen.' }, shots: [] });
    render(
      <AskSection
        job={{ ...job, asks: [ASK] }}
        api={answered}
        run={controls('working', { skill: 'ask', jobId: job.id, askId: ASK.id })}
        today={TODAY}
      />,
    );
    expect(await screen.findByText('Answering')).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Your reply' }), 'Hello?{Enter}');
    expect(answered.askAboutJob).not.toHaveBeenCalled();
    cleanup();
    // The question went on another device: the reply stays in its box, with why.
    const gone = apiStub({ asked: { [ASK.id]: 'A short screen.' }, shots: [] });
    gone.askAboutJob.mockResolvedValue({
      ok: false,
      message: 'That question isn’t on file anymore, so ask yours as a new question.',
    });
    const run = controls();
    render(<AskSection job={{ ...job, asks: [ASK] }} api={gone} run={run} today={TODAY} />);
    const box = (await screen.findByRole('textbox', { name: 'Your reply' })) as HTMLTextAreaElement;
    await waitFor(() => expect(screen.getByText('Answered')).toBeTruthy());
    await userEvent.type(box, 'Hello?{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That question isn’t on file anymore, so ask yours as a new question.',
    );
    expect(box.value).toBe('Hello?');
    expect(run.start).not.toHaveBeenCalled();
  });

  it('asks again about the latest reply, and removes the whole conversation', async () => {
    const run = controls();
    const api = apiStub({
      asked: { [ASK.id]: 'A short screen.', [REPLY.id]: 'Ask for the range.' },
      shots: [],
    });
    render(<AskSection job={{ ...job, asks: [ASK, REPLY] }} api={api} run={run} today={TODAY} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ask again' }));
    expect(run.start).toHaveBeenCalledWith({ skill: 'ask', jobId: job.id, askId: REPLY.id });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('status').textContent).toBe(
      'Remove the question, your replies and Claude’s answers?',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(api.removeAsk).toHaveBeenCalledWith(job.id, ASK.id);
  });
});
