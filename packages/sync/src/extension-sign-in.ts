import { randomBytes, toBase64Url, utf8 } from './bytes.ts';
import { CLIENTS } from './protocol.ts';
import type { SignInResult } from './sign-in.ts';

/**
 * Save to Factwright's sign-in through the browser's own window for extensions
 * (identity.launchWebAuthFlow), with nothing to compare: an authorization code (RFC 6749) for the
 * extension alone, tied to it with PKCE (RFC 7636, S256) and state. The browser opens the server's
 * page in a window of its own, where the person signs in if they aren't, and allows the extension.
 * The page then goes to the extension's return address, which the browser hands to the extension
 * that opened the window and no one else, with a code. Only the verifier the extension kept turns
 * that code into its session, once, within two minutes.
 */

/** Where each part of it lives on a sync server. */
export const EXTENSION_SIGN_IN = {
  /** The web view's page that asks, which the browser opens in its window. */
  page: '/sign-in/extension',
  /** Where that page gets the extension its answer: a code once it's allowed, or a no. */
  answer: '/api/auth/extension/authorize',
  /** Where the extension trades the code and its verifier for its own session. */
  token: '/api/auth/extension/token',
} as const;

/**
 * Save to Factwright's IDs in the stores: the Chrome Web Store's item, and the ID its manifest
 * gives Firefox. Each browser keeps an extension's return address for that ID alone.
 */
export const EXTENSION_IDS = {
  chrome: 'gjhjddlohoonikgdbfcfnljeffilblai',
  firefox: 'save@factwright.com',
} as const;

/** A Chrome extension's ID: 32 letters from a to p. */
const CHROME_ID = /^[a-p]{32}$/;

/** A Firefox add-on's ID: like an email address, or a GUID in braces. */
const FIREFOX_ID =
  /^(?:[a-z0-9._+-]{1,80}@[a-z0-9.-]{1,80}|\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\})$/i;

/**
 * Where an extension's window returns to, as the browser names it for that extension's ID alone,
 * and the extension reads with identity.getRedirectURL(): Chrome's is https://<ID>.chromiumapp.org/,
 * and Firefox's https://<SHA-1 of the ID, in hex>.extensions.allizom.org/. Null for anything that
 * isn't an extension's ID. Neither name is ever looked up: the browser takes the address before
 * anything is sent.
 */
export async function returnAddress(id: string): Promise<string | null> {
  if (CHROME_ID.test(id)) return `https://${id}.chromiumapp.org/`;
  if (!FIREFOX_ID.test(id)) return null;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', utf8(id)));
  const hex = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `https://${hex}.extensions.allizom.org/`;
}

/** The stores' copies' return addresses, which any server lets its window return to. */
export const STORE_RETURNS: readonly string[] = [
  'https://gjhjddlohoonikgdbfcfnljeffilblai.chromiumapp.org/',
  'https://3f1d1eb28d34ed53855b8a8b1a556111830e0649.extensions.allizom.org/',
];

/** What the page asks, as its address carries it: who for, where the answer goes, and its ties. */
export interface ExtensionAsk {
  /** The extension's return address, which the server must know as one of Save to Factwright's. */
  redirect: string;
  /** The verifier's S256 challenge, which the code is tied to. */
  challenge: string;
  /** The extension's own random value, which comes back with the answer, unchanged. */
  state: string;
}

/** A challenge: SHA-256 of a verifier, in URL-safe base64, 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** A state: at least 16 random bytes in URL-safe base64, and at most 128 characters. */
const STATE = /^[A-Za-z0-9_-]{22,128}$/;
/** A verifier, as RFC 7636 allows them: 43 to 128 characters from its list. */
export const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** A code the server hands out: 32 random bytes in URL-safe base64. */
export const CODE = /^[A-Za-z0-9_-]{43}$/;
/** The longest return address taken: a Firefox one is 72 characters. */
const REDIRECT_CHARS = 200;

