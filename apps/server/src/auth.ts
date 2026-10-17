import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import {
  allowedGitHubUsers,
  authOptions,
  type Provider,
  type SignedInVia,
} from './auth-options.ts';
import { closeBilling } from './billing.ts';
import { appUrl, type Env } from './env.ts';

const provider = (id?: string, secret?: string): Provider | undefined =>
  id && secret ? { clientId: id, clientSecret: secret } : undefined;

/**
 * Deletes what an account has, apart from the account itself. Its Stripe customer goes first,
 * if it ever paid for sync, which cancels its subscriptions, so nobody pays for an account that's
 * gone; if that can't be done, nothing is deleted. Then every session and device code goes, so
 * nothing can sync while the store is wiped, then the store, its files and backups. Safe to run
 * again after it failed partway.
 */
export async function deleteEverything(env: Env, accountId: string): Promise<void> {
  await closeBilling(env, accountId);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM "session" WHERE userId = ?').bind(accountId),
    env.DB.prepare('DELETE FROM "deviceCode" WHERE userId = ?').bind(accountId),
  ]);
  await env.STORES.get(env.STORES.idFromName(accountId)).wipe(accountId);
}

/** Sign-in for the app served at an address. */
export function createAuth(env: Env, address: string) {
  return betterAuth(
    authOptions({
      appUrl: address,
      secret: env.BETTER_AUTH_SECRET,
      database: env.DB,
      github: provider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
      google: provider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
      allowedGitHubUsers: allowedGitHubUsers(env.ALLOWED_GITHUB_USERS),
      // The Worker lets only a browser's session ask to delete the account. Checked again here,
      // for any other way sign-in might come to delete it.
      beforeDeleteUser: async (accountId, request) => {
        if (!request || (await signedInVia(env, request)) !== 'web') {
          throw new APIError('BAD_REQUEST', {
            code: 'SESSION_NOT_FRESH',
            message: 'Sign in again with GitHub or Google, then delete the account.',
          });
        }
        await deleteEverything(env, accountId);
      },
      ...(Number(env.SIGN_INS_PER_MINUTE) > 0 && {
        signInsPerMinute: Number(env.SIGN_INS_PER_MINUTE),
      }),
    }),
  );
}

export type Auth = ReturnType<typeof createAuth>;

let made: { env: Env; byAddress: Map<string, Auth> } | undefined;

/**
 * Sign-in for this Worker, at the address a request came to, made once for each address and kept
 * while the Worker runs. With APP_URL set, there's only ever the one.
 */
export function authFor(env: Env, request: Request): Auth {
  if (made?.env !== env) made = { env, byAddress: new Map() };
  const address = appUrl(env, request);
  let auth = made.byAddress.get(address);
  if (!auth) {
    auth = createAuth(env, address);
    made.byAddress.set(address, auth);
  }
  return auth;
}

/** How the request's session signed in, read fresh from the database, or null without one. */
export async function signedInVia(env: Env, request: Request): Promise<SignedInVia | null> {
  const signedIn = await authFor(env, request).api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!signedIn) return null;
  return (signedIn.session as { via?: string | null }).via === 'web' ? 'web' : 'device';
}
