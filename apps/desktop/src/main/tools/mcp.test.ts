import { describe, expect, it } from 'vitest';
import { answerMcp, type McpTool } from './mcp.ts';

const SERVER = { name: 'factwright', version: '0.0.0', instructions: 'Use these for job hunts.' };

const echo: McpTool = {
  name: 'echo',
  description: 'Says the text back.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  annotations: { readOnlyHint: true },
  run: async (input) => {
    if (input.text === 'fail') throw new Error('Asked to fail.');
    return `You said ${String(input.text)}`;
  },
};

const ask = (message: unknown) => answerMcp(message, [echo], SERVER);

describe('answerMcp', () => {
  it('starts a session in the version the client asks for', async () => {
    const answer = await ask({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'claude-code' },
      },
    });
    expect(answer).toEqual({
      status: 200,
      body: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'factwright', version: '0.0.0' },
          instructions: 'Use these for job hunts.',
        },
      },
    });
  });

  it('accepts notifications with no answer', async () => {
    expect(await ask({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({
      status: 202,
    });
  });

  it('lists the tools and runs one', async () => {
    const list = await ask({ jsonrpc: '2.0', id: 'a', method: 'tools/list' });
    expect(list.body).toMatchObject({
      result: { tools: [{ name: 'echo', description: 'Says the text back.' }] },
    });
    const call = await ask({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hi' } },
    });
    expect(call.body).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'You said hi' }] },
    });
  });

  it('reports a tool’s failure to Claude as an error result', async () => {
    const call = await ask({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'fail' } },
    });
    expect(call.body).toMatchObject({
      result: { content: [{ text: 'Asked to fail.' }], isError: true },
    });
  });

  it('refuses unknown tools, unknown methods and malformed messages', async () => {
    expect(
      (await ask({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })).body,
    ).toMatchObject({
      error: { code: -32602 },
    });
    expect((await ask({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).body).toMatchObject({
      error: { code: -32601 },
    });
    expect((await ask({ id: 6, method: 'ping' })).body).toMatchObject({ error: { code: -32600 } });
    expect((await ask([])).status).toBe(400);
  });

  it('answers a batch with a batch, leaving out notifications', async () => {
    const answer = await ask([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 7, method: 'ping' },
    ]);
    expect(answer).toEqual({ status: 200, body: [{ jsonrpc: '2.0', id: 7, result: {} }] });
  });
});
