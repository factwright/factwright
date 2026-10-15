import { describe, expect, it } from 'vitest';
import { QuestionLog } from './questions.ts';

const GRAPHQL = 'Have you used GraphQL in production?';
const KAFKA = 'Have you run Kafka, or another event-streaming platform?';

const question = (text: string, multiSelect = false) => ({
  question: text,
  header: 'Experience',
  options: [
    { label: 'Yes, in production', description: '' },
    { label: 'Some', description: 'A side project, a course, or an earlier role' },
    { label: 'No', description: '' },
  ],
  multiSelect,
});

/** A question round as Claude Code's hooks report it: asked, then answered. */
function round(
  log: QuestionLog,
  questions: ReturnType<typeof question>[],
  output: Record<string, unknown>,
  { id = 'toolu_1', asked = {} as Record<string, unknown>, extra = {} } = {},
) {
  log.hear({
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_use_id: id,
    tool_input: { questions, ...asked },
    ...extra,
  });
  log.hear({
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    tool_use_id: id,
    tool_input: { questions },
    tool_response: { questions, ...output },
    ...extra,
  });
}

describe('QuestionLog', () => {
  it('keeps each answer the user gave, with any notes, by the question’s words', () => {
    const log = new QuestionLog();
    round(log, [question(GRAPHQL), question(KAFKA)], {
      answers: { [GRAPHQL]: 'Yes, in production', [KAFKA]: 'No' },
      annotations: { [GRAPHQL]: { notes: 'Two years, on the partner API' } },
    });
    expect(log.find(GRAPHQL)).toEqual({
      question: GRAPHQL,
      answer: 'Yes, in production',
      notes: 'Two years, on the partner API',
    });
    expect(log.find(KAFKA)).toEqual({ question: KAFKA, answer: 'No', notes: null });
    // Spacing and case don't make it another question; other words do.
    expect(log.find(`  have you used  graphql\nin production?`)?.answer).toBe('Yes, in production');
    expect(log.find('Have you used GraphQL?')).toBeNull();
    expect(log.questions()).toEqual([GRAPHQL, KAFKA]);
  });

  it('reads several picks, and words typed in place of a pick for a round of one', () => {
    const log = new QuestionLog();
    round(log, [question(GRAPHQL, true)], {
      answers: { [GRAPHQL]: ['Yes, in production', 'Some'] },
    });
    expect(log.find(GRAPHQL)?.answer).toBe('Yes, in production, Some');
    round(
      log,
      [question(KAFKA)],
      { answers: {}, response: 'Only RabbitMQ, at Beacon' },
      { id: 'toolu_2' },
    );
    expect(log.find(KAFKA)?.answer).toBe('Only RabbitMQ, at Beacon');
    // Typed words can't tell which of two questions they answer.
    const two = new QuestionLog();
    round(two, [question(GRAPHQL), question(KAFKA)], { answers: {}, response: 'Yes to both' });
    expect(two.questions()).toEqual([]);
  });

  it('reads the answers from the call’s input when its result carries none', () => {
    const log = new QuestionLog();
    const asked = [question(GRAPHQL)];
    log.hear({
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_1',
      tool_input: { questions: asked },
    });
    log.hear({
      hook_event_name: 'PostToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_1',
      tool_input: { questions: asked, answers: { [GRAPHQL]: 'Some' } },
      tool_response:
        'User has answered your questions: "Have you used GraphQL in production?"="Some".',
    });
    expect(log.find(GRAPHQL)?.answer).toBe('Some');
    // With answers in neither, nothing was answered.
    round(log, [question(KAFKA)], {}, { id: 'toolu_2' });
    expect(log.find(KAFKA)).toBeNull();
  });

  it('keeps the newest answer to a question asked twice', () => {
    const log = new QuestionLog();
    round(log, [question(GRAPHQL)], { answers: { [GRAPHQL]: 'Some' } });
    round(
      log,
      [question(GRAPHQL)],
      { answers: { [GRAPHQL]: 'Yes, in production' } },
      { id: 'toolu_2' },
    );
    expect(log.find(GRAPHQL)?.answer).toBe('Yes, in production');
  });

  it('ignores a round that came with answers already, which only something other than the user gives', () => {
    for (const field of ['answers', 'annotations', 'response', 'followUp']) {
      const log = new QuestionLog();
      round(
        log,
        [question(GRAPHQL)],
        { answers: { [GRAPHQL]: 'Yes, in production' } },
        { asked: { [field]: field === 'followUp' ? false : { [GRAPHQL]: 'Yes, in production' } } },
      );
      expect(log.find(GRAPHQL)).toBeNull();
    }
  });

  it('ignores an answer it never saw asked, or saw asked in another call', () => {
    const log = new QuestionLog();
    log.hear({
      hook_event_name: 'PostToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_9',
      tool_input: { questions: [question(GRAPHQL)] },
      tool_response: { answers: { [GRAPHQL]: 'Yes, in production' } },
    });
    expect(log.find(GRAPHQL)).toBeNull();
    log.hear({
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_1',
      tool_input: { questions: [question(GRAPHQL)] },
    });
    log.hear({
      hook_event_name: 'PostToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_2',
      tool_response: { answers: { [GRAPHQL]: 'Yes, in production' } },
    });
    expect(log.find(GRAPHQL)).toBeNull();
  });

  it('only takes answers to the questions asked, as they were asked', () => {
    const log = new QuestionLog();
    round(log, [question(GRAPHQL)], {
      answers: { [GRAPHQL]: 'No', 'Have you led a team of 50?': 'Yes' },
    });
    expect(log.questions()).toEqual([GRAPHQL]);
  });

  it('ignores a round that closed itself while the user was away', () => {
    const log = new QuestionLog();
    round(log, [question(GRAPHQL)], { answers: { [GRAPHQL]: 'Some' }, afkTimeoutMs: 60_000 });
    expect(log.find(GRAPHQL)).toBeNull();
  });

  it('ignores other tools, subagents, and events without an id or questions', () => {
    const log = new QuestionLog();
    round(
      log,
      [question(GRAPHQL)],
      { answers: { [GRAPHQL]: 'Some' } },
      { extra: { agent_id: 'a1' } },
    );
    log.hear({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'x' });
    log.hear(null);
    log.hear('PostToolUse');
    log.hear({
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [question(GRAPHQL)] },
    });
    round(log, [], { answers: {} }, { id: 'toolu_3' });
    expect(log.questions()).toEqual([]);
  });

  it('lets an answer back so much, and no more', () => {
    const log = new QuestionLog();
    round(log, [question(GRAPHQL)], { answers: { [GRAPHQL]: 'Yes, in production' } });
    expect(log.canBack(GRAPHQL, 'gap')).toBe(true);
    log.back(GRAPHQL, 'gap');
    expect(log.canBack(GRAPHQL, 'gap')).toBe(false);
    for (let i = 0; i < 4; i++) log.back(GRAPHQL, 'fact');
    expect(log.canBack(GRAPHQL, 'fact')).toBe(false);
    expect(log.canBack(GRAPHQL, 'verify')).toBe(true);
    // Asked again, its new answer backs as much again.
    round(
      log,
      [question(GRAPHQL)],
      { answers: { [GRAPHQL]: 'Yes, in production' } },
      { id: 'toolu_2' },
    );
    expect(log.canBack(GRAPHQL, 'fact')).toBe(true);
    expect(log.canBack(KAFKA, 'fact')).toBe(false);
  });

  it('waits a moment for an answer whose hook is still on its way', async () => {
    const log = new QuestionLog();
    setTimeout(() => round(log, [question(GRAPHQL)], { answers: { [GRAPHQL]: 'Some' } }), 150);
    expect((await log.wait(GRAPHQL, 1_000))?.answer).toBe('Some');
    expect(await log.wait(KAFKA, 150)).toBeNull();
  });

  it('turns away questions and answers longer than Claude Code allows', () => {
    const log = new QuestionLog();
    const long = `${'Have you '.repeat(300)}?`;
    round(log, [question(long)], { answers: { [long]: 'Yes' } });
    round(
      log,
      [question(GRAPHQL)],
      { answers: { [GRAPHQL]: 'x'.repeat(20_000) } },
      { id: 'toolu_2' },
    );
    expect(log.questions()).toEqual([]);
  });
});
