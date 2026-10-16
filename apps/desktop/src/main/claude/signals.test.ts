import { describe, expect, it } from 'vitest';
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
});

describe('bearerToken', () => {
  it('reads a 64-character hex token', () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
  });

  it.each([undefined, '', TOKEN, 'Bearer short', `Basic ${TOKEN}`])('refuses %s', (header) => {
    expect(bearerToken(header)).toBeNull();
  });
});
