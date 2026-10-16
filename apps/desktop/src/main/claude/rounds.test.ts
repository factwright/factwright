import { describe, expect, it } from 'vitest';
import type { RoundReply } from '../../shared/rounds.ts';
import { hookReply, parseReply, roundFrom } from './rounds.ts';

const GRAPHQL = 'The posting wants GraphQL. Have you used GraphQL?';
const TOOLS = 'Which of these have you run in production?';

/** A round as Claude writes it, with fields the dialog doesn't use, which go back as they came. */
const input = {
  questions: [
    {
      question: GRAPHQL,
      header: 'Experience',
      options: [
        { label: 'Yes, in production', description: 'At work, on something people used' },
        { label: 'Some', description: '' },
        { label: 'No', description: 'Not yet', preview: '```\nNo GraphQL\n```' },
      ],
      multiSelect: false,
    },
    {
      question: TOOLS,
      header: 'Tools',
      options: [{ label: 'Kafka' }, { label: 'Terraform' }, { label: 'Kubernetes' }],
      multiSelect: true,
    },
  ],
  metadata: { source: 'focused-resume' },
};

const asked = (fields: Record<string, unknown> = {}) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion',
  tool_use_id: 'toolu_1',
  tool_input: input,
  session_id: 'abc',
  ...fields,
});

const heard = () => {
  const found = roundFrom(asked());
  if (!found) throw new Error('No round');
  return found;
};

const answer = (picks: string[], other = '', note = '') => ({ picks, other, note });

describe('roundFrom', () => {
  it('reads a round Claude is about to ask, with the input Claude Code gave', () => {
    const found = roundFrom(asked());
    expect(found?.input).toBe(input);
    expect(found?.round).toEqual({
      id: 'toolu_1',
      questions: [
        {
          question: GRAPHQL,
          header: 'Experience',
          kind: 'choice',
          description: null,
          placeholder: null,
          multiSelect: false,
          number: null,
          options: [
            {
              label: 'Yes, in production',
              description: 'At work, on something people used',
              preview: null,
            },
            { label: 'Some', description: null, preview: null },
            { label: 'No', description: 'Not yet', preview: '```\nNo GraphQL\n```' },
          ],
        },
        {
          question: TOOLS,
          header: 'Tools',
          kind: 'choice',
          description: null,
          placeholder: null,
          multiSelect: true,
          number: null,
          options: [
            { label: 'Kafka', description: null, preview: null },
            { label: 'Terraform', description: null, preview: null },
            { label: 'Kubernetes', description: null, preview: null },
          ],
        },
      ],
    });
  });

  it('takes a question with no options, which the user answers in their own words', () => {
    const found = roundFrom(asked({ tool_input: { questions: [{ question: 'Anything else?' }] } }));
    expect(found?.round.questions).toEqual([
      {
        question: 'Anything else?',
        header: null,
        kind: 'choice',
        description: null,
        placeholder: null,
        multiSelect: false,
        options: [],
        number: null,
      },
    ]);
  });

  it('takes a question asking for words, or for a number within a range, with nothing to pick', () => {
    const found = roundFrom(
      asked({
        tool_input: {
          questions: [
            {
              question: 'How many years have you run Kubernetes?',
              header: 'Kubernetes',
              kind: 'number',
              description: 'The posting asks for 3 or more.',
              min: 0,
              max: 40,
              step: 0.5,
              unit: 'years',
              defaultValue: 2,
            },
            {
              question: 'Anything to know first?',
              kind: 'text',
              placeholder: 'Such as a notice period',
              multiSelect: true,
            },
          ],
        },
      }),
    );
    expect(found?.round.questions).toEqual([
      {
        question: 'How many years have you run Kubernetes?',
        header: 'Kubernetes',
        kind: 'number',
        description: 'The posting asks for 3 or more.',
        placeholder: null,
        multiSelect: false,
        options: [],
        number: { min: 0, max: 40, step: 0.5, unit: 'years', start: 2 },
      },
      {
        question: 'Anything to know first?',
        header: null,
        kind: 'text',
        description: null,
        placeholder: 'Such as a notice period',
        multiSelect: false,
        options: [],
        number: null,
      },
    ]);
  });

  it('leaves every other hook, and any other tool, to carry on at once', () => {
    expect(roundFrom(asked({ hook_event_name: 'PostToolUse' }))).toBeNull();
    expect(roundFrom(asked({ tool_name: 'mcp__factwright__save_fact' }))).toBeNull();
    expect(roundFrom({ hook_event_name: 'Stop' })).toBeNull();
    expect(roundFrom(null)).toBeNull();
    expect(roundFrom('PreToolUse')).toBeNull();
  });

  it('leaves to the terminal a round from a subagent, or one that comes answered already', () => {
    expect(roundFrom(asked({ agent_id: 'fact-check' }))).toBeNull();
    expect(roundFrom(asked({ agent_id: '' }))).not.toBeNull();
    for (const field of ['answers', 'annotations', 'response', 'followUp']) {
      expect(roundFrom(asked({ tool_input: { ...input, [field]: {} } }))).toBeNull();
    }
  });

  it('leaves to the terminal what the dialog can’t show as Claude Code would', () => {
    const [first] = input.questions;
    const round = (questions: unknown) => roundFrom(asked({ tool_input: { questions } }));
    expect(round([])).toBeNull();
    expect(
      round([1, 2, 3, 4, 5].map((n) => ({ ...first, question: `Question ${n}?` }))),
    ).toBeNull();
    expect(round([first, first])).toBeNull();
    // Words and numbers have nothing to pick from, and a range has to make sense.
    expect(round([{ ...first, kind: 'number' }])).toBeNull();
    expect(round([{ ...first, kind: 'text' }])).toBeNull();
    expect(round([{ question: 'Years?', kind: 'number', min: 5, max: 1 }])).toBeNull();
    expect(round([{ question: 'Years?', kind: 'number', step: 0 }])).toBeNull();
    expect(
      round([{ question: 'Years?', kind: 'number', max: Number.POSITIVE_INFINITY }]),
    ).toBeNull();
    expect(round([{ question: 'Years?', kind: 'number', min: '1' }])).toBeNull();
    expect(round([{ question: 'When?', kind: 'date' }])).toBeNull();
    // A suggestion it wouldn't take as an answer is dropped, and the question kept.
    for (const defaultValue of [41, 1e21, -0.5]) {
      expect(
        round([{ question: 'Years?', kind: 'number', min: 0, max: 40, defaultValue }])?.round
          .questions[0]?.number?.start,
      ).toBeNull();
    }
    expect(round([{ ...first, kind: 'choice' }])).not.toBeNull();
    expect(round([{ ...first, question: '  ' }])).toBeNull();
    expect(round([{ ...first, question: 'x'.repeat(2001) }])).toBeNull();
    expect(round([{ ...first, multiSelect: 'yes' }])).toBeNull();
    expect(round([{ ...first, options: [{ label: 'Same' }, { label: 'Same' }] }])).toBeNull();
    expect(round([{ ...first, options: [{ label: '' }] }])).toBeNull();
    expect(round([{ ...first, options: [{ label: 'A', description: 3 }] }])).toBeNull();
    expect(round([{ ...first, options: 'Yes or no' }])).toBeNull();
    expect(round([{ ...first, header: 'x'.repeat(101) }])).toBeNull();
    expect(roundFrom(asked({ tool_use_id: '' }))).toBeNull();
    expect(roundFrom(asked({ tool_use_id: 'x'.repeat(201) }))).toBeNull();
    expect(roundFrom(asked({ tool_input: 'questions' }))).toBeNull();
  });
});

