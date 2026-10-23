// @vitest-environment jsdom
import { localDate } from '@factwright/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import { ApplicationSection } from './ApplicationSection.tsx';
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

function apiStub() {
  return {
    jobDocs: vi.fn(async () => ({ answers: ANSWERS })),
    recordAnswer: vi.fn(async () => ({ ok: true }) as const),
    copyText: vi.fn(async () => ({ ok: true }) as const),
  } as unknown as FactwrightApi & {
    recordAnswer: Mock<FactwrightApi['recordAnswer']>;
    copyText: Mock<FactwrightApi['copyText']>;
  };
}

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
