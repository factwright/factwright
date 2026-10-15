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

/** Says what the user answered to a question, as the fact tools find it. */
const recall: McpTool = {
  name: 'recall',
  description: 'Says what the user answered.',
  inputSchema: { type: 'object', properties: { question: { type: 'string' } } },
  run: async (input, call) =>
    call?.questions.find(String(input.question))?.answer ?? 'Not answered in this run',
};

/** Says which findings the run was started to fix, as revision_findings finds them. */
const picked: McpTool = {
  name: 'picked',
  description: 'Says which findings the run fixes.',
  inputSchema: { type: 'object', properties: {} },
  run: async (_input, call) =>
    call?.revision?.findings.map((finding) => finding.id).join(' ') ?? 'No revision',
};

describe('RunServer', () => {
  const server = new RunServer({ tools: [greet, recall, picked], version: '1.2.3' });
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
    server.listen(TOKEN, () => {}, { tools });
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

  it("keeps the questions a run's user answered, from its hooks, for its own tool calls only", async () => {
    await server.start();
    const other = 'c'.repeat(64);
    server.listen(TOKEN, () => {});
    server.listen(other, () => {});
    const question = 'Have you used GraphQL in production?';
    const questions = [{ question, header: 'GraphQL', options: [] }];
    await post(server.hookUrl, {
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_1',
      tool_input: { questions },
    });
    await post(server.hookUrl, {
      hook_event_name: 'PostToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_1',
      tool_input: { questions },
      tool_response: { questions, answers: { [question]: 'Yes, in production' } },
    });
    const recalled = async (token: string) => {
      const response = await post(
        server.toolsUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'recall', arguments: { question } },
        },
        { Authorization: `Bearer ${token}` },
      );
      return ((await response.json()) as { result: { content: { text: string }[] } }).result
        .content[0]?.text;
    };
    expect(await recalled(TOKEN)).toBe('Yes, in production');
    expect(await recalled(other)).toBe('Not answered in this run');
  });

  it('gives a revision’s findings to the run started for it, and to no other', async () => {
    await server.start();
    const other = 'd'.repeat(64);
    server.listen(TOKEN, () => {}, {
      revision: {
        jobId: 'acme--staff',
        resume: 'Resume.pdf',
        findings: [{ id: 'term-go', kind: 'content', title: 'Add “Go”', about: 'Go is missing.' }],
        before: 'Reads cleanly · 4 of 5 key terms',
        folder: '2026-10-07-acme',
        previous: 'applications/2026-10-07-acme/previous/2026-10-15-093012',
      },
    });
    server.listen(other, () => {});
    const findings = async (token: string) => {
      const response = await post(
        server.toolsUrl,
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'picked', arguments: {} } },
        { Authorization: `Bearer ${token}` },
      );
      return ((await response.json()) as { result: { content: { text: string }[] } }).result
        .content[0]?.text;
    };
    expect(await findings(TOKEN)).toBe('term-go');
    expect(await findings(other)).toBe('No revision');
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
