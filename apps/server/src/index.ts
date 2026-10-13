import { utf8 } from '@factwright/sync';
import { forgetOldSignIns } from './accounts-upkeep.ts';
import { failure, handleApi, json } from './api.ts';
import { authFor } from './auth.ts';
import type { Env } from './env.ts';

export { UserStore } from './store.ts';

const ADMIN_RESTORE = '/api/admin/restore';
const SIGN_IN_OPTIONS = '/api/sign-in-options';

/** The ways to sign in this server has set up, for the web view's buttons. */
function signInOptions(env: Env): Response {
  const providers = [
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? ['github'] : []),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? ['google'] : []),
  ];
  return json({ providers });
}

/** Whether a request carries the operator's token. Without one set, nothing does. */
async function isOperator(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const given = utf8(request.headers.get('authorization') ?? '');
  const expected = utf8(`Bearer ${env.ADMIN_TOKEN}`);
  return given.length === expected.length && crypto.subtle.timingSafeEqual(given, expected);
}

/** Puts an account's store back as a day's backup left it. Only the operator can. */
async function restore(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST' || !(await isOperator(request, env))) {
    return failure(404, 'not-found', 'There’s nothing here.');
  }
  const { account, day } = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (
    typeof account !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(account) ||
    typeof day !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day)
  ) {
    return failure(400, 'refused', 'Name the account and the day, as YYYY-MM-DD.');
  }
  const restored = await env.STORES.get(env.STORES.idFromName(account)).restore(account, day);
  return restored
    ? new Response(null, { status: 204 })
    : failure(404, 'not-found', 'There’s no backup of that account from that day.');
}

/** Backs up every account's store, one at a time, as the day's snapshot. */
async function backUpAll(env: Env, when: Date): Promise<void> {
  const day = when.toISOString().slice(0, 10);
  const { results } = await env.DB.prepare('SELECT id FROM "user" ORDER BY id').all<{
    id: string;
  }>();
  for (const { id } of results) {
    try {
      await env.STORES.get(env.STORES.idFromName(id)).backup(id, day);
    } catch (error) {
      console.error(`Couldn't back up an account's store: ${String(error)}`);
    }
  }
}

/**
 * The sync server. Sign-in is Better Auth's, under /api/auth. The rest of /api is the sync
 * API, for the signed-in account only. Everything else is the web view, when it's built.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/auth/')) return authFor(env).handler(request);
    if (pathname === ADMIN_RESTORE) return restore(request, env);
    if (pathname === SIGN_IN_OPTIONS) return signInOptions(env);
    if (pathname.startsWith('/api/')) return handleApi(request, env, authFor(env));
    return env.ASSETS
      ? env.ASSETS.fetch(request)
      : failure(404, 'not-found', 'There’s nothing here.');
  },

  async scheduled(controller, env, context): Promise<void> {
    const when = new Date(controller.scheduledTime);
    context.waitUntil(Promise.all([forgetOldSignIns(env.DB, when), backUpAll(env, when)]));
  },
} satisfies ExportedHandler<Env>;
