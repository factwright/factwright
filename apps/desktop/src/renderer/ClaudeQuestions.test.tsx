// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EditResult } from '../shared/api.ts';
import type { QuestionRound, RoundReply } from '../shared/rounds.ts';
import { ClaudeQuestions } from './ClaudeQuestions.tsx';

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

const GRAPHQL = 'The posting wants `GraphQL`. Have you used it?';
const TOOLS = 'Which of these have you run in production?';

const ROUND: QuestionRound = {
  id: 'toolu_1',
  questions: [
    {
      question: GRAPHQL,
      header: 'Experience',
      multiSelect: false,
      options: [
        {
          label: 'Yes, in production',
          description: 'At work, on something people used',
          preview: null,
        },
        {
          label: 'Some',
          description: 'A side project, a course, or an earlier role',
          preview: null,
        },
        { label: 'No', description: null, preview: '```\nNo GraphQL yet\n```' },
      ],
    },
    {
      question: TOOLS,
      header: 'Tools',
      multiSelect: true,
      options: [
        { label: 'Kafka', description: null, preview: null },
        { label: 'Terraform', description: null, preview: null },
        { label: 'Kubernetes', description: null, preview: null },
      ],
    },
  ],
};

function open(result: EditResult = { ok: true }, round = ROUND) {
  const api = {
    answerClaude: vi.fn(async (_id: string, _reply: RoundReply | 'terminal') => result),
  };
  const onClose = vi.fn();
  const view = render(
    <ClaudeQuestions
      api={api}
      round={round}
      about="Tailored resume · Acme Robotics"
      onClose={onClose}
    />,
  );
  return { api, onClose, ...view };
}

/** A question in the dialog, by words in it. */
const question = (words: string) =>
  screen.getByRole('group', { name: (name) => name.includes(words) });
const send = () => screen.getByRole('button', { name: /^Send answer/ }) as HTMLButtonElement;

