import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DESKTOP_SIGN_IN,
  LoopbackSignIn,
  loopbackReturn,
  type SignInResult,
} from '@factwright/sync';
import { DARK, LIGHT, type Palette } from '@factwright/ui/tokens';

/** How long signing in waits for the browser, as long as a device code lasts. */
const WAIT_MS = 10 * 60_000;

/** What a page the browser comes back to says, as a title and a line. */
interface Said {
  title: string;
  line: string;
}

/** Words in a page, with nothing in them read as HTML. */
const escaped = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );

/** A theme's colors, as the page's CSS variables. */
const colors = (theme: Palette) =>
  `--bg: ${theme.bg}; --card: ${theme.surface}; --border: ${theme.border}; --text: ${theme.text}; --muted: ${theme.muted};`;

/** Headers for every answer: each connection closes once answered, so none stays open after. */
const CLOSE = { connection: 'close' } as const;

/**
 * The page the browser shows once it's back, from this computer, so it's all here: no scripts,
 * nothing loaded from anywhere, and no address of this one sent on.
 */
function page(response: ServerResponse, status: number, { title, line }: Said): void {
  response.writeHead(status, {
    ...CLOSE,
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  response.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaped(title)} · Factwright</title>
<style>
  :root { color-scheme: light dark; ${colors(LIGHT)} }
  @media (prefers-color-scheme: dark) { :root { ${colors(DARK)} } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg);
    color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { box-sizing: border-box; width: min(28rem, calc(100% - 32px)); padding: 24px;
    border: 1px solid var(--border); border-radius: 14px; background: var(--card); }
  h1 { margin: 0 0 8px; font-size: 1.25rem; }
  p { margin: 0; color: var(--muted); }
</style>
</head>
<body>
<main>
<h1>${escaped(title)}</h1>
<p>${escaped(line)}</p>
</main>
</body>
</html>
`);
}

/** What the page says once a sign-in's answer is in. */
function saidFor(result: SignInResult): Said {
  if (result.ok) {
    return {
      title: 'Factwright is signed in',
      line: 'You can close this tab and go back to Factwright.',
    };
  }
  if (result.reason === 'denied') {
    return {
      title: 'Factwright won’t sign in',
      line: 'You turned it away. You can close this tab.',
    };
  }
  return {
    title: 'Factwright didn’t sign in',
    line: `${result.message} Go back to Factwright to try again.`,
  };
}

/** A page that isn't this sign-in's answer. */
const NOT_THIS: Said = {
  title: 'Factwright isn’t waiting for this',
  line: 'This isn’t the sign-in Factwright is waiting for. Go back to Factwright, and start signing in there again.',
};

export interface LoopbackFlowDeps {
  /** The sync server's address. */
  server: string;
  /** What the app says it is, with the computer's name, so the account page can name it. */
  userAgent?: string;
  fetch?: typeof fetch;
  /** How long it waits for the browser. Tests wait less. */
  waitMs?: number;
}

/** What finishing says once the user called signing in off. */
const CANCELED: SignInResult = {
  ok: false,
  reason: 'canceled',
  message: 'Signing in was canceled.',
};

/**
 * Signs the app in to a server of your own through the browser, with nothing to compare
 * (desktop-sign-in.ts in @factwright/sync): `start` listens on this computer's own loopback
 * address, at a port of its own, and gives the server's page to open, and `finish` waits for the
 * browser to come back with the answer. Nothing off this computer can reach that address. It
 * takes the first answer that's this sign-in's, and nothing else ends it: anything else gets a
 * page saying so, and it keeps waiting. The browser's page says how it went, once the code is
 * traded, and the address stops listening.
 */
export class LoopbackFlow {
  private readonly deps: LoopbackFlowDeps;
  private readonly stopper = new AbortController();
  private listening: Server | null = null;
  private flow: LoopbackSignIn | null = null;
  /** Whether this sign-in's answer came in, so a second one is turned away. */
  private answered = false;
  /** Whether it's over, with its result. */
  private done = false;
  private settle: (result: SignInResult) => void = () => {};
  private readonly result = new Promise<SignInResult>((resolve) => {
    this.settle = resolve;
  });
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: LoopbackFlowDeps) {
    this.deps = deps;
  }

  /** Starts listening, and gives the page to open in the browser. There's no code to show. */
  async start(): Promise<{ code: null; url: string }> {
    const server = createServer((request, response) => {
      // Whatever goes wrong with a request, it's answered, and the connection closes.
      this.hear(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500, CLOSE);
        response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      // Before it listens, it can't start. After, the sign-in ends, rather than the app.
      server.on('error', (error) => {
        if (!this.listening) reject(error);
        else {
          this.stopWaiting({
            ok: false,
            reason: 'failed',
            message: 'Factwright stopped waiting for your browser. Try again.',
          });
        }
      });
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.listening = server;
    // Called off while it started: it listens no more.
    if (this.done) this.stop();
    const { port } = server.address() as AddressInfo;
    const flow = new LoopbackSignIn({
      server: this.deps.server,
      redirect: loopbackReturn(port),
      ...(this.deps.userAgent && { userAgent: this.deps.userAgent }),
      ...(this.deps.fetch && { fetch: this.deps.fetch }),
    });
    this.flow = flow;
    return { code: null, url: await flow.start() };
  }

  /**
   * Waits for the browser to come back with this sign-in's answer, and gets the app's session.
   * One called off as its code was traded still says how the trade went, so a session it got
   * can be ended.
   */
  finish(): Promise<SignInResult> {
    if (!this.done && !this.timer) {
      this.timer = setTimeout(
        () =>
          this.stopWaiting({
            ok: false,
            reason: 'expired',
            message: 'The sign-in ran out. Try again.',
          }),
        this.deps.waitMs ?? WAIT_MS,
      );
    }
    return this.result;
  }

  cancel(): void {
    this.stopper.abort();
    this.stopWaiting(CANCELED);
  }

  /** Whether the user canceled, even after the browser came back. */
  get canceled(): boolean {
    return this.stopper.signal.aborted;
  }

  /**
   * Stops waiting for the browser, ending with `result`, unless an answer is being traded: that
   * ends it once the trade is done, with how it went, so a session it got is never dropped
   * unseen, and the app can end it.
   */
  private stopWaiting(result: SignInResult): void {
    if (this.answered) this.stop();
    else this.end(result);
  }

  /** Ends the wait, once, and stops listening. */
  private end(result: SignInResult): void {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    this.stop();
    this.settle(result);
  }

  /** Stops listening. A page being sent still goes. */
  private stop(): void {
    this.listening?.close();
  }

  private async hear(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const flow = this.flow;
    const port = (this.listening?.address() as AddressInfo | null)?.port;
    // Only the browser, at this address as the page sent it here: never another name for this
    // computer that a web page could have pointed at it.
    if (!flow || !port || request.headers.host !== `127.0.0.1:${port}`) {
      response.writeHead(400, CLOSE).end();
      return;
    }
    const here = `http://127.0.0.1:${port}`;
    if (!URL.canParse(request.url ?? '/', here)) {
      response.writeHead(400, CLOSE).end();
      return;
    }
    const url = new URL(request.url ?? '/', here);
    if (url.pathname !== DESKTOP_SIGN_IN.back) {
      response.writeHead(404, CLOSE).end();
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { ...CLOSE, allow: 'GET' }).end();
      return;
    }
    const returned = url.toString();
    if (this.answered || this.done || !flow.isFor(returned)) {
      page(response, 400, NOT_THIS);
      return;
    }
    this.answered = true;
    let result: SignInResult;
    try {
      result = await flow.finish(returned);
    } catch {
      result = { ok: false, reason: 'failed', message: 'The sync server couldn’t sign you in.' };
    }
    // Called off as the code was traded: Factwright ends what it got, and says how things stand.
    page(
      response,
      result.ok && !this.canceled ? 200 : 400,
      this.canceled
        ? {
            title: 'Factwright didn’t sign in',
            line: 'Signing in was canceled in Factwright. You can close this tab.',
          }
        : saidFor(result),
    );
    this.end(result);
  }
}
