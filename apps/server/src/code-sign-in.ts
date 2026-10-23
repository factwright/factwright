import {
  type CLIENTS,
  CODE,
  challengeOf,
  randomBytes,
  toBase64Url,
  utf8,
  VERIFIER,
} from '@factwright/sync';
import { APIError, createAuthEndpoint, getAuthoritativeSessionFromCtx } from 'better-auth/api';

/**
 * Signing an app in through the browser with a one-time code, and nothing to compare: the
 * extension through the browser's own window for extensions (extension-sign-in.ts), and the
 * desktop app through a page that sends the browser back to it on its computer
 * (desktop-sign-in.ts). The web view's page asks the person, signed in here in their browser, and
 * its answer goes to the app's return address, which only that app gets. With a yes, that carries
 * a code, which the app trades for a session of its own, with the verifier only it has. Each
 * answer names this server (`iss`, RFC 9207), for the app to check it's the one it asked.
 */

/** How long a code lasts. The app trades it the moment the browser hands it over. */
const CODE_MS = 2 * 60 * 1000;

/** What the page asks: where the answer goes, and what ties it to one sign-in. */
interface Ask {
  redirect: string;
  challenge: string;
  state: string;
}

/** An app that signs in this way, and how its answers get back to it. */
export interface CodeClient {
  /** The app, as the server knows it. */
  id: (typeof CLIENTS)[keyof typeof CLIENTS];
  /** What its codes are kept under, so one app's code never signs in another. */
  kind: 'extension' | 'desktop';
  /** What it's called, in what the server says about a request it didn't make. */
  name: string;
  /** Its ask, from the page's request, or null when it isn't one the app makes. */
  readAsk: (values: Readonly<Record<string, unknown>>) => Ask | null;
  /** Whether its answers may go to a return address. */
  returnsTo: (redirect: string) => Promise<boolean>;
  /** The return address, carrying an answer: in its fragment, or its query. */
  answerAt: (redirect: string, answer: URLSearchParams) => string;
}

/** What sign-in's records name a code by: a hash of it, so the database never holds one. */
const codeKey = async (client: CodeClient, code: string) =>
  `${client.kind}-code:${toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(code))))}`;

/** What a code stands for, kept with it until it's traded. */
interface Granted {
  user: string;
  redirect: string;
  challenge: string;
}

const isGranted = (value: unknown): value is Granted =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Granted).user === 'string' &&
  typeof (value as Granted).redirect === 'string' &&
  typeof (value as Granted).challenge === 'string';

/** A request that isn't one this takes, in OAuth's words. */
const invalid = (description: string) =>
  new APIError('BAD_REQUEST', { error: 'invalid_request', error_description: description });

/** A code that's unknown, used already, run out, or not this one's. */
const BAD_GRANT = () =>
  new APIError('BAD_REQUEST', {
    error: 'invalid_grant',
    error_description: 'That sign-in ran out, or was used already. Try again.',
  });

/**
 * The page's answer, from a browser signed in here with GitHub or Google: a code once the person
 * allows it, or a no. Either goes only to a return address the app may be given answers at, and
 * names `issuer`, this server's own address.
 */
export function answerEndpoint(client: CodeClient, path: string, issuer: string) {
  return createAuthEndpoint(
    path,
    { method: 'POST', requireHeaders: true, metadata: { noStore: true } },
    async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const ask = client.readAsk(body);
      if (!ask || !(await client.returnsTo(ask.redirect))) {
        throw invalid(`That isn’t a sign-in ${client.name} asked for.`);
      }
      const answerAt = (answer: Record<string, string>) =>
        client.answerAt(
          ask.redirect,
          new URLSearchParams({ ...answer, state: ask.state, iss: issuer }),
        );
      if (typeof body.allow !== 'boolean') throw invalid('Allow it, or don’t.');
      if (!body.allow) return ctx.json({ url: answerAt({ error: 'access_denied' }) });
      const signedIn = await getAuthoritativeSessionFromCtx(ctx);
      if (!signedIn) {
        throw new APIError('UNAUTHORIZED', {
          error: 'unauthorized',
          error_description: 'Sign in here first.',
        });
      }
      // Only a browser's own sign-in, never a session from a device code or this, so one got by
      // tricking someone can't let in more of its own.
      if ((signedIn.session as { via?: unknown }).via !== 'web') {
        throw new APIError('FORBIDDEN', {
          error: 'access_denied',
          error_description: 'Allow it from a browser signed in to Factwright.',
        });
      }
      // The account the page named, as it was when it opened, so another tab's sign-in since
      // can't swap the account the person allowed.
      if (body.account !== signedIn.user.id) {
        throw new APIError('CONFLICT', {
          error: 'account_changed',
          error_description: 'This browser is signed in to another account now.',
        });
      }
      const code = toBase64Url(randomBytes(32));
      const granted: Granted = {
        user: signedIn.user.id,
        redirect: ask.redirect,
        challenge: ask.challenge,
      };
      await ctx.context.internalAdapter.createVerificationValue({
        identifier: await codeKey(client, code),
        value: JSON.stringify(granted),
        expiresAt: new Date(Date.now() + CODE_MS),
      });
      return ctx.json({ url: answerAt({ code }) });
    },
  );
}

/**
 * The app trading a code for its own session, with the verifier the code is tied to. A code works
 * once: it's gone as soon as it's tried, right or wrong. The session is named for the device that
 * traded it, as a device code's would be (auth-options.ts), and is a device's, not a browser's own.
 */
export function tokenEndpoint(client: CodeClient, path: string) {
  return createAuthEndpoint(path, { method: 'POST', metadata: { noStore: true } }, async (ctx) => {
    const { grant_type, code, code_verifier, client_id, redirect_uri } = (ctx.body ?? {}) as Record<
      string,
      unknown
    >;
    if (
      grant_type !== 'authorization_code' ||
      client_id !== client.id ||
      typeof code !== 'string' ||
      !CODE.test(code) ||
      typeof code_verifier !== 'string' ||
      !VERIFIER.test(code_verifier) ||
      typeof redirect_uri !== 'string'
    ) {
      throw invalid(`That isn’t how ${client.name} finishes signing in.`);
    }
    const found = await ctx.context.internalAdapter.consumeVerificationValue(
      await codeKey(client, code),
    );
    let granted: unknown = null;
    try {
      granted = found ? JSON.parse(found.value) : null;
    } catch {
      // Not one of these.
    }
    if (
      !isGranted(granted) ||
      granted.redirect !== redirect_uri ||
      granted.challenge !== (await challengeOf(code_verifier))
    ) {
      throw BAD_GRANT();
    }
    const user = await ctx.context.internalAdapter.findUserById(granted.user);
    if (!user) throw BAD_GRANT();
    const session = await ctx.context.internalAdapter.createSession(user.id);
    if (!session) {
      throw new APIError('INTERNAL_SERVER_ERROR', {
        error: 'server_error',
        error_description: `The sync server couldn’t sign ${client.name} in.`,
      });
    }
    return ctx.json({
      access_token: session.token,
      token_type: 'Bearer',
      expires_in: Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
    });
  });
}
