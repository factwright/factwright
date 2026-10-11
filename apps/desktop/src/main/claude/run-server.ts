import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TOOLS_INSTRUCTIONS } from '../tools/index.ts';
import { answerMcp, type McpAnswer, type McpTool } from '../tools/mcp.ts';
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

/**
 * Listens on this computer for a Claude Code run's hooks, which it passes to that run's
 * listener, and its calls to Factwright's tools, over MCP. Each run gets its own token, and
 * requests without a live run's token are refused, as is anything a web page sends.
 */
export class RunServer {
  private readonly options: RunServerOptions;
  private readonly listeners = new Map<string, HookListener>();
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

  listen(token: string, listener: HookListener): () => void {
    this.listeners.set(token, listener);
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
        // An empty answer lets Claude Code carry on as it would have.
        response.writeHead(204).end();
        listener(parseJson(body));
        return;
      }
      void this.answerTools(body, response);
    });
  }

  private async answerTools(body: string, response: ServerResponse): Promise<void> {
    let answer: McpAnswer;
    try {
      answer = await answerMcp(parseJson(body), this.options.tools, {
        name: 'factwright',
        version: this.options.version,
        instructions: TOOLS_INSTRUCTIONS,
      });
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

  private listenerFor(token: string | null): HookListener | undefined {
    if (!token) return undefined;
    for (const [known, listener] of this.listeners) {
      if (timingSafeEqual(Buffer.from(known), Buffer.from(token))) return listener;
    }
    return undefined;
  }
}
