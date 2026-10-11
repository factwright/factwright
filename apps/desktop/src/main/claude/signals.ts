import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RunSignal } from '../../shared/api.ts';

/** What a hook event from Claude Code means for the panel, or null when it changes nothing. */
export function signalFor(event: unknown): RunSignal | null {
  if (typeof event !== 'object' || event === null) return null;
  const fields = event as Record<string, unknown>;
  switch (fields.hook_event_name) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return 'working';
    case 'PreToolUse':
      return fields.tool_name === 'AskUserQuestion' ? 'needs-answer' : null;
    case 'PermissionRequest':
      return 'needs-answer';
    case 'Notification':
      return fields.notification_type === 'permission_prompt' ||
        fields.notification_type === 'elicitation_dialog'
        ? 'needs-answer'
        : null;
    case 'Stop':
      return 'done';
    default:
      return null;
  }
}

/** The token in an `Authorization: Bearer <token>` header, if there is one. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(header ?? '');
  return match?.[1] ?? null;
}

const MAX_BODY_BYTES = 1_000_000;

/**
 * Listens on this computer for Claude Code's hooks and turns them into signals for the panel.
 * Each run gets its own token, and requests without a live run's token are refused.
 */
export class SignalServer {
  private readonly listeners = new Map<string, (signal: RunSignal) => void>();
  private server: Server | undefined;
  /** Where Claude Code sends its hooks. Set once the server is listening. */
  url = '';

  async start(): Promise<void> {
    const server = createServer((request, response) => this.handle(request, response));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  }

  stop(): void {
    this.server?.close();
  }

  listen(token: string, listener: (signal: RunSignal) => void): () => void {
    this.listeners.set(token, listener);
    return () => this.listeners.delete(token);
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const listener = this.listenerFor(bearerToken(request.headers.authorization));
    if (request.method !== 'POST' || request.url !== '/hook' || !listener) {
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
      // An empty answer lets Claude Code carry on as it would have.
      response.writeHead(204).end();
      const signal = signalFor(parseJson(body));
      if (signal) listener(signal);
    });
  }

  private listenerFor(token: string | null): ((signal: RunSignal) => void) | undefined {
    if (!token) return undefined;
    for (const [known, listener] of this.listeners) {
      if (timingSafeEqual(Buffer.from(known), Buffer.from(token))) return listener;
    }
    return undefined;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
