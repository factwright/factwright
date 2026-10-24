// @vitest-environment jsdom
import { localDate, type SavedForm, shortDate } from '@factwright/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi, JobExtras } from '../../shared/api.ts';
import { ApplicationSection } from './ApplicationSection.tsx';
import type { RunControls } from './RunActions.tsx';
import { sampleJob } from './sample-jobs.ts';

const TODAY = localDate();

afterEach(cleanup);

const ANSWERS = [
  '# Application questions: Acme, Staff Engineer',
  '',
  '## Why Acme?',
  '',
  'Your deploys look like mine did.',
  '',
  '## Checkbox questions',
  '| Question | Pick | Why |',
  '|---|---|---|',
  '| Are you authorized to work in the US? | Yes | From your profile |',
].join('\n');

const job = sampleJob({
  id: 'acme--staff-engineer',
  company: 'Acme',
  role: 'Staff Engineer',
  docKinds: ['answers'],
  questions: ['Why Acme?', 'Are you authorized to work in the US?', 'Anything else?'],
  sent: [{ question: 'Why Acme?', nth: 0, text: 'Deploys, mostly.', on: TODAY, at: TODAY }],
});

/** What's on file for a job, with the questions of its form, if it has some. */
const extras = (form: SavedForm | null): JobExtras => ({
  asked: {},
  shots: [],
  posting: null,
  form,
  calls: {},
  outreach: [],
  versions: [],
});

function apiStub(form: SavedForm | null = null) {
  return {
    jobDocs: vi.fn(async () => ({ answers: ANSWERS })),
    jobExtras: vi.fn(async () => extras(form)),
    recordAnswer: vi.fn(async () => ({ ok: true }) as const),
    copyText: vi.fn(async () => ({ ok: true }) as const),
    getFormQuestions: vi.fn(async () => ({ ok: true, questions: 2 }) as const),
  } as unknown as FactwrightApi & {
    jobExtras: Mock<FactwrightApi['jobExtras']>;
    recordAnswer: Mock<FactwrightApi['recordAnswer']>;
    copyText: Mock<FactwrightApi['copyText']>;
    getFormQuestions: Mock<FactwrightApi['getFormQuestions']>;
  };
}

const controls = (): RunControls => ({ phase: 'idle', task: null, start: vi.fn(), show: vi.fn() });

const GREENHOUSE = 'https://job-boards.greenhouse.io/acme/jobs/4012345';

/** The questions Factwright got from the job's form on Greenhouse, for its Claude to draft. */
const FORM: SavedForm = {
  url: GREENHOUSE,
  read: new Date().toISOString(),
  from: 'greenhouse',
  questions: [
    {
      question: 'Why Acme?',
      hint: '',
      section: '',
      control: 'long',
      options: [],
      required: true,
      limit: 1000,
    },
    {
      question: 'Anything else?',
      hint: '',
      section: '',
      control: 'long',
      options: [],
      required: false,
      limit: null,
    },
  ],
};

/** A job saved from a posting on Greenhouse, with no questions yet. */
const onGreenhouse = { ...job, link: GREENHOUSE, questions: [], sent: [], docKinds: [] };

const item = (question: string) =>
  screen.getByText(question, { selector: 'span' }).closest('li') as HTMLElement;

