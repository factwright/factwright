import {
  askValues,
  CLIENTS,
  EXTENSION_SIGN_IN,
  type ExtensionAsk,
  type Feature,
  isLegal,
  knownFeatures,
  type Legal,
  SyncClient,
  SyncError,
} from '@factwright/sync';

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
 * What the server offers: the ways to sign in it has set up, what more it can do, the return
 * addresses Save to Factwright's sign-in window may go back to, and the terms and privacy policy
 * signing in agrees to, which a server of your own doesn't have.
 */
export interface ServerOptions {
  providers: Provider[];
  features: Feature[];
  extensionRedirects: string[];
  legal: Legal | null;
}

/** What the server offers. One that can't say offers nothing. */
export async function signInOptions(): Promise<ServerOptions> {
  const response = await fetch('/api/sign-in-options').catch(() => null);
  if (!response?.ok) return { providers: [], features: [], extensionRedirects: [], legal: null };
  const {
    providers = [],
    features = [],
    extensionRedirects = [],
    legal,
  } = (await response.json().catch(() => ({}))) as {
    providers?: Provider[];
    features?: unknown;
    extensionRedirects?: unknown;
    legal?: unknown;
  };
  return {
    providers,
    features: knownFeatures(features),
    extensionRedirects: Array.isArray(extensionRedirects)
      ? extensionRedirects.filter((each) => typeof each === 'string')
      : [],
    legal: isLegal(legal) ? legal : null,
  };
}

/**
 * Goes to GitHub or Google to sign in, then comes back to this page. When it doesn't work, it
 * still comes back here, with why in the address (see sign-in-errors.ts). When it can't start,
 * says why, for the page to show. `beforeGoing` runs once it has started, just before the
 * browser goes, such as to sign out of the account that's signed in now. It mustn't throw.
 */
export async function signIn(
  provider: Provider,
  returnTo: string,
  beforeGoing?: () => Promise<void>,
): Promise<string | null> {
  try {
    const response = await post('/api/auth/sign-in/social', {
      provider,
      callbackURL: returnTo,
      errorCallbackURL: returnTo,
    });
    const { url } = (await response.json().catch(() => ({}))) as { url?: unknown };
    if (response.ok && typeof url === 'string') {
      await beforeGoing?.();
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
 * Why Stripe's checkout, or its page for managing a subscription (the portal), couldn't open, in
 * plain words.
 */
export function payingProblem(error: unknown, page: 'checkout' | 'portal'): string {
  if (error instanceof SyncError) {
    if (error.kind === 'offline') return 'Can’t reach Factwright right now. Check your connection.';
    if (error.kind === 'slow-down') {
      return 'A checkout just started. Wait a few seconds, then try again.';
    }
    if (error.kind === 'not-found') {
      return page === 'checkout'
        ? 'Sync here doesn’t need a subscription.'
        : 'There’s no subscription to manage on this account.';
    }
  }
  return page === 'checkout'
    ? 'Stripe’s checkout couldn’t open. Try again in a moment.'
    : 'Stripe’s page for your subscription couldn’t open. Try again in a moment.';
}

/**
 * What the server says about a code the desktop app or the browser extension shows, once this
 * account has opened it, and which of them asked.
 */
export type DeviceCode =
  | { ok: true; status: 'pending' | 'approved' | 'denied'; asker: 'app' | 'extension' }
  | { ok: false; message: string };

/** What the page says about a code another account opened first, which only it can answer. */
export const TAKEN =
  'That code was opened with another account. In Factwright, start signing in again.';

/**
 * Opens a code the app shows, which ties it to this account until it's answered, or until this
 * account lets go of it (see releaseDeviceCode). Only the account it's tied to can answer it.
 */
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
    // Sign-in says who asked only to the account the code is tied to.
    if (answer.client_id === undefined) return { ok: false, message: TAKEN };
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

/**
 * Lets the app sign in, or turns it away. "sign-in" means this browser needs to sign in here
 * first, and "taken" that the code is another account's.
 */
export async function answerDeviceCode(
  userCode: string,
  allow: boolean,
): Promise<'answered' | 'sign-in' | 'taken' | 'failed'> {
  const response = await post(allow ? '/api/auth/device/approve' : '/api/auth/device/deny', {
    userCode,
  });
  if (response.ok) return 'answered';
  // Signed out since the page opened.
  if (response.status === 401) return 'sign-in';
  if (response.status !== 403) return 'failed';
  // Sign-in's own refusal: another account opened the code first. Otherwise, only a session from
  // signing in here, in the browser, may let a computer in.
  const { error } = (await response.json().catch(() => ({}))) as { error?: unknown };
  return error === 'access_denied' ? 'taken' : 'sign-in';
}

/**
 * Lets go of a code this account opened but hasn't answered, so the account signed in next can
 * open it, for someone who opened it signed in to the wrong account.
 */
export async function releaseDeviceCode(userCode: string): Promise<void> {
  await post('/api/account/device-codes/release', { userCode });
}

/**
 * What happened to an answer for Save to Factwright: where to go with it, to its return address,
 * or why it can't go. "sign-in" means this browser needs to sign in here first.
 */
export type ExtensionAnswer =
  | { ok: true; url: string }
  | { ok: false; reason: 'sign-in' }
  | { ok: false; reason: 'problem'; message: string };

/**
 * Lets Save to Factwright sign in, or doesn't. The server gives the address its answer goes to,
 * which is the return address it was asked for, and nothing else.
 */
export async function answerExtension(ask: ExtensionAsk, allow: boolean): Promise<ExtensionAnswer> {
  let response: Response;
  try {
    response = await post(EXTENSION_SIGN_IN.answer, { ...askValues(ask), allow });
  } catch {
    return {
      ok: false,
      reason: 'problem',
      message: 'Can’t reach Factwright right now. Check your connection, then try again.',
    };
  }
  const { url } = (await response.json().catch(() => ({}))) as { url?: unknown };
  if (response.ok && typeof url === 'string' && url.startsWith(`${ask.redirect}#`)) {
    return { ok: true, url };
  }
  // Signed out since the page opened, or a session that can't let anything in.
  if (response.status === 401 || response.status === 403) return { ok: false, reason: 'sign-in' };
  return {
    ok: false,
    reason: 'problem',
    message:
      response.status === 429
        ? 'That’s a lot of tries in a row. Wait a minute, then try again.'
        : 'That didn’t go through. Close this window, and sign in again from Save to Factwright’s setup.',
  };
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
