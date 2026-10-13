import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { authOptions, type Provider } from './auth-options.ts';
import type { Env } from './env.ts';

/** How recently someone must have signed in with GitHub or Google to delete their account. */
const FRESH_SIGN_IN_MS = 15 * 60 * 1000;

const provider = (id?: string, secret?: string): Provider | undefined =>
  id && secret ? { clientId: id, clientSecret: secret } : undefined;

/**
 * Deletes what an account has, apart from the account itself: every session and device code
 * first, so nothing can sync while the store is wiped, then the store, its files and backups.
 */
export async function deleteEverything(env: Env, accountId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM "session" WHERE userId = ?').bind(accountId),
    env.DB.prepare('DELETE FROM "deviceCode" WHERE userId = ?').bind(accountId),
  ]);
  await env.STORES.get(env.STORES.idFromName(accountId)).wipe(accountId);
}

/**
 * Before an account goes: it needs a sign-in with GitHub or Google in the last 15 minutes, not
 * just a fresh session. A session the desktop app got with a device code is fresh too, so
 * someone who tricked a person into approving their code could otherwise delete the account.
 * Each sign-in with GitHub or Google updates the account's link to it, which a device code never
 * does.
 */
async function beforeDelete(env: Env, accountId: string): Promise<void> {
  const linked = await env.DB.prepare('SELECT max(updatedAt) AS at FROM "account" WHERE userId = ?')
    .bind(accountId)
    .first<{ at: string | null }>();
  const at = linked?.at ? Date.parse(linked.at) : Number.NaN;
  if (!(Date.now() - at < FRESH_SIGN_IN_MS)) {
    throw new APIError('BAD_REQUEST', {
      code: 'SESSION_NOT_FRESH',
      message: 'Sign in again with GitHub or Google, then delete the account.',
    });
  }
  await deleteEverything(env, accountId);
}

export function createAuth(env: Env) {
  return betterAuth(
    authOptions({
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      database: env.DB,
      github: provider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
      google: provider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
      beforeDeleteUser: (accountId) => beforeDelete(env, accountId),
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
