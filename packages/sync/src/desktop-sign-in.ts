import { randomBytes, toBase64Url } from './bytes.ts';
import { CHALLENGE, CODE, challengeOf, STATE } from './extension-sign-in.ts';
import { CLIENTS } from './protocol.ts';
import type { SignInResult } from './sign-in.ts';

/**
 * The desktop app's sign-in through the browser with nothing to compare, as it signs in to a
 * server of your own: an authorization code (RFC 6749) for an app on a computer (RFC 8252), tied
 * to it with PKCE (RFC 7636, S256) and state. The app listens on the computer's own loopback
 * address, 127.0.0.1, at a port of its own, and opens the server's page in the browser, where the
 * person signs in if they aren't, and allows it. The page then sends the browser back to the app,
 * at that address, with a code. Only the verifier the app kept turns the code into its session,
 * once, within two minutes.
 *
 * A device code is only as good as the person's check that the page shows the code the app does.
 * A server of your own that misbehaved could get a code from Factwright's sync, give it to the
 * app as its own, and send the browser on to Factwright's page, where the two match. Here, the
 * answer names the server that gave it (`iss`, RFC 9207), and the app takes it only from the
 * server it asked, before it sends the code anywhere.
 */

/** Where each part of it lives: on a sync server, and on the computer, for the way back. */
export const DESKTOP_SIGN_IN = {
  /** The web view's page that asks, which the app opens in the browser. */
  page: '/sign-in/desktop',
  /** Where that page gets the app its answer: a code once it's allowed, or a no. */
  answer: '/api/auth/desktop/authorize',
  /** Where the app trades the code and its verifier for its own session. */
  token: '/api/auth/desktop/token',
  /** Where the browser comes back to the app, at the port it listens on. */
  back: '/signed-in',
} as const;

/** The app's address on the computer: http, 127.0.0.1, a port, and the one path. */
const LOOPBACK = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/signed-in$/;

/** The address the app listens at, at `port`, for the browser to come back to. */
export const loopbackReturn = (port: number): string =>
  `http://127.0.0.1:${port}${DESKTOP_SIGN_IN.back}`;

/**
 * Whether a return address is one the desktop app listens at, exactly as it makes them: on the
 * computer the browser runs on, which nothing else can reach, at any port, as RFC 8252 has it.
 */
export function isLoopbackReturn(redirect: unknown): redirect is string {
  if (typeof redirect !== 'string') return false;
  const port = LOOPBACK.exec(redirect)?.[1];
  return port !== undefined && Number(port) <= 65_535;
}

/** What the page asks, as its address carries it: where the answer goes, and its ties. */
export interface DesktopAsk {
  /** The app's address on the computer, at its port (loopbackReturn). */
  redirect: string;
  /** The verifier's S256 challenge, which the code is tied to. */
  challenge: string;
  /** The app's own random value, which comes back with the answer, unchanged. */
  state: string;
}

/** The page's address, asking for an ask. */
export function desktopAskUrl(server: string, ask: DesktopAsk): string {
  const url = new URL(DESKTOP_SIGN_IN.page, server);
  url.search = new URLSearchParams(desktopAskValues(ask)).toString();
  return url.toString();
}

/**
 * An ask, from the page's address or the server's request, or null when anything's missing or out
 * of shape: the desktop app alone, coming back to it on the computer, and a code tied to an S256
 * challenge, and a state.
 */
export function readDesktopAsk(values: Readonly<Record<string, unknown>>): DesktopAsk | null {
  const { client_id, response_type, redirect_uri, code_challenge, code_challenge_method, state } =
    values;
  if (
    client_id !== CLIENTS.desktop ||
    response_type !== 'code' ||
    code_challenge_method !== 'S256' ||
    !isLoopbackReturn(redirect_uri) ||
    typeof code_challenge !== 'string' ||
    !CHALLENGE.test(code_challenge) ||
    typeof state !== 'string' ||
    !STATE.test(state)
  ) {
    return null;
  }
  return { redirect: redirect_uri, challenge: code_challenge, state };
}

/** What an ask's address carries, by name. */
const ASK_FIELDS = [
  'client_id',
  'response_type',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
] as const;

/**
 * An ask from the page's address, as readDesktopAsk takes it, or null when any of its fields comes
 * twice, which the page and the server could each read a different way.
 */
export function readDesktopAskQuery(query: URLSearchParams): DesktopAsk | null {
  if (ASK_FIELDS.some((field) => query.getAll(field).length > 1)) return null;
  return readDesktopAsk(Object.fromEntries(query));
}

/** An ask's values, as its address carries them, and as the page sends them with its answer. */
export const desktopAskValues = (ask: DesktopAsk) => ({
  client_id: CLIENTS.desktop,
  response_type: 'code',
  redirect_uri: ask.redirect,
  code_challenge: ask.challenge,
  code_challenge_method: 'S256',
  state: ask.state,
});

