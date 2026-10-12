import { betterAuth } from 'better-auth';
import { authOptions, type Provider } from './auth-options.ts';
import type { Env } from './env.ts';

const provider = (id?: string, secret?: string): Provider | undefined =>
  id && secret ? { clientId: id, clientSecret: secret } : undefined;

export function createAuth(env: Env) {
  return betterAuth(
    authOptions({
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      database: env.DB,
      github: provider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
      google: provider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
      beforeDeleteUser: (accountId) =>
        env.STORES.get(env.STORES.idFromName(accountId)).wipe(accountId),
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
