import { SyncError } from '@factwright/sync';

/** The app's name in sign-in. The server takes device codes from it only. */
const CLIENT_ID = 'factwright-desktop';

/** A code waiting for the user to approve it in their browser. */
export interface PendingSignIn {
  /** The short code the user checks matches in the browser, such as "WDJB-MJHT". */
  code: string;
  /** The page to open, with the code filled in. */
  url: string;
  /** When the code stops working, as an ISO time. */
  expiresAt: string;
}

export type SignInResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'denied' | 'expired' | 'canceled' | 'failed'; message: string };

export interface SignInDeps {
  /** The sync server's address. */
  server: string;
  /** What the app says it is, with the computer's name, so the account page can name it. */
  userAgent: string;
  fetch?: typeof fetch;
  /** Waits between checks. Tests skip the wait. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** "WDJBMJHT" as "WDJB-MJHT", easier to compare at a glance. */
const spaced = (code: string) =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/**
 * Signs the app in through the user's browser, with a device code (RFC 8628). The app asks the
 * server for a code, the user opens the page in their browser, signs in with GitHub or Google,
 * checks the code matches what the app shows, and approves. Meanwhile the app asks every few
 * seconds whether they have, and gets its own session once they do.
 */
export class DeviceSignIn {
  private readonly deps: SignInDeps;
  private readonly stopper = new AbortController();
  private deviceCode = '';
  private interval = 5;
  private expires = 0;

  constructor(deps: SignInDeps) {
    this.deps = deps;
  }

  private async post(
    path: string,
    body: object,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await (this.deps.fetch ?? fetch)(new URL(path, this.deps.server), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': this.deps.userAgent },
      body: JSON.stringify(body),
      signal: this.stopper.signal,
    });
    const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body: answer };
  }

  /** Asks the server for a code for the user to approve. */
  async start(): Promise<PendingSignIn> {
    let answer: { status: number; body: Record<string, unknown> };
    try {
      answer = await this.post('/api/auth/device/code', { client_id: CLIENT_ID });
    } catch (error) {
      throw new SyncError('offline', `Couldn’t reach the sync server: ${String(error)}`);
    }
    const { status, body } = answer;
    if (status === 429) {
      throw new SyncError('slow-down', 'Too many sign-ins at once. Wait a minute, then try again.');
    }
    const { device_code, user_code, verification_uri_complete, interval, expires_in } = body;
    if (
      status !== 200 ||
      typeof device_code !== 'string' ||
      typeof user_code !== 'string' ||
      typeof verification_uri_complete !== 'string'
    ) {
      throw new SyncError('server', 'The sync server didn’t give a sign-in code.', status);
    }
    this.deviceCode = device_code;
    this.interval = typeof interval === 'number' && interval > 0 ? interval : 5;
    const seconds = typeof expires_in === 'number' ? expires_in : 600;
    this.expires = Date.now() + seconds * 1000;
    return {
      code: spaced(user_code),
      url: verification_uri_complete,
      expiresAt: new Date(this.expires).toISOString(),
    };
  }

  /** Waits for the user to approve the code, and gets the app's session once they do. */
  async finish(): Promise<SignInResult> {
    const { signal } = this.stopper;
    while (!signal.aborted) {
      if (Date.now() > this.expires) {
        return { ok: false, reason: 'expired', message: 'The sign-in code ran out. Try again.' };
      }
      await (this.deps.sleep ?? sleep)(this.interval * 1000, signal);
      if (signal.aborted) break;
      let answer: { status: number; body: Record<string, unknown> };
      try {
        answer = await this.post('/api/auth/device/token', {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: this.deviceCode,
          client_id: CLIENT_ID,
        });
      } catch {
        // Offline for a moment: keep waiting.
        continue;
      }
      const { access_token, error } = answer.body;
      if (typeof access_token === 'string') return { ok: true, token: access_token };
      // Asking too often, by the server's interval or its limit on requests: ask less often.
      if (error === 'slow_down' || answer.status === 429) this.interval += 5;
      else if (error === 'access_denied') {
        return { ok: false, reason: 'denied', message: 'Signing in was declined in the browser.' };
      } else if (error === 'expired_token') {
        return { ok: false, reason: 'expired', message: 'The sign-in code ran out. Try again.' };
      } else if (error !== 'authorization_pending') {
        return { ok: false, reason: 'failed', message: 'The sync server couldn’t sign you in.' };
      }
    }
    return { ok: false, reason: 'canceled', message: 'Signing in was canceled.' };
  }

  cancel(): void {
    this.stopper.abort();
  }

  /** Whether the user canceled, even after the browser said yes. */
  get canceled(): boolean {
    return this.stopper.signal.aborted;
  }
}