/** The page's address, asking for an ask. */
export function askUrl(server: string, ask: ExtensionAsk): string {
  const url = new URL(EXTENSION_SIGN_IN.page, server);
  url.search = new URLSearchParams({
    client_id: CLIENTS.extension,
    response_type: 'code',
    redirect_uri: ask.redirect,
    code_challenge: ask.challenge,
    code_challenge_method: 'S256',
    state: ask.state,
  }).toString();
  return url.toString();
}

/**
 * An ask, from the page's address or the server's request, or null when anything's missing or out
 * of shape: Save to Factwright alone, a code tied to an S256 challenge, and a state. Whether the
 * return address is one the server knows is the server's to say.
 */
export function readAsk(values: Readonly<Record<string, unknown>>): ExtensionAsk | null {
  const { client_id, response_type, redirect_uri, code_challenge, code_challenge_method, state } =
    values;
  if (
    client_id !== CLIENTS.extension ||
    response_type !== 'code' ||
    code_challenge_method !== 'S256' ||
    typeof redirect_uri !== 'string' ||
    redirect_uri.length > REDIRECT_CHARS ||
    typeof code_challenge !== 'string' ||
    !CHALLENGE.test(code_challenge) ||
    typeof state !== 'string' ||
    !STATE.test(state)
  ) {
    return null;
  }
  return { redirect: redirect_uri, challenge: code_challenge, state };
}

/** An ask's values, as the page sends them to the server with its answer. */
export const askValues = (ask: ExtensionAsk) => ({
  client_id: CLIENTS.extension,
  response_type: 'code',
  redirect_uri: ask.redirect,
  code_challenge: ask.challenge,
  code_challenge_method: 'S256',
  state: ask.state,
});

/** A verifier's S256 challenge (RFC 7636): SHA-256 of its characters, in URL-safe base64. */
export async function challengeOf(verifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier))));
}

/**
 * The answer at the return address: in its fragment, which is never sent anywhere, even if the
 * browser didn't take the address first. The state must be this sign-in's own.
 */
function readAnswer(
  returned: string,
  redirect: string,
  state: string,
): { code: string } | { denied: boolean } {
  if (!returned.startsWith(redirect) || !URL.canParse(returned)) return { denied: false };
  const answer = new URLSearchParams(new URL(returned).hash.slice(1));
  if (answer.get('state') !== state) return { denied: false };
  const code = answer.get('code');
  if (code && CODE.test(code)) return { code };
  return { denied: answer.get('error') === 'access_denied' };
}

export interface WindowSignInDeps {
  /** The sync server's address. */
  server: string;
  /** The extension's return address, from identity.getRedirectURL(). */
  redirect: string;
  fetch?: typeof fetch;
}

/**
 * Signs Save to Factwright in through the browser's window: `start` gives the page to open in it,
 * and `finish` takes the address the window returned to, and trades its code for the extension's
 * session. The window itself is the extension's to open, since only it can.
 */
export class WindowSignIn {
  private readonly deps: WindowSignInDeps;
  private readonly verifier = toBase64Url(randomBytes(32));
  private readonly state = toBase64Url(randomBytes(16));

  constructor(deps: WindowSignInDeps) {
    this.deps = deps;
  }

  /** The page for the browser's window to open. */
  async start(): Promise<string> {
    return askUrl(this.deps.server, {
      redirect: this.deps.redirect,
      challenge: await challengeOf(this.verifier),
      state: this.state,
    });
  }

  /** Reads the window's answer, and gets the extension's session for a code. */
  async finish(returned: string): Promise<SignInResult> {
    const answer = readAnswer(returned, this.deps.redirect, this.state);
    if (!('code' in answer)) {
      return answer.denied
        ? { ok: false, reason: 'denied', message: 'Signing in was declined in the browser.' }
        : { ok: false, reason: 'failed', message: 'That sign-in didn’t come back as it should.' };
    }
    let response: Response;
    try {
      response = await (this.deps.fetch ?? fetch)(
        new URL(EXTENSION_SIGN_IN.token, this.deps.server),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code: answer.code,
            code_verifier: this.verifier,
            client_id: CLIENTS.extension,
            redirect_uri: this.deps.redirect,
          }),
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
