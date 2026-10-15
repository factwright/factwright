import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FiledFacts } from '../../shared/facts.ts';
import type { RunScope } from '../../shared/runs.ts';
import { TOOLS_INSTRUCTIONS } from '../tools/index.ts';
import { answerMcp, type McpAnswer, type McpTool, newCall, type ToolCall } from '../tools/mcp.ts';
import { bearerToken, parseJson } from './signals.ts';

const MAX_BODY_BYTES = 1_000_000;

export interface RunServerOptions {
  /** The tools Claude Code may call during a run. */
  tools: readonly McpTool[];
  /** The app's version, which the tools report to Claude Code. */
  version: string;
}

/** Hears one run's hook events, as Claude Code sends them. */
export type HookListener = (event: unknown) => void;

/** Hears which MCP methods a run calls, such as "tools/list", before they're answered. */
export type ToolsListener = (method: string) => void;

interface RunListeners {
  hooks: HookListener;
  tools: ToolsListener | undefined;
  /** What the run is for, what it's saved, and what the user answered, which its tool calls carry. */
  call: ToolCall;
}

/** What else a run's listener hears, and what the run is for. */
export interface ListenOptions {
  /** Hears which MCP methods the run calls. */
  tools?: ToolsListener;
  /** What the run may change without asking. Every run but getting started is "hunt". */
  scope?: RunScope;
  /** Hears each time the run files something in the fact bank from the user's answers. */
  onFiled?: (filed: FiledFacts) => void;
}

/**
 * Listens on this computer for a Claude Code run's hooks, which it passes to that run's
 * listener, and its calls to Factwright's tools, over MCP. Each run gets its own token, and
 * requests without a live run's token are refused, as is anything a web page sends.
 */
export class RunServer {
  private readonly options: RunServerOptions;
  private readonly listeners = new Map<string, RunListeners>();
  private server: Server | undefined;
  /** Where Claude Code sends its hooks. Set once the server is listening. */
  hookUrl = '';
  /** Where Claude Code calls Factwright's tools. Set once the server is listening. */
  toolsUrl = '';

  constructor(options: RunServerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    const server = createServer((request, response) => this.handle(request, response));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    this.hookUrl = `${origin}/hook`;
    this.toolsUrl = `${origin}/mcp`;
  }

  stop(): void {
    this.server?.close();
  }

  /**
   * Takes a run's hooks, and maybe its tool calls, by its token, until the returned function is
   * called. Its tools know what it was started for, and the questions the user answered in it,
   * which its hooks report.
   */
  listen(token: string, hooks: HookListener, options: ListenOptions = {}): () => void {
    const { tools, scope = 'hunt', onFiled } = options;
    this.listeners.set(token, { hooks, tools, call: newCall(scope, onFiled) });
    return () => this.listeners.delete(token);
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const listener = this.listenerFor(bearerToken(request.headers.authorization));
    // Claude Code never sends an Origin header; a web page always does.
    if (!listener || request.headers.origin !== undefined) {
      response.writeHead(404).end();
      return;
    }
    if (request.url === '/mcp' && request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    if (request.method !== 'POST' || (request.url !== '/hook' && request.url !== '/mcp')) {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) request.destroy();
    });
    request.on('end', () => {
      if (request.url === '/hook') {
        const event = parseJson(body);
        // Heard before Claude Code carries on, so an answer is on record before Claude reads it.
        // A hook the record can't take is one it doesn't keep, and Claude Code still hears back.
        try {
          listener.call.questions.hear(event);
        } catch {
          // Nothing kept: a filing tool then finds no record, and saves nothing.
        }
        // An empty answer lets Claude Code carry on as it would have.
        response.writeHead(204).end();
        listener.hooks(event);
        return;
      }
      if (listener.tools) {
        const parsed = parseJson(body);
        for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
          const method = (message as { method?: unknown } | null)?.method;
          if (typeof method === 'string') listener.tools(method);
        }
      }
      void this.answerTools(body, response, listener.call);
    });
  }

  private async answerTools(body: string, response: ServerResponse, call: ToolCall): Promise<void> {
    let answer: McpAnswer;
    try {
      answer = await answerMcp(
        parseJson(body),
        this.options.tools,
        { name: 'factwright', version: this.options.version, instructions: TOOLS_INSTRUCTIONS },
        call,
      );
    } catch {
      // Tools report their own failures, so this is a bug: say so rather than leave Claude waiting.
      response.writeHead(500).end();
      return;
    }
    if (answer.body === undefined) {
      response.writeHead(answer.status).end();
      return;
    }
    response
      .writeHead(answer.status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(answer.body));
  }

  private listenerFor(token: string | null): RunListeners | undefined {
    if (!token) return undefined;
    for (const [known, listener] of this.listeners) {
      if (timingSafeEqual(Buffer.from(known), Buffer.from(token))) return listener;
    }
    return undefined;
  }
}
