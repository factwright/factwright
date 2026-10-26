import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionAnswer, PermissionAsk } from '../../shared/permission-asks.ts';
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

/** Writes a file, as Factwright's tools do: saying so first, and saying what it read. */
const save: McpTool = {
  name: 'save',
  description: 'Saves a file.',
  inputSchema: { type: 'object', properties: {} },
  run: async (_input, call) => {
    call?.read?.('https://acme.com/careers');
    call?.keep?.('applications/acme/job.md');
    return 'Saved';
  },
};

describe('RunServer', () => {
  const server = new RunServer({ tools: [greet, recall, picked, save], version: '1.2.3' });
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

  it('hears each tool call as it starts, on a path of its own, and answers at once', async () => {
    await server.start();
    const hooks = vi.fn();
    const activity = vi.fn();
    server.listen(TOKEN, hooks, { activity });
    const event = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'toolu_1' };
    const response = await post(server.activityUrl, event);
    expect(response.status).toBe(204);
    await vi.waitFor(() => expect(activity).toHaveBeenCalledWith(event));
    // Only heard: the run's own hooks, and the questions they hold, never see it.
    expect(hooks).not.toHaveBeenCalled();
    // A run without a listener for it still hears back.
    const stopOther = server.listen('c'.repeat(64), () => {});
    const other = await fetch(server.activityUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'c'.repeat(64)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    stopOther();
    expect(other.status).toBe(204);
    expect(activity).toHaveBeenCalledOnce();
  });

  it('keeps what it needs before a call runs, answering only once it has', async () => {
    await server.start();
    const kept: string[] = [];
    const before = vi.fn((event: unknown): unknown => {
      kept.push((event as { tool_input: { file_path: string } }).tool_input.file_path);
      return null;
    });
    server.listen(TOKEN, () => {}, { before });
    const edit = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/workspace/job.md' },
    };
    const response = await post(server.activityUrl, edit);
    // Heard before the answer: Claude Code waits for the hook, so the file is kept first.
    expect(kept).toEqual(['/workspace/job.md']);
    expect(response.status).toBe(204);
    // A listener that fails lets the call run as it would have.
    before.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect((await post(server.activityUrl, edit)).status).toBe(204);
    // What it gives back is the hook's answer, such as to ask the user first.
    const ask = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } };
    before.mockReturnValueOnce(ask);
    const asked = await post(server.activityUrl, edit);
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual(ask);
    // A whole new file comes with its start, however big, so it's kept before it's written.
    const big = {
      ...edit,
      tool_name: 'Write',
      tool_input: { file_path: '/w/big.md', content: 'x'.repeat(5_000_000) },
    };
    expect((await post(server.activityUrl, big)).status).toBe(204);
    expect(kept.at(-1)).toBe('/w/big.md');
  });

  it('tells the run what Factwright’s tools are about to write, and what they read', async () => {
    await server.start();
    const keep = vi.fn();
    const read = vi.fn();
    server.listen(TOKEN, () => {}, { keep, read });
    const response = await post(server.toolsUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'save', arguments: {} },
    });
    const answer = (await response.json()) as { result: { content: { text: string }[] } };
    expect(answer.result.content[0]?.text).toBe('Saved');
    expect(keep).toHaveBeenCalledWith('applications/acme/job.md');
    expect(read).toHaveBeenCalledWith('https://acme.com/careers');
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
    const yes: RoundReply = [
      { picks: ['Yes, in production'], other: '', note: '', skipped: false },
    ];

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
      const onAnswered = vi.fn();
      server.listen(TOKEN, hooks, { ask, onAnswered });
      const held = post(server.hookUrl, asked);
      await answer(yes);
      expect(ask.mock.calls[0]?.[0]).toEqual({
        id: 'toolu_q',
        questions: [
          {
            question,
            header: 'GraphQL',
            kind: 'choice',
            description: null,
            placeholder: null,
            multiSelect: false,
            number: null,
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
      // The run still hears the question as it's asked, to read "Needs your answer", and hears
      // once it's answered, with the round as it then runs.
      expect(hooks).toHaveBeenCalledWith(asked);
      await vi.waitFor(() =>
        expect(onAnswered).toHaveBeenCalledWith({
          tool_name: 'AskUserQuestion',
          tool_input: { questions },
          ranWith: { questions, answers: { [question]: 'Yes, in production' } },
        }),
      );
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

    it('lets the dialog go once the run stops listening, as when it ends', async () => {
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
      const stopListening = server.listen(TOKEN, () => {}, { ask });
      const held = post(server.hookUrl, asked);
      await vi.waitFor(() => expect(ask).toHaveBeenCalled());
      stopListening();
      expect(stopped).toHaveBeenCalled();
      // Nothing the dialog said after the run let go reaches Claude Code.
      expect((await held).status).toBe(204);
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

    it('turns the round away when the task asks nothing, saying why, before anything hears it', async () => {
      await server.start();
      const { ask, answer } = dialog();
      const hooks = vi.fn();
      const why = 'A quick resume asks the user nothing.';
      let quiet: string | null = why;
      server.listen(TOKEN, hooks, { ask, noQuestions: () => quiet });
      // A subagent's round too, which would otherwise go to the terminal.
      for (const event of [asked, { ...asked, agent_id: 'research' }]) {
        const response = await post(server.hookUrl, event);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: why,
          },
        });
      }
      // No dialog, and nothing that would have the run read as waiting on the user.
      expect(ask).not.toHaveBeenCalled();
      expect(hooks).not.toHaveBeenCalled();
      // The run's other hooks go on as before.
      expect((await post(server.hookUrl, { hook_event_name: 'Stop' })).status).toBe(204);
      expect(hooks).toHaveBeenCalledOnce();
      // Once the task may ask, the dialog asks.
      quiet = null;
      const held = post(server.hookUrl, asked);
      await answer(null);
      expect((await held).status).toBe(204);
      // A task the app can't tell about lets the question be asked.
      server.listen(TOKEN, () => {}, {
        ask,
        noQuestions: () => {
          throw new Error('No run');
        },
      });
      const again = post(server.hookUrl, asked);
      await answer(null);
      expect((await again).status).toBe(204);
      expect(ask).toHaveBeenCalledTimes(2);
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

  describe('Claude Code’s permission prompts', () => {
    const input = { file_path: '/work/notes/a.md', content: 'Hello' };
    const prompted = {
      hook_event_name: 'PermissionRequest',
      tool_name: 'Write',
      tool_input: input,
      permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    };

    /** The app's permission dialog, which the test answers by hand, and which lets go when told. */
    function dialog() {
      const answers: ((answer: PermissionAnswer | null) => void)[] = [];
      const signals: AbortSignal[] = [];
      const permit = vi.fn(
        (_ask: PermissionAsk, signal: AbortSignal) =>
          new Promise<PermissionAnswer | null>((resolve) => {
            answers.push(resolve);
            signals.push(signal);
            // Let go, it's no longer there to answer.
            signal.addEventListener('abort', () => {
              answers.splice(answers.indexOf(resolve), 1);
              resolve(null);
            });
          }),
      );
      // Answers the oldest prompt waiting.
      const answer = async (given: PermissionAnswer | null) => {
        await vi.waitFor(() => expect(answers.length).toBeGreaterThan(0));
        answers.shift()?.(given);
      };
      return { permit, answer, signals };
    }

    it('turns the prompt away when the task asks nothing, its subagents’ too, before anything hears it', async () => {
      await server.start();
      const { permit } = dialog();
      const hooks = vi.fn();
      const why = 'Analyzing several jobs asks the user nothing.';
      server.listen(TOKEN, hooks, { permit, noPermits: () => why, noQuestions: () => why });
      for (const event of [prompted, { ...prompted, agent_id: 'helper' }]) {
        const response = await post(server.hookUrl, event);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'deny', message: why },
          },
        });
      }
      expect(permit).not.toHaveBeenCalled();
      expect(hooks).not.toHaveBeenCalled();
      // A task that only turns away questions leaves the prompt to the user.
      server.listen(TOKEN, hooks, { permit, noQuestions: () => why });
      void post(server.hookUrl, prompted);
      await vi.waitFor(() => expect(permit).toHaveBeenCalledOnce());
    });

    it('holds the hook while the user decides in the app, and allows the call as Claude asked it', async () => {
      await server.start();
      const { permit, answer } = dialog();
      const hooks = vi.fn();
      server.listen(TOKEN, hooks, { permit, context: { workspace: '/work' } });
      const held = post(server.hookUrl, prompted);
      await answer({ allow: true });
      expect(permit.mock.calls[0]?.[0]).toMatchObject({
        kind: 'write',
        file: 'notes/a.md',
        outside: false,
        content: 'Hello',
      });
      expect(await (await held).json()).toEqual({
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
      });
      // The run still hears it asked, to read "Needs your answer".
      expect(hooks).toHaveBeenCalledWith(prompted);
    });

    it('denies the call with the user’s note, and tells the run it won’t run', async () => {
      await server.start();
      const { permit, answer } = dialog();
      const onAnswered = vi.fn();
      server.listen(TOKEN, () => {}, { permit, onAnswered, context: { workspace: '/work' } });
      const held = post(server.hookUrl, prompted);
      await answer({ allow: false, note: 'Keep it in the job’s folder' });
      expect(await (await held).json()).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'deny',
            message: 'The user said no, in Factwright, and added: Keep it in the job’s folder',
          },
        },
      });
      await vi.waitFor(() =>
        expect(onAnswered).toHaveBeenCalledWith({
          tool_name: 'Write',
          tool_input: input,
          ranWith: null,
        }),
      );
    });

    it('tells the run of a yes too, with the call as it runs, and of nothing let go', async () => {
      await server.start();
      const { permit, answer, signals } = dialog();
      const onAnswered = vi.fn();
      server.listen(TOKEN, () => {}, { permit, onAnswered, context: { workspace: '/work' } });
      const allowed = post(server.hookUrl, prompted);
      await answer({ allow: true });
      await allowed;
      await vi.waitFor(() =>
        expect(onAnswered).toHaveBeenCalledWith({
          tool_name: 'Write',
          tool_input: input,
          ranWith: input,
        }),
      );
      const dropped = post(server.hookUrl, prompted);
      await vi.waitFor(() => expect(signals).toHaveLength(2));
      await post(server.hookUrl, { hook_event_name: 'Stop' });
      expect((await dropped).status).toBe(204);
      expect(onAnswered).toHaveBeenCalledTimes(1);
    });

    it('lets go of one prompt for a call that ran, never for a subagent’s call', async () => {
      await server.start();
      const { permit, signals } = dialog();
      server.listen(TOKEN, () => {}, { permit, context: { workspace: '/work' } });
      const first = post(server.hookUrl, prompted);
      const second = post(server.hookUrl, prompted);
      await vi.waitFor(() => expect(signals).toHaveLength(2));
      const ran = { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: input };
      await post(server.hookUrl, { ...ran, agent_id: 'research' });
      expect(signals.map((signal) => signal.aborted)).toEqual([false, false]);
      await post(server.hookUrl, ran);
      expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
      expect((await first).status).toBe(204);
      await post(server.hookUrl, ran);
      expect((await second).status).toBe(204);
    });

    it('lets the dialog go once the call runs, as when the terminal was answered first', async () => {
      await server.start();
      const { permit, signals } = dialog();
      server.listen(TOKEN, () => {}, { permit, context: { workspace: '/work' } });
      const held = post(server.hookUrl, prompted);
      await vi.waitFor(() => expect(signals).toHaveLength(1));
      // Another call to the same tool is no answer to this one.
      await post(server.hookUrl, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { ...input, content: 'Other' },
      });
      expect(signals[0]?.aborted).toBe(false);
      // Claude Code says the call ran, its input in any order.
      await post(server.hookUrl, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { content: 'Hello', file_path: '/work/notes/a.md' },
        tool_response: { type: 'create' },
      });
      expect(signals[0]?.aborted).toBe(true);
      expect((await held).status).toBe(204);
    });

    it('lets no other prompt go when a call allowed in the app runs', async () => {
      await server.start();
      const { permit, answer, signals } = dialog();
      server.listen(TOKEN, () => {}, { permit, context: { workspace: '/work' } });
      const first = post(server.hookUrl, prompted);
      const second = post(server.hookUrl, prompted);
      await vi.waitFor(() => expect(signals).toHaveLength(2));
      await answer({ allow: true });
      expect((await first).status).toBe(200);
      // The first call runs, as allowed: the second, just like it, still waits on the user.
      const ran = { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: input };
      await post(server.hookUrl, ran);
      expect(signals[1]?.aborted).toBe(false);
      await post(server.hookUrl, ran);
      expect(signals[1]?.aborted).toBe(true);
      expect((await second).status).toBe(204);
    });

    it('lets everything go once the run moves on, or answers the terminal from the dialog', async () => {
      await server.start();
      const { permit, signals, answer } = dialog();
      server.listen(TOKEN, () => {}, { permit, context: { workspace: '/work' } });
      const first = post(server.hookUrl, prompted);
      await vi.waitFor(() => expect(signals).toHaveLength(1));
      await post(server.hookUrl, { hook_event_name: 'Stop' });
      expect((await first).status).toBe(204);
      const second = post(server.hookUrl, prompted);
      await answer(null);
      expect((await second).status).toBe(204);
    });

    it('leaves to the terminal what it can’t show, a subagent’s request, and a run with no dialog', async () => {
      await server.start();
      const { permit } = dialog();
      const other = 'f'.repeat(64);
      server.listen(TOKEN, () => {}, { permit, context: { workspace: '/work' } });
      server.listen(other, () => {});
      const bash = { ...prompted, tool_name: 'Bash', tool_input: { command: 'ls' } };
      expect((await post(server.hookUrl, bash)).status).toBe(204);
      expect((await post(server.hookUrl, { ...prompted, agent_id: 'research' })).status).toBe(204);
      expect(
        (await post(server.hookUrl, prompted, { Authorization: `Bearer ${other}` })).status,
      ).toBe(204);
      expect(permit).not.toHaveBeenCalled();
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
    expect((await post(server.activityUrl, {}, { Origin: 'https://evil.example' })).status).toBe(
      404,
    );
    const stream = await fetch(server.toolsUrl, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(stream.status).toBe(405);
    stopListening();
    expect((await post(server.hookUrl, { hook_event_name: 'Stop' })).status).toBe(404);
    expect(listener).not.toHaveBeenCalled();
  });
});
