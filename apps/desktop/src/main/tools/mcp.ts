import type { RunScope } from '../../shared/runs.ts';

/** The run calling a tool: what it was started for, and what it has saved so far. */
export interface ToolCall {
  scope: RunScope;
  /** The templates this run saved, which it may change again. */
  templates: Set<string>;
}

/** A call from no run in particular, such as a test's: a run on the job hunt. */
export const huntCall = (): ToolCall => ({ scope: 'hunt', templates: new Set() });

/** A tool Claude can call: its name, what it's for, what it takes, and what it does. */
export interface McpTool {
  name: string;
  /** Tells Claude when to use the tool. */
  description: string;
  /** The tool's input, as JSON Schema. */
  inputSchema: Record<string, unknown>;
  /** Hints for Claude Code: whether the tool only reads, and whether it reaches the internet. */
  annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  /** Runs the tool and says what happened, in words for Claude. Throwing reports an error. */
  run(input: Record<string, unknown>, call?: ToolCall): Promise<string>;
}

/** What to send back: a status, and a JSON body unless the message needs no answer. */
export interface McpAnswer {
  status: 200 | 202 | 400;
  body?: unknown;
}

/** The protocol version answered when the client doesn't ask for one. */
const LATEST_VERSION = '2025-06-18';

type Id = string | number | null;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const result = (id: Id, value: unknown) => ({ jsonrpc: '2.0', id, result: value });
const failure = (id: Id, code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

async function answerOne(
  message: unknown,
  tools: readonly McpTool[],
  server: { name: string; version: string; instructions: string },
  call: ToolCall,
): Promise<unknown | null> {
  if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return failure(null, -32600, 'Not a JSON-RPC 2.0 request.');
  }
  // Notifications, such as notifications/initialized, need no answer.
  if (message.id === undefined) return null;
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;
  const params = isObject(message.params) ? message.params : {};
  switch (message.method) {
    case 'initialize':
      return result(id, {
        // Every version so far supports the plain tools this server has, so it answers in kind.
        protocolVersion:
          typeof params.protocolVersion === 'string' ? params.protocolVersion : LATEST_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
        instructions: server.instructions,
      });
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, {
        tools: tools.map(({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          ...(annotations && { annotations }),
        })),
      });
    case 'tools/call': {
      const tool = tools.find((each) => each.name === params.name);
      if (!tool) return failure(id, -32602, `There's no tool named ${String(params.name)}.`);
      const input = isObject(params.arguments) ? params.arguments : {};
      try {
        return result(id, { content: [{ type: 'text', text: await tool.run(input, call) }] });
      } catch (error) {
        const text = error instanceof Error ? error.message : 'The tool failed.';
        return result(id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return failure(id, -32601, `Factwright's tools don't handle ${message.method}.`);
  }
}

/**
 * Answers one MCP message sent over HTTP: initialize, ping, and listing or calling a tool.
 * Notifications get 202 with no body. A batch, which older clients send, gets a batch back.
 */
export async function answerMcp(
  message: unknown,
  tools: readonly McpTool[],
  server: { name: string; version: string; instructions: string },
  call: ToolCall = huntCall(),
): Promise<McpAnswer> {
  if (Array.isArray(message)) {
    if (message.length === 0) return { status: 400, body: failure(null, -32600, 'Empty batch.') };
    const answers = await Promise.all(message.map((each) => answerOne(each, tools, server, call)));
    const sent = answers.filter((answer) => answer !== null);
    return sent.length > 0 ? { status: 200, body: sent } : { status: 202 };
  }
  const answer = await answerOne(message, tools, server, call);
  return answer === null ? { status: 202 } : { status: 200, body: answer };
}
