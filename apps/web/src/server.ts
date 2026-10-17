import { CLIENTS, type Feature, isLegal, type Legal, SyncClient } from '@factwright/sync';

/** Who's signed in, as sign-in reports it. */
export interface Session {
  user: { id: string; email: string; name: string };
}

/** A sign-in service the server offers, such as GitHub. */
export type Provider = 'github' | 'google';

export const PROVIDER_NAMES: Readonly<Record<Provider, string>> = {
  github: 'GitHub',
  google: 'Google',
};

/** Talks to the sync server this page came from. The session is the page's cookie. */
export const client = new SyncClient({ server: location.origin });

async function post(path: string, body: object = {}): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Who's signed in on this browser: null when the server says no one is, or undefined when it
 * couldn't say, such as when it's busy.
 */
export async function getSession(): Promise<Session | null | undefined> {
  const response = await fetch('/api/auth/get-session').catch(() => null);
  if (!response?.ok) return undefined;
  const answer = (await response.json().catch(() => undefined)) as Session | null | undefined;
  if (answer === undefined) return undefined;
  return answer?.user ? answer : null;
}

/**
 * What the server offers: the ways to sign in it has set up, what more it can do, and the terms
 * and privacy policy signing in agrees to, which a server of your own doesn't have.
 */
export interface ServerOptions {
  providers: Provider[];
  features: Feature[];
  legal: Legal | null;
}

/** What the server offers. One that can't say offers nothing. */
export async function signInOptions(): Promise<ServerOptions> {
  const response = await fetch('/api/sign-in-options').catch(() => null);
  if (!response?.ok) return { providers: [], features: [], legal: null };
  const {
    providers = [],
    features = [],
    legal,
  } = (await response.json().catch(() => ({}))) as {
    providers?: Provider[];
    features?: unknown;
    legal?: unknown;
  };
  return {
    providers,
    features: Array.isArray(features) ? features.filter((each) => each === 'approve') : [],
    legal: isLegal(legal) ? legal : null,
  };
}

/**
 * Goes to GitHub or Google to sign in, then comes back to this page. When it can't start,
 * says why, for the page to show.
 */
export async function signIn(provider: Provider, returnTo: string): Promise<string | null> {
  try {
    const response = await post('/api/auth/sign-in/social', { provider, callbackURL: returnTo });
    const { url } = (await response.json().catch(() => ({}))) as { url?: unknown };
    if (response.ok && typeof url === 'string') {
      location.assign(url);
      return null;
    }
    return response.status === 429
      ? 'That’s a lot of tries in a row. Wait a minute, then try again.'
      : 'Signing in couldn’t start. Try again in a moment.';
  } catch {
    return 'Can’t reach Factwright right now. Check your connection.';
  }
}

export async function signOut(): Promise<void> {
  await post('/api/auth/sign-out');
}

/**
 * What the server says about a code the desktop app or the browser extension shows, once this
 * account has opened it, and which of them asked.
 */
export type DeviceCode =
  | { ok: true; status: 'pending' | 'approved' | 'denied'; asker: 'app' | 'extension' }
  | { ok: false; message: string };

/** Opens a code the app shows, which ties it to this account until it's answered. */
export async function openDeviceCode(userCode: string): Promise<DeviceCode> {
  const response = await fetch(`/api/auth/device?${new URLSearchParams({ user_code: userCode })}`);
  const answer = (await response.json().catch(() => ({}))) as {
    status?: unknown;
    error?: unknown;
    client_id?: unknown;
  };
  if (
    response.ok &&
    (answer.status === 'pending' || answer.status === 'approved' || answer.status === 'denied')
  ) {
    const asker = answer.client_id === CLIENTS.extension ? 'extension' : 'app';
    return { ok: true, status: answer.status, asker };
  }
  return {
    ok: false,
    message:
      answer.error === 'expired_token'
        ? 'That code ran out. In Factwright, start signing in again.'
        : 'That code didn’t work. In Factwright, start signing in again.',
  };
}

/** Lets the app sign in, or turns it away. */
export async function answerDeviceCode(
  userCode: string,
  allow: boolean,
): Promise<'answered' | 'sign-in' | 'failed'> {
  const response = await post(allow ? '/api/auth/device/approve' : '/api/auth/device/deny', {
    userCode,
  });
  if (response.ok) return 'answered';
  // Only a session from signing in here, in the browser, may let a computer in.
  return response.status === 403 ? 'sign-in' : 'failed';
}

/** Deletes the account and everything in it. "sign-in" means it needs a fresh sign-in first. */
export async function deleteAccount(): Promise<'deleted' | 'sign-in' | 'failed'> {
  const response = await post('/api/auth/delete-user');
  if (response.ok) return 'deleted';
  const answer = (await response.json().catch(() => ({}))) as { code?: unknown };
  return answer.code === 'SESSION_EXPIRED' || answer.code === 'SESSION_NOT_FRESH'
    ? 'sign-in'
    : 'failed';
}
