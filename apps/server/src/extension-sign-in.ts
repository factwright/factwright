import {
  CLIENTS,
  CODE,
  challengeOf,
  type ExtensionAsk,
  randomBytes,
  readAsk,
  returnAddress,
  STORE_RETURNS,
  toBase64Url,
  utf8,
  VERIFIER,
} from '@factwright/sync';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, getAuthoritativeSessionFromCtx } from 'better-auth/api';

/**
 * Save to Factwright's sign-in through the browser's own window for extensions, with no code to
 * compare (packages/sync/src/extension-sign-in.ts has how it goes). The web view's page asks the
 * person, signed in here in their browser, and its answer goes to the extension's return address,
 * which only the extension that opened the window gets. With a yes, that carries a code, which the
 * extension trades for a session of its own, with the verifier only it has. The device code stays,
 * for the desktop app, the extension's older versions, and copies this server doesn't know.
 */

/** Sign-in's own paths, under /api/auth. */
export const ANSWER_PATH = '/extension/authorize';
export const TOKEN_PATH = '/extension/token';

/** How long a code lasts. The extension trades it the moment the window closes. */
const CODE_MS = 2 * 60 * 1000;

/** What sign-in's records name a code by: a hash of it, so the database never holds one. */
const codeKey = async (code: string) =>
  `extension-code:${toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(code))))}`;

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

/**
 * The return addresses the window may go back to: the stores' copies of Save to Factwright, and
 * the extension IDs a server's EXTENSION_IDS setting adds, such as a copy you built yourself, or a
 * test's. Anything in it that isn't an extension's ID is left out, so the setting can add only an
 * address that a browser hands to that one extension.
 */
export async function extensionRedirects(setting: string | undefined): Promise<string[]> {
  const added = await Promise.all(
    (setting ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(returnAddress),
  );
  return [...new Set([...STORE_RETURNS, ...added.filter((each) => each !== null)])];
}

/** The address the window goes on to, with an answer in its fragment. */
const answerAt = (ask: ExtensionAsk, answer: Record<string, string>) =>
  `${ask.redirect}#${new URLSearchParams({ ...answer, state: ask.state })}`;

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
 * The two steps, as sign-in's own routes. `redirects` gives the return addresses this server
 * knows.
 */
export function extensionSignIn(redirects: () => Promise<readonly string[]>) {
  return {
    id: 'extension-sign-in',
    endpoints: {
      /**
       * The page's answer, from a browser signed in here with GitHub or Google: a code once the
       * person allows it, or a no. Either goes only to a return address this server knows.
       */
      extensionAnswer: createAuthEndpoint(
        ANSWER_PATH,
        { method: 'POST', requireHeaders: true, metadata: { noStore: true } },
        async (ctx) => {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const ask = readAsk(body);
          if (!ask || !(await redirects()).includes(ask.redirect)) {
            throw invalid('That isn’t a sign-in Save to Factwright asked for.');
          }
          if (typeof body.allow !== 'boolean') throw invalid('Allow it, or don’t.');
          if (!body.allow) return ctx.json({ url: answerAt(ask, { error: 'access_denied' }) });
          const signedIn = await getAuthoritativeSessionFromCtx(ctx);
          if (!signedIn) {
            throw new APIError('UNAUTHORIZED', {
              error: 'unauthorized',
              error_description: 'Sign in here first.',
            });
          }
          // Only a browser's own sign-in, never a session from a device code or this, so one got
          // by tricking someone can't let in more of its own.
          if ((signedIn.session as { via?: unknown }).via !== 'web') {
            throw new APIError('FORBIDDEN', {
              error: 'access_denied',
              error_description: 'Allow it from a browser signed in to Factwright.',
            });
          }
          const code = toBase64Url(randomBytes(32));
          const granted: Granted = {
            user: signedIn.user.id,
            redirect: ask.redirect,
            challenge: ask.challenge,
          };
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: await codeKey(code),
            value: JSON.stringify(granted),
            expiresAt: new Date(Date.now() + CODE_MS),
          });
          return ctx.json({ url: answerAt(ask, { code }) });
        },
      ),

      /**
       * The extension trading a code for its own session, with the verifier the code is tied to.
       * A code works once: it's gone as soon as it's tried, right or wrong.
       */
      extensionToken: createAuthEndpoint(
        TOKEN_PATH,
        { method: 'POST', metadata: { noStore: true } },
        async (ctx) => {
          const { grant_type, code, code_verifier, client_id, redirect_uri } = (ctx.body ??
            {}) as Record<string, unknown>;
          if (
            grant_type !== 'authorization_code' ||
            client_id !== CLIENTS.extension ||
            typeof code !== 'string' ||
            !CODE.test(code) ||
            typeof code_verifier !== 'string' ||
            !VERIFIER.test(code_verifier) ||
            typeof redirect_uri !== 'string'
          ) {
            throw invalid('That isn’t how Save to Factwright finishes signing in.');
          }
          const found = await ctx.context.internalAdapter.consumeVerificationValue(
            await codeKey(code),
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
          // Named for the extension and the browser it's in, as a device code's would be
          // (auth-options.ts), and a device's, not a browser's own.
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              error: 'server_error',
              error_description: 'The sync server couldn’t sign Save to Factwright in.',
            });
          }
          return ctx.json({
            access_token: session.token,
            token_type: 'Bearer',
            expires_in: Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