describe('ApplicationSection', () => {
  it('lists each question with where it stands: sent, suggested, or not answered', async () => {
    const { container } = render(<ApplicationSection job={job} api={apiStub()} today={TODAY} />);
    expect(screen.getByRole('heading', { name: 'Application questions' })).toBeTruthy();
    await waitFor(() =>
      expect(
        within(item('Are you authorized to work in the US?')).getByText('Suggested'),
      ).toBeTruthy(),
    );
    expect(within(item('Why Acme?')).getByText('Sent')).toBeTruthy();
    expect(within(item('Anything else?')).getByText('Not answered')).toBeTruthy();
    expect(screen.getByText('1 of 3 sent')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('shows Claude’s suggestion beside what the user sent, and copies it', async () => {
    const api = apiStub();
    render(<ApplicationSection job={job} api={api} today={TODAY} />);
    await userEvent.click(screen.getByText('Why Acme?', { selector: 'span' }));
    const open = item('Why Acme?');
    expect(await within(open).findByText('Your deploys look like mine did.')).toBeTruthy();
    expect(
      (within(open).getByRole('textbox', { name: /What you sent/ }) as HTMLTextAreaElement).value,
    ).toBe('Deploys, mostly.');
    await userEvent.click(within(open).getByRole('button', { name: 'Copy' }));
    expect(api.copyText).toHaveBeenCalledWith('Your deploys look like mine did.');
    expect(within(open).getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('keeps what the user sent as they type it', async () => {
    const api = apiStub();
    render(<ApplicationSection job={job} api={api} today={TODAY} />);
    await userEvent.click(screen.getByText('Anything else?', { selector: 'span' }));
    const box = within(item('Anything else?')).getByRole('textbox', { name: /What you sent/ });
    await userEvent.type(box, 'Nope.');
    await userEvent.tab();
    await waitFor(() =>
      expect(api.recordAnswer).toHaveBeenLastCalledWith(job.id, 'Anything else?', 0, 'Nope.'),
    );
    expect(await within(item('Anything else?')).findByText('Saved')).toBeTruthy();
  });

  it('records a choice as Claude picked it, without the reason', async () => {
    const api = apiStub();
    render(<ApplicationSection job={job} api={api} today={TODAY} />);
    await userEvent.click(
      screen.getByText('Are you authorized to work in the US?', { selector: 'span' }),
    );
    const open = item('Are you authorized to work in the US?');
    expect(await within(open).findByText('Why: From your profile')).toBeTruthy();
    await userEvent.click(
      within(open).getByRole('button', { name: 'I sent Claude’s answer as it is' }),
    );
    await waitFor(() =>
      expect(api.recordAnswer).toHaveBeenCalledWith(
        job.id,
        'Are you authorized to work in the US?',
        0,
        'Yes',
      ),
    );
  });

  it('keeps an answer under the wording it was recorded with, so clearing it forgets it', async () => {
    const api = apiStub();
    const recorded = {
      ...job,
      questions: ['Why do you want to work at Acme Robotics, and why now?'],
      sent: [
        {
          question: 'Why do you want to work at Acme Robotics',
          nth: 0,
          text: 'Deploys.',
          on: TODAY,
          at: TODAY,
        },
      ],
      docKinds: [],
    };
    render(<ApplicationSection job={recorded} api={api} today={TODAY} />);
    await userEvent.click(screen.getByText(/and why now/, { selector: 'span' }));
    await userEvent.clear(screen.getByRole('textbox', { name: /What you sent/ }));
    await userEvent.tab();
    await waitFor(() =>
      expect(api.recordAnswer).toHaveBeenLastCalledWith(
        job.id,
        'Why do you want to work at Acme Robotics',
        0,
        '',
      ),
    );
  });

  it('keeps a separate answer for each time the form asks the same question', async () => {
    const api = apiStub();
    const twice = {
      ...job,
      questions: ['If yes, please explain.', 'If yes, please explain.'],
      sent: [],
      docKinds: [],
    };
    render(<ApplicationSection job={twice} api={api} today={TODAY} />);
    const [, second] = screen.getAllByText('If yes, please explain.', { selector: 'span' });
    await userEvent.click(second as HTMLElement);
    await userEvent.type(screen.getByRole('textbox', { name: /What you sent/ }), 'On-call.');
    await userEvent.tab();
    await waitFor(() =>
      expect(api.recordAnswer).toHaveBeenLastCalledWith(
        job.id,
        'If yes, please explain.',
        1,
        'On-call.',
      ),
    );
  });

  it('gets the questions of a form on Greenhouse before it’s open, then has your Claude draft them', async () => {
    const api = apiStub();
    const run = controls();
    const { container, rerender } = render(
      <ApplicationSection job={onGreenhouse} api={api} today={TODAY} run={run} />,
    );
    expect(
      screen.getByText(/The form is on Greenhouse, so Factwright can get its questions/),
    ).toBeTruthy();
    api.jobExtras.mockResolvedValue(extras(FORM));
    await userEvent.click(screen.getByRole('button', { name: 'Get the form’s questions' }));
    expect(api.getFormQuestions).toHaveBeenCalledWith(onGreenhouse.id);
    // Kept with the job, they're among its questions once the list changes.
    const got = { ...onGreenhouse, questions: ['Why Acme?', 'Anything else?'] };
    rerender(<ApplicationSection job={got} api={api} today={TODAY} run={run} />);
    const note = await screen.findByText(/The form’s 2 questions need drafts\./);
    expect(note.textContent).toBe(
      `From the form on Greenhouse, ${shortDate(FORM.read, TODAY)}. The form’s 2 questions need drafts. Your Claude writes them from your facts, and the extension fills them in when you open the form.`,
    );
    expect(item('Why Acme?')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Draft them with your Claude' }));
    expect(run.start).toHaveBeenCalledWith({
      skill: 'answer-questions',
      jobId: got.id,
      form: true,
    });
  });

  it('says how many of the form’s questions need drafts, and offers none once all have one', async () => {
    // Claude drafted Why Acme? already, and the other question is new.
    const { unmount } = render(
      <ApplicationSection job={job} api={apiStub(FORM)} today={TODAY} run={controls()} />,
    );
    expect(
      await screen.findByText(/1 of the form’s 2 questions needs a draft\. Your Claude writes it/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draft them with your Claude' })).toBeTruthy();
    unmount();
    const drafted: SavedForm = { ...FORM, from: 'browser', questions: FORM.questions.slice(0, 1) };
    render(<ApplicationSection job={job} api={apiStub(drafted)} today={TODAY} run={controls()} />);
    const note = await screen.findByText(/Your Claude drafted its questions/);
    expect(note.textContent).toBe(
      `From the form in your browser, ${shortDate(FORM.read, TODAY)}. Your Claude drafted its questions, and the extension fills them in when you open the form.`,
    );
    expect(screen.queryByRole('button', { name: 'Draft them with your Claude' })).toBeNull();
  });

  it('says where a form’s questions came from, even when its file doesn’t say when', async () => {
    render(
      <ApplicationSection
        job={job}
        api={apiStub({ ...FORM, read: '' })}
        today={TODAY}
        run={controls()}
      />,
    );
    const note = await screen.findByText(/1 of the form’s 2 questions needs a draft/);
    expect(note.textContent?.startsWith('From the form on Greenhouse. 1 of the form’s')).toBe(true);
  });

  it('says when the form asks nothing for your Claude, or why it couldn’t get the questions', async () => {
    const api = apiStub();
    let answer: (result: { ok: true; questions: number }) => void = () => {};
    api.getFormQuestions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    render(<ApplicationSection job={onGreenhouse} api={api} today={TODAY} run={controls()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Get the form’s questions' }));
    const getting = screen.getByRole('button', { name: 'Getting the form’s questions…' });
    expect((getting as HTMLButtonElement).disabled).toBe(true);
    answer({ ok: true, questions: 0 });
    expect(
      (await screen.findByRole('status')).textContent?.startsWith(
        'The form asks nothing of its own for your Claude to draft.',
      ),
    ).toBe(true);
    const closed = 'Greenhouse doesn’t list this job anymore, so it may have closed.';
    api.getFormQuestions.mockResolvedValueOnce({ ok: false, message: closed });
    await userEvent.click(screen.getByRole('button', { name: 'Get the form’s questions' }));
    expect((await screen.findByRole('alert')).textContent).toBe(closed);
    expect(screen.queryByRole('status')).toBeNull();
    // A request that fails outright says so too, and can be tried again.
    api.getFormQuestions.mockRejectedValueOnce(new Error('No handler'));
    await userEvent.click(screen.getByRole('button', { name: 'Get the form’s questions' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Factwright couldn’t get the form’s questions. Try again.',
      ),
    );
    expect(screen.getByRole('button', { name: 'Get the form’s questions' })).toBeTruthy();
  });

  it('offers to get the form’s questions beside ones the user pasted', async () => {
    const api = apiStub();
    render(
      <ApplicationSection
        job={{ ...job, link: GREENHOUSE }}
        api={api}
        today={TODAY}
        run={controls()}
      />,
    );
    expect(
      await screen.findByText(/The form is on Greenhouse, so Factwright can get its questions/),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Get the form’s questions' }));
    expect(api.getFormQuestions).toHaveBeenCalledWith(job.id);
  });

  it('offers nothing new for a posting that isn’t on Greenhouse', async () => {
    const api = apiStub();
    const lever = 'https://jobs.lever.co/acme/0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
    const { unmount } = render(
      <ApplicationSection
        job={{ ...onGreenhouse, link: lever }}
        api={api}
        today={TODAY}
        run={controls()}
      />,
    );
    expect(screen.queryByText(/Greenhouse/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Get the form’s questions' })).toBeNull();
    unmount();
    render(<ApplicationSection job={job} api={api} today={TODAY} run={controls()} />);
    await screen.findByText('1 of 3 sent');
    expect(screen.queryByRole('button', { name: 'Get the form’s questions' })).toBeNull();
  });

  it('says what goes here for a job with no questions or answers yet', () => {
    render(
      <ApplicationSection
        job={{ ...job, questions: [], sent: [], docKinds: [] }}
        api={apiStub()}
        today={TODAY}
      />,
    );
    expect(screen.getByText(/Paste the application form’s questions/)).toBeTruthy();
    // It waits for Claude Code to be ready.
    expect(
      (screen.getByRole('button', { name: 'Answer the questions' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
