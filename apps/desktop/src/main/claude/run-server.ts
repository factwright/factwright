import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FiledFacts } from '../../shared/facts.ts';
import type { PermissionAnswer, PermissionAsk } from '../../shared/permission-asks.ts';
import type { QuestionRound, RoundReply } from '../../shared/rounds.ts';
import type { RunScope } from '../../shared/runs.ts';
import type { BoundRevision } from '../jobs/revisions.ts';
import { TOOLS_INSTRUCTIONS } from '../tools/index.ts';
import { answerMcp, type McpAnswer, type McpTool, newCall, type ToolCall } from '../tools/mcp.ts';
import { permissionAskFrom, permissionReply, toolKey } from './permission-asks.ts';
import { hookReply, roundFrom } from './rounds.ts';
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

/**
 * Asks the user a round of Claude's questions in the app: their answers, or null to have Claude
 * Code ask in the terminal. The signal aborts once Claude Code stops waiting.
 */
export type QuestionAsker = (
  round: QuestionRound,
  signal: AbortSignal,
) => Promise<RoundReply | null>;

/**
 * Asks the user in the app for the OK Claude Code is asking for: their answer, or null to have
 * Claude Code ask in the terminal. The signal aborts once Claude Code stops waiting.
 */
export type PermissionAsker = (
  ask: PermissionAsk,
  signal: AbortSignal,
) => Promise<PermissionAnswer | null>;

/** A call the user said no to in the app, by its tool and input, which never runs. */
export type DeniedListener = (call: { tool_name: string; tool_input: unknown }) => void;

/** The hooks after which nothing from before can still be waiting on the user. */
const MOVED_ON = ['UserPromptSubmit', 'Stop', 'SessionEnd'];

interface RunListeners {
  hooks: HookListener;
  tools: ToolsListener | undefined;
  ask: QuestionAsker | undefined;
  permit: PermissionAsker | undefined;
  onDenied: DeniedListener | undefined;
  /** The run's workspace, which the paths in its permission prompts are shown from. */
  workspace: string | undefined;
  /**
   * What's held for the run, waiting on the user, by the call each waits on when it's known. The
   * run lets all of them go once it stops listening.
   */
  held: Map<AbortController, string | null>;
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
  /** The revision the run was started for, which only its own tool calls can read. */
  revision?: BoundRevision;
  /** Asks the user Claude's questions in the app's dialog. Without it, the terminal asks them. */
  ask?: QuestionAsker;
  /** Asks the user for Claude Code's permission prompts in the app. Without it, the terminal does. */
  permit?: PermissionAsker;
  /** Hears each call the user said no to in the app, which never runs. */
  onDenied?: DeniedListener;
  /** The run's workspace, which the paths in its permission prompts are shown from. */
  workspace?: string;
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
   * which its hooks report. A run that stops listening, as when it ends, lets go of the questions
   * it was asking, so their dialog closes.
   */
  listen(token: string, hooks: HookListener, options: ListenOptions = {}): () => void {
    const { tools, scope = 'hunt', onFiled, revision, ask, permit, onDenied, workspace } = options;
    const held = new Map<AbortController, string | null>();
    this.listeners.set(token, {
      hooks,
      tools,
      ask,
      permit,
      onDenied,
      workspace,
      held,
      call: newCall(scope, onFiled, revision),
    });
    return () => {
      this.listeners.delete(token);
      for (const waiting of held.keys()) waiting.abort();
    };
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
        this.letGo(listener, event);
        const { ask, permit } = listener;
        const round = ask ? roundFrom(event) : null;
        const permission = !round && permit ? permissionAskFrom(event, listener.workspace) : null;
        if (ask && round) {
          void this.hold(
            listener,
            response,
            null,
            (signal) => ask(round.round, signal),
            (reply) => hookReply(round, reply),
          );
        } else if (permit && permission) {
          void this.hold(
            listener,
            response,
            permission.key,
            (signal) => permit(permission.ask, signal),
            permissionReply,
          ).then((answer) => {
            // A no means the call never runs, so nothing else says it's over.
            if (answer?.allow === false) {
              listener.onDenied?.({ tool_name: permission.tool, tool_input: permission.input });
            }
          });
        }
        // An empty answer lets Claude Code carry on as it would have.
        else response.writeHead(204).end();
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

  /**
   * Holds one of Claude Code's hooks until the user answers in the app's dialog, a round of
   * questions or a permission prompt, then answers the hook with what they said, so Claude Code
   * asks nothing in the terminal. Without an answer from the dialog, an empty answer has the
   * terminal ask, as before. When Claude Code stops waiting first, as when the user interrupts the
   * run or answers in the terminal, the hook's time runs out, or the run ends, the dialog lets it
   * go. Answers with what reached Claude Code, if anything.
   */
  private async hold<R>(
    listener: RunListeners,
    response: ServerResponse,
    key: string | null,
    wait: (signal: AbortSignal) => Promise<R | null>,
    reply: (answer: R) => unknown,
  ): Promise<R | null> {
    const stopped = new AbortController();
    listener.held.set(stopped, key);
    response.once('close', () => stopped.abort());
    let answer: R | null = null;
    try {
      answer = await wait(stopped.signal);
    } catch {
      // No answer: the terminal asks.
    } finally {
      listener.held.delete(stopped);
    }
    if (response.writableEnded || response.destroyed) return null;
    // What was let go, as when the run ends, takes no answer.
    if (answer === null || stopped.signal.aborted) {
      response.writeHead(204).end();
      return null;
    }
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(reply(answer)));
    return answer;
  }

  /**
   * Lets go of what the run no longer waits on: a permission prompt the user answered in the
   * terminal, as the call it asked about has run, or failed, and everything once the run moved on.
   * Claude Code doesn't drop a permission hook when the terminal is answered first.
   */
  private letGo(listener: RunListeners, event: unknown): void {
    if (typeof event !== 'object' || event === null || listener.held.size === 0) return;
    const fields = event as Record<string, unknown>;
    const name = fields.hook_event_name;
    if (typeof name === 'string' && MOVED_ON.includes(name)) {
      for (const waiting of listener.held.keys()) waiting.abort();
      return;
    }
    if (name !== 'PostToolUse' && name !== 'PostToolUseFailure') return;
    const ran = toolKey(fields.tool_name, fields.tool_input);
    for (const [waiting, key] of listener.held) {
      if (key !== null && key === ran) waiting.abort();
    }
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
