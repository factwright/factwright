import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpTool } from '../tools/mcp.ts';
import { RunServer } from './run-server.ts';

const TOKEN = 'a'.repeat(64);

const greet: McpTool = {
  name: 'greet',
  description: 'Says hello.',
  inputSchema: { type: 'object', properties: {} },
  run: async () => 'Hello',
};

describe('RunServer', () => {
  const server = new RunServer({ tools: [greet], version: '1.2.3' });
  afterEach(() => server.stop());

  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it("passes a run's hooks to its listener", async () => {
    await server.start();
    const listener = vi.fn();
    server.listen(TOKEN, listener);
    const response = await post(server.hookUrl, { hook_event_name: 'Stop' });
    expect(response.status).toBe(204);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ hook_event_name: 'Stop' }));
  });

  it("tells a run's tools listener which methods it calls, one at a time or in a batch", async () => {
    await server.start();
    const tools = vi.fn();
    server.listen(TOKEN, () => {}, tools);
    await post(server.toolsUrl, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await post(server.toolsUrl, [
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);
    expect(tools.mock.calls).toEqual([['tools/list'], ['ping'], ['notifications/initialized']]);
  });

  it("answers a run's tool calls over MCP", async () => {
    await server.start();
    server.listen(TOKEN, () => {});
    const initialize = await post(server.toolsUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    expect(initialize.headers.get('content-type')).toBe('application/json');
    expect(await initialize.json()).toMatchObject({
      result: { serverInfo: { name: 'factwright', version: '1.2.3' } },
    });
    const call = await post(server.toolsUrl, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'greet', arguments: {} },
    });
    expect(await call.json()).toMatchObject({
      result: { content: [{ type: 'text', text: 'Hello' }] },
    });
    const notified = await post(server.toolsUrl, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(notified.status).toBe(202);
  });

  it('refuses requests without a live token, from a web page, or by other methods', async () => {
    await server.start();
    const listener = vi.fn();
    const stopListening = server.listen(TOKEN, listener);
    const wrong = await fetch(server.hookUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'b'.repeat(64)}` },
      body: '{"hook_event_name":"Stop"}',
    });
    expect(wrong.status).toBe(404);
    expect((await post(server.toolsUrl, {}, { Origin: 'https://evil.example' })).status).toBe(404);
    const stream = await fetch(server.toolsUrl, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(stream.status).toBe(405);
    stopListening();
    expect((await post(server.hookUrl, { hook_event_name: 'Stop' })).status).toBe(404);
    expect(listener).not.toHaveBeenCalled();
  });
});
