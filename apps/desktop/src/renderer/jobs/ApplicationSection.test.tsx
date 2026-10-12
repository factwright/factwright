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
  sent: [{ question: 'Why Acme?', text: 'Deploys, mostly.', on: TODAY }],
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
    expect(screen.getByRole('heading', { name: 'Application answers' })).toBeTruthy();
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
      expect(api.recordAnswer).toHaveBeenLastCalledWith(job.id, 'Anything else?', 'Nope.'),
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
        'Yes',
      ),
    );
  });

  it('shows nothing for a job with no questions or answers', () => {
    const { container } = render(
      <ApplicationSection
        job={{ ...job, questions: [], sent: [], docKinds: [] }}
        api={apiStub()}
        today={TODAY}
      />,
    );
    expect(container.textContent).toBe('');
  });
});