describe('ClaudeQuestions', () => {
  it('shows every question at once, from the user’s Claude, with what each option means', async () => {
    const { container } = open();
    const dialog = screen.getByRole('dialog', { name: 'Claude has 2 questions' });
    expect(dialog.textContent).toContain(
      'From your Claude, working on Tailored resume · Acme Robotics.',
    );
    const graphql = question('Have you used it');
    expect(within(graphql).getByText('Experience')).toBeTruthy();
    // Claude's Markdown marks show as they read.
    expect(within(graphql).getByText('GraphQL').tagName).toBe('CODE');
    expect(within(graphql).getAllByRole('radio')).toHaveLength(4);
    expect(
      within(graphql).getByRole('radio', {
        name: 'Yes, in production',
        description: 'At work, on something people used',
      }),
    ).toBeTruthy();
    const tools = question(TOOLS);
    expect(within(tools).getByText('Pick any that apply.')).toBeTruthy();
    expect(within(tools).getAllByRole('checkbox')).toHaveLength(4);
    // The focus starts on the first option, ready to pick.
    expect(document.activeElement).toBe(
      within(graphql).getByRole('radio', { name: 'Yes, in production' }),
    );
    expect(send().disabled).toBe(true);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('sends what the user picked, wrote and noted, and closes', async () => {
    const { api, onClose } = open();
    const graphql = question('Have you used it');
    await userEvent.click(within(graphql).getByRole('radio', { name: 'Some' }));
    await userEvent.click(within(graphql).getByRole('radio', { name: 'Yes, in production' }));
    await userEvent.click(within(graphql).getByRole('button', { name: 'Add a note' }));
    await userEvent.type(
      within(graphql).getByRole('textbox', { name: 'Note for Claude' }),
      'Apollo',
    );
    const tools = question(TOOLS);
    await userEvent.click(within(tools).getByRole('checkbox', { name: 'Kubernetes' }));
    await userEvent.click(within(tools).getByRole('checkbox', { name: 'Kafka' }));
    await userEvent.type(
      within(tools).getByRole('textbox', { name: 'Something else, in your words' }),
      'Nomad',
    );
    expect(within(tools).getByRole('checkbox', { name: 'Something else' })).toHaveProperty(
      'checked',
      true,
    );
    await userEvent.click(send());
    expect(api.answerClaude).toHaveBeenCalledWith('toolu_1', [
      { picks: ['Yes, in production'], other: '', note: 'Apollo' },
      { picks: ['Kafka', 'Kubernetes'], other: 'Nomad', note: '' },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('takes the user’s own words in place of an option where one answer fits', async () => {
    const { api } = open();
    const graphql = question('Have you used it');
    await userEvent.click(within(graphql).getByRole('radio', { name: 'Some' }));
    await userEvent.type(
      within(graphql).getByRole('textbox', { name: 'Something else, in your words' }),
      'Only reading it',
    );
    expect(within(graphql).getByRole('radio', { name: 'Some' })).toHaveProperty('checked', false);
    expect(within(graphql).getByRole('radio', { name: 'Something else' })).toHaveProperty(
      'checked',
      true,
    );
    // Picking an option again leaves the user's words out.
    await userEvent.click(within(graphql).getByRole('radio', { name: 'No' }));
    expect(screen.getByText('No GraphQL yet').tagName).toBe('PRE');
    await userEvent.click(within(graphql).getByRole('radio', { name: 'Something else' }));
    expect(document.activeElement).toBe(
      within(graphql).getByRole('textbox', { name: 'Something else, in your words' }),
    );
    await userEvent.click(send());
    expect(api.answerClaude).toHaveBeenLastCalledWith('toolu_1', [
      { picks: [], other: 'Only reading it', note: '' },
      { picks: [], other: '', note: '' },
    ]);
  });

  it('says a question left unanswered is skipped, and sends the rest', async () => {
    const { api } = open();
    await userEvent.click(within(question(TOOLS)).getByRole('checkbox', { name: 'Terraform' }));
    expect(
      screen.getByText(/One question has no answer\. Claude carries on without it\./),
    ).toBeTruthy();
    expect(send().disabled).toBe(false);
    await userEvent.click(send());
    expect(api.answerClaude).toHaveBeenCalledWith('toolu_1', [
      { picks: [], other: '', note: '' },
      { picks: ['Terraform'], other: '', note: '' },
    ]);
  });

  it('sends the round to the terminal, or puts it aside, as the user chooses', async () => {
    const first = open();
    await userEvent.click(screen.getByRole('button', { name: 'Answer in the terminal' }));
    expect(first.api.answerClaude).toHaveBeenCalledWith('toolu_1', 'terminal');
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = open();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(second.api.answerClaude).not.toHaveBeenCalled();
    expect(second.onClose).toHaveBeenCalled();
  });

  it('carries on from what the user chose before putting the round aside, and keeps each change', async () => {
    const onDraft = vi.fn();
    const draft = [
      { picks: ['Some'], other: '', otherOn: false, note: 'A course', noting: true },
      { picks: ['Kafka'], other: '', otherOn: false, note: '', noting: false },
    ];
    render(
      <ClaudeQuestions
        api={{ answerClaude: vi.fn(async () => ({ ok: true }) as EditResult) }}
        round={ROUND}
        about={null}
        draft={draft}
        onDraft={onDraft}
        onClose={vi.fn()}
      />,
    );
    const graphql = question('Have you used it');
    expect(within(graphql).getByRole('radio', { name: 'Some' })).toHaveProperty('checked', true);
    expect(within(graphql).getByRole('textbox', { name: 'Note for Claude' })).toHaveProperty(
      'value',
      'A course',
    );
    expect(within(question(TOOLS)).getByRole('checkbox', { name: 'Kafka' })).toHaveProperty(
      'checked',
      true,
    );
    await userEvent.click(within(question(TOOLS)).getByRole('checkbox', { name: 'Terraform' }));
    expect(onDraft).toHaveBeenLastCalledWith([
      draft[0],
      { picks: ['Kafka', 'Terraform'], other: '', otherOn: false, note: '', noting: false },
    ]);
  });

  it('stays open, saying why, when the answers don’t reach Claude', async () => {
    const { onClose } = open({
      ok: false,
      message: 'Claude isn’t waiting for these answers anymore.',
    });
    await userEvent.click(
      within(question('Have you used it')).getByRole('radio', { name: 'Some' }),
    );
    await userEvent.click(send());
    expect(screen.getByRole('alert').textContent).toBe(
      'Claude isn’t waiting for these answers anymore.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks a question with no options in the user’s own words', async () => {
    const { api } = open(
      { ok: true },
      {
        id: 'toolu_2',
        questions: [
          {
            question: 'What should Claude call you?',
            header: null,
            multiSelect: false,
            options: [],
          },
        ],
      },
    );
    expect(screen.getByRole('dialog', { name: 'Claude has a question' })).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(api.answerClaude).toHaveBeenCalledWith('toolu_2', [
      { picks: [], other: 'Sam', note: '' },
    ]);
  });
});
