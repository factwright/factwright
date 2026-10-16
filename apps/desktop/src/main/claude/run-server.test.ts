import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuestionRound, RoundReply } from '../../shared/rounds.ts';
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
        findings: [
          { id: 'term-9f8e7d6c', kind: 'content', title: 'Add “Go”', about: 'Go is missing.' },
        ],
        before: 'Reads cleanly · 4 of 5 key terms',
        at: '2026-10-15T14:30:12.000Z',
        folder: '2026-10-07-acme',
        previous: 'applications/2026-10-07-acme/previous/2026-10-15-093012',
        files: [],
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
    expect(await findings(TOKEN)).toBe('term-9f8e7d6c');
    expect(await findings(other)).toBe('No revision');
  });

  describe('Claude’s questions', () => {
    const question = 'Have you used GraphQL in production?';
    const questions = [
      {
        question,
        header: 'GraphQL',
        options: [{ label: 'Yes, in production' }, { label: 'No' }],
        multiSelect: false,
      },
    ];
    const asked = {
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_q',
      tool_input: { questions },
    };
    const yes: RoundReply = [{ picks: ['Yes, in production'], other: '', note: '' }];

    /** A dialog the test answers, by hand, once the hook reaches it. */
    function dialog() {
      const answers: ((reply: RoundReply | null) => void)[] = [];
      const ask = vi.fn(
        (_round: QuestionRound, _signal: AbortSignal) =>
          new Promise<RoundReply | null>((resolve) => answers.push(resolve)),
      );
      const answer = async (reply: RoundReply | null) => {
        await vi.waitFor(() => expect(answers).toHaveLength(1));
        answers.shift()?.(reply);
      };
      return { ask, answer };
    }

    it('holds the hook until the user answers in the app, then allows the round with their answers', async () => {
      await server.start();
      const { ask, answer } = dialog();
      const hooks = vi.fn();
      server.listen(TOKEN, hooks, { ask });
      const held = post(server.hookUrl, asked);
      await answer(yes);
      expect(ask.mock.calls[0]?.[0]).toEqual({
        id: 'toolu_q',
        questions: [
          {
            question,
            header: 'GraphQL',
            multiSelect: false,
            options: [
              { label: 'Yes, in production', description: null, preview: null },
              { label: 'No', description: null, preview: null },
            ],
          },
        ],
      });
      const response = await held;
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.json()).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: { questions, answers: { [question]: 'Yes, in production' } },
        },
      });
      // The run still hears the question as it's asked, to read "Needs your answer".
      expect(hooks).toHaveBeenCalledWith(asked);
    });

    it('has the terminal ask when the dialog gives no answers, and answers other hooks meanwhile', async () => {
      await server.start();
      const { ask, answer } = dialog();
      server.listen(TOKEN, () => {}, { ask });
      const held = post(server.hookUrl, asked);
      await vi.waitFor(() => expect(ask).toHaveBeenCalled());
      expect((await post(server.hookUrl, { hook_event_name: 'Notification' })).status).toBe(204);
      await answer(null);
      const response = await held;
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');

      const failing = vi.fn(async () => {
        throw new Error('No window');
      });
      server.listen(TOKEN, () => {}, { ask: failing });
      expect((await post(server.hookUrl, asked)).status).toBe(204);
      expect(failing).toHaveBeenCalled();
    });

    it('lets the dialog go once Claude Code stops waiting, as when the user interrupts the run', async () => {
      await server.start();
      const stopped = vi.fn();
      const ask = vi.fn(
        (_round: QuestionRound, signal: AbortSignal) =>
          new Promise<RoundReply | null>((resolve) => {
            signal.addEventListener('abort', () => {
              stopped();
              resolve(yes);
            });
          }),
      );
      server.listen(TOKEN, () => {}, { ask });
      const gone = new AbortController();
      const held = fetch(server.hookUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(asked),
        signal: gone.signal,
      }).catch(() => 'stopped');
      await vi.waitFor(() => expect(ask).toHaveBeenCalled());
      gone.abort();
      await expect(held).resolves.toBe('stopped');
      await vi.waitFor(() => expect(stopped).toHaveBeenCalled());
    });

    it('leaves to the terminal a subagent’s questions, and those of a run with no dialog', async () => {
      await server.start();
      const { ask } = dialog();
      const other = 'e'.repeat(64);
      server.listen(TOKEN, () => {}, { ask });
      server.listen(other, () => {});
      expect((await post(server.hookUrl, { ...asked, agent_id: 'research' })).status).toBe(204);
      expect((await post(server.hookUrl, asked, { Authorization: `Bearer ${other}` })).status).toBe(
        204,
      );
      expect(ask).not.toHaveBeenCalled();
    });

    it('keeps what the user answered in the dialog for the run’s tools, once Claude Code reports it', async () => {
      await server.start();
      const { ask, answer } = dialog();
      server.listen(TOKEN, () => {}, { ask });
      const held = post(server.hookUrl, asked);
      await answer(yes);
      const { hookSpecificOutput } = (await (await held).json()) as {
        hookSpecificOutput: { updatedInput: Record<string, unknown> };
      };
      // As Claude Code reports a round once AskUserQuestion has run with the answers.
      await post(server.hookUrl, {
        hook_event_name: 'PostToolUse',
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_q',
        tool_input: hookSpecificOutput.updatedInput,
        tool_response: hookSpecificOutput.updatedInput,
      });
      const response = await post(server.toolsUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'recall', arguments: { question } },
      });
      expect(await response.json()).toMatchObject({
        result: { content: [{ type: 'text', text: 'Yes, in production' }] },
      });
    });
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
