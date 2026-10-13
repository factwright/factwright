import { betterAuth } from 'better-auth';
import { authOptions, type Provider, type SignedInVia } from './auth-options.ts';
import type { Env } from './env.ts';

const provider = (id?: string, secret?: string): Provider | undefined =>
  id && secret ? { clientId: id, clientSecret: secret } : undefined;

/**
 * Deletes what an account has, apart from the account itself: every session and device code
 * first, so nothing can sync while the store is wiped, then the store, its files and backups.
 * Safe to run again after it failed partway.
 */
export async function deleteEverything(env: Env, accountId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM "session" WHERE userId = ?').bind(accountId),
    env.DB.prepare('DELETE FROM "deviceCode" WHERE userId = ?').bind(accountId),
  ]);
  await env.STORES.get(env.STORES.idFromName(accountId)).wipe(accountId);
}

export function createAuth(env: Env) {
  return betterAuth(
    authOptions({
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      database: env.DB,
      github: provider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
      google: provider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
      beforeDeleteUser: (accountId) => deleteEverything(env, accountId),
      ...(Number(env.SIGN_INS_PER_MINUTE) > 0 && {
        signInsPerMinute: Number(env.SIGN_INS_PER_MINUTE),
      }),
    }),
  );
}

export type Auth = ReturnType<typeof createAuth>;

let made: { env: Env; auth: Auth } | undefined;

/** Sign-in for this Worker, made once and kept while the Worker runs. */
export function authFor(env: Env): Auth {
  if (made?.env !== env) made = { env, auth: createAuth(env) };
  return made.auth;
}

/** How the request's session signed in, read fresh from the database, or null without one. */
export async function signedInVia(env: Env, request: Request): Promise<SignedInVia | null> {
  const signedIn = await authFor(env).api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!signedIn) return null;
  return (signedIn.session as { via?: string | null }).via === 'web' ? 'web' : 'device';
}
