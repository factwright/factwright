import { describe, expect, it, vi } from 'vitest';
import type { QuestionRound, RoundReply } from '../../shared/rounds.ts';
import { hookReply, parseReply, QuestionDesk, roundFrom } from './rounds.ts';

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
          multiSelect: false,
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
          multiSelect: true,
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
      { question: 'Anything else?', header: null, multiSelect: false, options: [] },
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
    expect(round([{ ...first, kind: 'number' }])).toBeNull();
    expect(round([{ ...first, kind: 'text' }])).toBeNull();
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

describe('QuestionDesk', () => {
  const round = (id: string): QuestionRound => ({ id, questions: heard().round.questions });
  const reply: RoundReply = [answer(['Some']), answer([])];

  it('shows the oldest round waiting, and settles each with the user’s answers', async () => {
    const show = vi.fn();
    const desk = new QuestionDesk(show);
    const first = desk.ask(round('a'), new AbortController().signal);
    const second = desk.ask(round('b'), new AbortController().signal);
    expect(desk.current()?.id).toBe('a');
    expect(show.mock.calls.map(([shown]) => shown?.id)).toEqual(['a']);
    expect(desk.answer('a', reply)).toBe(true);
    await expect(first).resolves.toBe(reply);
    expect(desk.current()?.id).toBe('b');
    expect(desk.answer('b', null)).toBe(true);
    await expect(second).resolves.toBeNull();
    expect(show.mock.calls.map(([shown]) => shown?.id ?? null)).toEqual(['a', 'b', null]);
    expect(desk.answer('b', reply)).toBe(false);
    expect(desk.find('b')).toBeNull();
  });

  it('lets a round go once Claude Code stops waiting for it', async () => {
    const show = vi.fn();
    const desk = new QuestionDesk(show);
    const stopped = new AbortController();
    const waiting = desk.ask(round('a'), stopped.signal);
    stopped.abort();
    await expect(waiting).resolves.toBeNull();
    expect(desk.current()).toBeNull();
    expect(show).toHaveBeenLastCalledWith(null);
    expect(desk.answer('a', reply)).toBe(false);
    const already = new AbortController();
    already.abort();
    await expect(desk.ask(round('b'), already.signal)).resolves.toBeNull();
    expect(desk.current()).toBeNull();
  });

  it('replaces a round asked again, and lets the oldest go past ten', async () => {
    const desk = new QuestionDesk(() => {});
    const before = desk.ask(round('a'), new AbortController().signal);
    const again = desk.ask(round('a'), new AbortController().signal);
    await expect(before).resolves.toBeNull();
    const waits = Array.from({ length: 10 }, (_, n) =>
      desk.ask(round(`r${n}`), new AbortController().signal),
    );
    await expect(again).resolves.toBeNull();
    expect(desk.current()?.id).toBe('r0');
    expect(desk.find('r9')).not.toBeNull();
    for (let n = 0; n < 10; n += 1) desk.answer(`r${n}`, null);
    await Promise.all(waits);
  });
});
