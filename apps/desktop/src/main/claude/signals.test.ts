import { afterEach, describe, expect, it, vi } from 'vitest';
import { bearerToken, SignalServer, signalFor } from './signals.ts';

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

describe('SignalServer', () => {
  const server = new SignalServer();
  afterEach(() => server.stop());

  const post = (body: unknown, token = TOKEN) =>
    fetch(server.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it("passes a run's hooks to its listener", async () => {
    await server.start();
    const listener = vi.fn();
    server.listen(TOKEN, listener);
    const response = await post({ hook_event_name: 'Stop' });
    expect(response.status).toBe(204);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('done'));
  });

  it('refuses hooks without a live token', async () => {
    await server.start();
    const listener = vi.fn();
    const stopListening = server.listen(TOKEN, listener);
    expect((await post({ hook_event_name: 'Stop' }, 'b'.repeat(64))).status).toBe(404);
    stopListening();
    expect((await post({ hook_event_name: 'Stop' })).status).toBe(404);
    expect(listener).not.toHaveBeenCalled();
  });
});
