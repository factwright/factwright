import { SyncClient } from '@factwright/sync';

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

/** Who's signed in on this browser, or null. */
export async function getSession(): Promise<Session | null> {
  const response = await fetch('/api/auth/get-session');
  if (!response.ok) return null;
  const answer = (await response.json()) as Session | null;
  return answer?.user ? answer : null;
}

/** The ways to sign in that the server has set up. */
export async function signInOptions(): Promise<Provider[]> {
  const response = await fetch('/api/sign-in-options');
  if (!response.ok) return [];
  const { providers } = (await response.json()) as { providers: Provider[] };
  return providers;
}

/** Goes to GitHub or Google to sign in, then comes back to this page. */
export async function signIn(provider: Provider, returnTo: string): Promise<void> {
  const response = await post('/api/auth/sign-in/social', { provider, callbackURL: returnTo });
  const { url } = (await response.json()) as { url?: string };
  if (url) location.assign(url);
}

export async function signOut(): Promise<void> {
  await post('/api/auth/sign-out');
}

/** What the server says about a code the desktop app shows, once this account has opened it. */
export type DeviceCode =
  | { ok: true; status: 'pending' | 'approved' | 'denied' }
  | { ok: false; message: string };

/** Opens a code the app shows, which ties it to this account until it's answered. */
export async function openDeviceCode(userCode: string): Promise<DeviceCode> {
  const response = await fetch(`/api/auth/device?${new URLSearchParams({ user_code: userCode })}`);
  const answer = (await response.json().catch(() => ({}))) as { status?: unknown; error?: unknown };
  if (
    response.ok &&
    (answer.status === 'pending' || answer.status === 'approved' || answer.status === 'denied')
  ) {
    return { ok: true, status: answer.status };
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
export async function answerDeviceCode(userCode: string, allow: boolean): Promise<boolean> {
  const response = await post(allow ? '/api/auth/device/approve' : '/api/auth/device/deny', {
    userCode,
  });
  return response.ok;
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