/** What an answer at the app's address carries, by name. */
const ANSWER_FIELDS = ['code', 'error', 'state', 'iss'] as const;

/**
 * The answer at the app's address, read from its query, or null when it isn't one for this
 * address and state: another sign-in's, as from a tab left open, or anyone else's.
 */
function readAnswer(returned: string, redirect: string, state: string): URLSearchParams | null {
  if (!URL.canParse(returned)) return null;
  const url = new URL(returned);
  const answer = url.searchParams;
  if (
    `${url.origin}${url.pathname}` !== redirect ||
    ANSWER_FIELDS.some((field) => answer.getAll(field).length > 1) ||
    answer.get('state') !== state
  ) {
    return null;
  }
  return answer;
}

/** A server's address as people know it, such as sync.example.com, or null for anything else. */
function hostOf(address: string | null): string | null {
  if (!address || !URL.canParse(address)) return null;
  const url = new URL(address);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.host : null;
}

export interface LoopbackSignInDeps {
  /** The sync server's address. */
  server: string;
  /** The app's address on the computer, where the browser comes back to it (loopbackReturn). */
  redirect: string;
  /** What the app says it is, with the computer's name, so the account page can name it. */
  userAgent?: string;
  fetch?: typeof fetch;
}

/** How long the server has to trade a code, in milliseconds, while the browser waits for the app. */
const TRADE_MS = 15_000;

/**
 * Signs the desktop app in through the browser, which comes back to it on the computer: `start`
 * gives the page to open, and `finish` takes the address the browser came back to, and trades its
 * code for the app's session. Listening for the browser is the app's to do.
 */
export class LoopbackSignIn {
  private readonly deps: LoopbackSignInDeps;
  private readonly verifier = toBase64Url(randomBytes(32));
  private readonly state = toBase64Url(randomBytes(16));

  constructor(deps: LoopbackSignInDeps) {
    this.deps = deps;
  }

  /** The page to open in the browser. */
  async start(): Promise<string> {
    return desktopAskUrl(this.deps.server, {
      redirect: this.deps.redirect,
      challenge: await challengeOf(this.verifier),
      state: this.state,
    });
  }

  /**
   * Whether the browser came back with this sign-in's answer: at its address, with its state.
   * Anything else isn't its to take, or to end it.
   */
  isFor(returned: string): boolean {
    return readAnswer(returned, this.deps.redirect, this.state) !== null;
  }

  /**
   * Reads the answer the browser came back with, and gets the app's session for a code. It must
   * name the server this sign-in went to: a code another server gave never leaves the app.
   */
  async finish(returned: string): Promise<SignInResult> {
    const answer = readAnswer(returned, this.deps.redirect, this.state);
    if (!answer) {
      return {
        ok: false,
        reason: 'failed',
        message: 'That sign-in didn’t come back as it should.',
      };
    }
    const issuer = new URL(this.deps.server).origin;
    const iss = answer.get('iss');
    if (iss !== issuer) {
      const from = hostOf(iss);
      return {
        ok: false,
        reason: 'failed',
        message: from
          ? `That sign-in came back from ${from}, not ${new URL(issuer).host}, so Factwright didn’t use it.`
          : 'That sign-in didn’t come back as it should.',
      };
    }
    const code = answer.get('code');
    if (!code || !CODE.test(code)) {
      return answer.get('error') === 'access_denied'
        ? { ok: false, reason: 'denied', message: 'Signing in was declined in the browser.' }
        : { ok: false, reason: 'failed', message: 'That sign-in didn’t come back as it should.' };
    }
    let response: Response;
    try {
      response = await (this.deps.fetch ?? fetch)(
        new URL(DESKTOP_SIGN_IN.token, this.deps.server),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.deps.userAgent && { 'user-agent': this.deps.userAgent }),
          },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            code_verifier: this.verifier,
            client_id: CLIENTS.desktop,
            redirect_uri: this.deps.redirect,
          }),
          // The code and its verifier go to the server asked, and nowhere it sends them on to.
          redirect: 'error',
          signal: AbortSignal.timeout(TRADE_MS),
        },
      );
    } catch {
      return {
        ok: false,
        reason: 'failed',
        message: 'Couldn’t reach the sync server to finish signing in. Check the connection.',
      };
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok && typeof body.access_token === 'string') {
      return { ok: true, token: body.access_token };
    }
    if (response.status === 429) {
      return {
        ok: false,
        reason: 'failed',
        message: 'Too many sign-ins at once. Wait a minute, then try again.',
      };
    }
    return body.error === 'invalid_grant'
      ? { ok: false, reason: 'expired', message: 'That sign-in ran out. Try again.' }
      : { ok: false, reason: 'failed', message: 'The sync server couldn’t sign you in.' };
  }
}
