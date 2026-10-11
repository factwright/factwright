import { describe, expect, it } from 'vitest';
import { bearerToken, signalFor } from './signals.ts';

const TOKEN = 'a'.repeat(64);

describe('signalFor', () => {
  it.each([
    [{ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }, 'working'],
    [{ hook_event_name: 'PostToolUse', tool_name: 'Read' }, 'working'],
    [{ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }, 'needs-answer'],
    [{ hook_event_name: 'PermissionRequest', tool_name: 'Write' }, 'needs-answer'],
    [{ hook_event_name: 'Notification', notification_type: 'permission_prompt' }, 'needs-answer'],
    [{ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' }, 'needs-answer'],
    [{ hook_event_name: 'Stop' }, 'done'],
  ])('reads %o as %s', (event, signal) => {
    expect(signalFor(event)).toBe(signal);
  });

  it.each([
    { hook_event_name: 'PreToolUse', tool_name: 'Read' },
    { hook_event_name: 'Notification', notification_type: 'idle_prompt' },
    { hook_event_name: 'SessionEnd' },
    'not an object',
    null,
  ])('ignores %o', (event) => {
    expect(signalFor(event)).toBeNull();
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
