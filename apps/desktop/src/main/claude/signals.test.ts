import { describe, expect, it } from 'vitest';
import { RunActivity } from './activity.ts';
import { bearerToken, RunSignals } from './signals.ts';

const TOKEN = 'a'.repeat(64);

describe('RunSignals', () => {
  const run = () => {
    const signals: string[] = [];
    const tracker = new RunSignals((signal) => signals.push(signal));
    return { signals, hear: (event: unknown) => tracker.hear(event) };
  };
  const read = (file: string) => ({ tool_name: 'Read', tool_input: { file_path: file } });
  const page = {
    tool_name: 'mcp__factwright__read_page',
    tool_input: { url: 'https://acme.example' },
  };

  it.each([
    [{ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }, 'working'],
    [{ hook_event_name: 'PostToolUse', ...read('facts/profile.md') }, 'working'],
    [{ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }, 'needs-answer'],
    [{ hook_event_name: 'PermissionRequest', tool_name: 'Write' }, 'needs-answer'],
    [{ hook_event_name: 'Notification', notification_type: 'permission_prompt' }, 'needs-answer'],
    [{ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' }, 'needs-answer'],
    [{ hook_event_name: 'Stop' }, 'done'],
    // A turn that ends in an error, such as a rate limit, is over too.
    [{ hook_event_name: 'StopFailure', error: 'rate_limit' }, 'done'],
  ])('reads %o as %s', (event, signal) => {
    const { signals, hear } = run();
    hear(event);
    expect(signals).toEqual([signal]);
  });

  it.each([
    { hook_event_name: 'PreToolUse', tool_name: 'Read' },
    { hook_event_name: 'Notification', notification_type: 'idle_prompt' },
    { hook_event_name: 'SessionEnd' },
    'not an object',
    null,
  ])('ignores %o', (event) => {
    const { signals, hear } = run();
    hear(event);
    expect(signals).toEqual([]);
  });

  it('keeps needing an answer while tools alongside a permission prompt finish', () => {
    const { signals, hear } = run();
    hear({ hook_event_name: 'UserPromptSubmit' });
    hear({ hook_event_name: 'PermissionRequest', ...page });
    hear({ hook_event_name: 'PostToolUse', ...read('facts/profile.md'), tool_use_id: 'a' });
    hear({ hook_event_name: 'PostToolUse', ...read('facts/skills.md'), tool_use_id: 'b' });
    expect(signals).toEqual(['working', 'needs-answer']);
    hear({ hook_event_name: 'PostToolUse', ...page, tool_use_id: 'c' });
    expect(signals.at(-1)).toBe('working');
  });

  it('waits for every open prompt, and a failed call counts as answered', () => {
    const { signals, hear } = run();
    const write = { tool_name: 'Write', tool_input: { file_path: 'job.md', content: '#' } };
    hear({ hook_event_name: 'PermissionRequest', ...page });
    hear({ hook_event_name: 'PermissionRequest', ...write });
    hear({ hook_event_name: 'PostToolUseFailure', ...page, error: 'acme.example answered 404' });
    expect(signals.at(-1)).toBe('needs-answer');
    // The input can come back reworded; the oldest wait on that tool settles.
    hear({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: './job.md' },
    });
    expect(signals.at(-1)).toBe('working');
  });

  it('holds a question until it’s answered', () => {
    const { signals, hear } = run();
    const ask = { tool_name: 'AskUserQuestion', tool_input: { questions: [] } };
    hear({ hook_event_name: 'PreToolUse', ...ask });
    hear({ hook_event_name: 'PostToolUse', ...read('notes.md') });
    expect(signals).toEqual(['needs-answer']);
    hear({ hook_event_name: 'PostToolUse', ...ask });
    expect(signals).toEqual(['needs-answer', 'working']);
  });

  it('forgets a denied call when the user writes again, or the run stops', () => {
    const { signals, hear } = run();
    hear({ hook_event_name: 'PermissionRequest', ...page });
    hear({ hook_event_name: 'UserPromptSubmit' });
    hear({ hook_event_name: 'PostToolUse', ...read('facts/profile.md') });
    expect(signals).toEqual(['needs-answer', 'working', 'working']);
    hear({ hook_event_name: 'PermissionRequest', ...page });
    hear({ hook_event_name: 'Stop' });
    hear({ hook_event_name: 'PostToolUse', ...read('facts/profile.md') });
    expect(signals.slice(-3)).toEqual(['needs-answer', 'done', 'working']);
  });

  it('stops waiting on a call the user answered in the app, by that call alone', () => {
    const signals: string[] = [];
    const tracker = new RunSignals((signal) => signals.push(signal));
    tracker.hear({ hook_event_name: 'PermissionRequest', ...page });
    tracker.hear({ hook_event_name: 'PermissionRequest', ...read('notes/a.md') });
    // A no: its call never runs.
    tracker.answered({ ...page, ranWith: null });
    expect(signals).toEqual(['needs-answer', 'needs-answer']);
    // A yes: the run works on at once, and the call's PostToolUse settles no other wait.
    tracker.answered({ ...read('notes/a.md'), ranWith: read('notes/a.md').tool_input });
    expect(signals.at(-1)).toBe('working');
    tracker.hear({ hook_event_name: 'PermissionRequest', ...read('notes/b.md') });
    tracker.hear({ hook_event_name: 'PostToolUse', ...read('notes/a.md') });
    expect(signals.at(-1)).toBe('needs-answer');
  });

  it('works on once a round is answered in the app, before Claude Code runs it with the answers', () => {
    const signals: string[] = [];
    const tracker = new RunSignals((signal) => signals.push(signal));
    const questions = { questions: [{ question: 'Which?' }] };
    const answered = { ...questions, answers: { 'Which?': 'This one' } };
    tracker.hear({
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: questions,
    });
    tracker.answered({ tool_name: 'AskUserQuestion', tool_input: questions, ranWith: answered });
    expect(signals).toEqual(['needs-answer', 'working']);
    tracker.hear({
      hook_event_name: 'PostToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: answered,
    });
    expect(signals).toEqual(['needs-answer', 'working']);
  });

  it('reads a run interrupted with no Stop hook as done once Claude Code says it’s idle', () => {
    const signals: string[] = [];
    const tracker = new RunSignals((signal) => signals.push(signal));
    const idle = { hook_event_name: 'Notification', notification_type: 'idle_prompt' };
    tracker.hear({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
    tracker.hear(idle);
    expect(signals).toEqual(['working', 'done']);
    expect(tracker.hasWork()).toBe(false);
    // Once done, it says nothing more.
    tracker.hear(idle);
    expect(signals).toEqual(['working', 'done']);
    // Never while the run waits on the user.
    tracker.hear({ hook_event_name: 'UserPromptSubmit', prompt: 'and?' });
    tracker.hear({ hook_event_name: 'PermissionRequest', ...read('notes/a.md') });
    tracker.hear(idle);
    expect(signals.at(-1)).toBe('needs-answer');
    expect(tracker.hasWork()).toBe(true);
  });

  it('keeps a run working whose turn ends with Claude’s helpers at work in the background', () => {
    const signals: string[] = [];
    const tracker = new RunSignals((signal) => signals.push(signal));
    const stop = (...tasks: Record<string, string>[]) =>
      tracker.hear({ hook_event_name: 'Stop', background_tasks: tasks });
    tracker.hear({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
    stop({ id: 'agent-a1', type: 'subagent', status: 'running' });
    expect(signals).toEqual(['working', 'working']);
    expect(tracker.hasWork()).toBe(true);
    // Claude Code wakes Claude once its helpers are back, and that turn's end is the run done.
    stop();
    expect(signals.at(-1)).toBe('done');
    // Background work of another kind, or a helper that's over, keeps nothing going.
    stop({ id: 'bash-1', type: 'shell', status: 'running' });
    stop({ id: 'agent-a2', type: 'subagent', status: 'completed' });
    expect(signals.slice(-2)).toEqual(['done', 'done']);
  });

  it('keeps a run working whose turn ends in an error while helpers work, as the app knows them', () => {
    const signals: string[] = [];
    let helpers = true;
    const tracker = new RunSignals(
      (signal) => signals.push(signal),
      () => helpers,
    );
    tracker.hear({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
    // Claude Code's StopFailure doesn't list them, as its Stop does.
    tracker.hear({ hook_event_name: 'StopFailure', error: 'server_error' });
    expect(signals).toEqual(['working', 'working']);
    expect(tracker.hasWork()).toBe(true);
    // Back, they wake Claude, and its turn's end, by Claude Code's own list, is the run done.
    tracker.hear({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>' });
    tracker.hear({ hook_event_name: 'Stop', background_tasks: [] });
    expect(signals.at(-1)).toBe('done');
    // With none at work, a turn that ends in an error is the run done.
    helpers = false;
    tracker.hear({ hook_event_name: 'UserPromptSubmit', prompt: 'again' });
    tracker.hear({ hook_event_name: 'StopFailure', error: 'rate_limit' });
    expect(signals.at(-1)).toBe('done');
    expect(tracker.hasWork()).toBe(false);
  });

  it('reads a turn that ends in an error after a helper starts in the background as working', () => {
    const signals: string[] = [];
    const activity = new RunActivity(() => {}, '/workspace');
    const tracker = new RunSignals(
      (signal) => signals.push(signal),
      () => activity.hasHelpersAtWork(),
    );
    // As a run hears each hook: its signals first, then its activity.
    const hear = (event: Record<string, unknown>) => {
      tracker.hear(event);
      activity.hear(event);
    };
    const launch = {
      tool_name: 'Agent',
      tool_use_id: 'toolu_1',
      tool_input: { description: 'Fact-check the resume' },
    };
    hear({ hook_event_name: 'UserPromptSubmit', prompt: 'Tailor my resume' });
    activity.started({ hook_event_name: 'PreToolUse', ...launch });
    hear({
      hook_event_name: 'PostToolUse',
      ...launch,
      tool_response: { status: 'async_launched', agentId: 'agent-a1' },
    });
    hear({ hook_event_name: 'StopFailure', error: 'max_output_tokens' });
    expect(signals.at(-1)).toBe('working');
    hear({ hook_event_name: 'SubagentStop', agent_id: 'agent-a1', agent_type: 'x' });
    hear({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>' });
    hear({ hook_event_name: 'Stop', background_tasks: [] });
    expect(signals.at(-1)).toBe('done');
  });

  it('says the run has work going until it’s done, or ready with nothing to do', () => {
    const signals: string[] = [];
    const tracker = new RunSignals((signal) => signals.push(signal));
    // Claude Code is starting, maybe on its first screens or asking about trust.
    expect(tracker.hasWork()).toBe(true);
    tracker.ready();
    expect(signals).toEqual(['ready']);
    expect(tracker.hasWork()).toBe(false);
    tracker.hear({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
    expect(tracker.hasWork()).toBe(true);
    tracker.hear({ hook_event_name: 'PermissionRequest', ...read('notes/a.md') });
    expect(tracker.hasWork()).toBe(true);
    tracker.hear({ hook_event_name: 'StopFailure', error: 'rate_limit' });
    expect(tracker.hasWork()).toBe(false);
    // A task or a reply typed into Claude Code that's done is work, before its hook says so,
    // and the panel hears of it from the hook.
    tracker.prompted();
    expect(tracker.hasWork()).toBe(true);
    expect(signals).toEqual(['ready', 'working', 'needs-answer', 'done']);
    tracker.hear({ hook_event_name: 'Stop' });
    expect(tracker.hasWork()).toBe(false);
  });
});

describe('bearerToken', () => {
  it('reads a 64-character hex token', () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
  });

  it.each([undefined, '', TOKEN, 'Bearer short', `Basic ${TOKEN}`])('refuses %s', (header) => {
    expect(bearerToken(header)).toBeNull();
  });
});