describe('parseReply', () => {
  const { round } = heard();

  it('takes an answer for each question, with picks in the order the question lists them', () => {
    expect(
      parseReply(round, [answer(['Yes, in production']), answer(['Kubernetes', 'Kafka'], 'Go')]),
    ).toEqual([
      answer(['Yes, in production']),
      { picks: ['Kafka', 'Kubernetes'], other: 'Go', note: '' },
    ]);
  });

  it('takes a question left unanswered, while another is answered', () => {
    expect(parseReply(round, [answer([], '', 'Ask me later'), answer(['Kafka'])])).not.toBeNull();
    expect(parseReply(round, [answer([]), answer([], '  ')])).toBeNull();
  });

  it('refuses answers that don’t fit the round', () => {
    expect(parseReply(round, [answer(['Yes, in production'])])).toBeNull();
    expect(parseReply(round, 'Yes')).toBeNull();
    expect(parseReply(round, [answer(['Maybe']), answer([])])).toBeNull();
    expect(parseReply(round, [answer(['Some', 'No']), answer([])])).toBeNull();
    expect(parseReply(round, [answer(['Some'], 'At a startup'), answer([])])).toBeNull();
    expect(parseReply(round, [answer([]), answer(['Kafka', 'Kafka'])])).toBeNull();
    expect(parseReply(round, [answer(['Some'], 'x'.repeat(10_001)), answer([])])).toBeNull();
    expect(parseReply(round, [{ picks: ['Some'], other: '' }, answer([])])).toBeNull();
    expect(parseReply(round, [{ picks: 'Some', other: '', note: '' }, answer([])])).toBeNull();
  });
});

describe('parseReply for a number question', () => {
  const found = roundFrom(
    asked({ tool_input: { questions: [{ question: 'Years?', kind: 'number', min: 0, max: 40 }] } }),
  );
  if (!found) throw new Error('No round');

  it('takes a number within its range, as Claude Code would, and refuses any other', () => {
    expect(parseReply(found.round, [answer([], ' 3.5 ')])).toEqual([answer([], ' 3.5 ')]);
    for (const other of ['41', '-1', 'three', '1e3', '3.', '.5']) {
      expect(parseReply(found.round, [answer([], other)])).toBeNull();
    }
    expect(parseReply(found.round, [answer(['3'], '')])).toBeNull();
  });
});

describe('hookReply', () => {
  it('allows the round with the answers by each question’s words, and the input as it came', () => {
    const reply: RoundReply = [
      answer(['Yes, in production'], '', '  Mostly Apollo  '),
      answer(['Kafka', 'Kubernetes'], 'Nomad'),
    ];
    expect(hookReply(heard(), reply)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          ...input,
          answers: { [GRAPHQL]: 'Yes, in production', [TOOLS]: 'Kafka, Kubernetes, Nomad' },
          annotations: { [GRAPHQL]: { notes: 'Mostly Apollo' } },
        },
      },
    });
  });

  it('sends the user’s own words alone, the preview of the one option picked, and no annotations when there’s nothing to add', () => {
    const own = hookReply(heard(), [answer([], '  A side project  '), answer([])]);
    expect(own.hookSpecificOutput.updatedInput).toEqual({
      ...input,
      answers: { [GRAPHQL]: 'A side project' },
    });
    const previewed = hookReply(heard(), [answer(['No']), answer([])]);
    expect(previewed.hookSpecificOutput.updatedInput).toMatchObject({
      answers: { [GRAPHQL]: 'No' },
      annotations: { [GRAPHQL]: { preview: '```\nNo GraphQL\n```' } },
    });
  });
});
