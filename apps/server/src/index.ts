import { utf8 } from '@factwright/sync';
import { forgetOldSignIns } from './accounts-upkeep.ts';
import { failure, handleApi, json } from './api.ts';
import { authFor, deleteEverything, signedInVia } from './auth.ts';
import type { Env } from './env.ts';
import { DELETED } from './store.ts';

export { UserStore } from './store.ts';

const ADMIN_RESTORE = '/api/admin/restore';
const ADMIN_DELETE = '/api/admin/delete';
const SIGN_IN_OPTIONS = '/api/sign-in-options';
const DELETE_ACCOUNT = '/api/auth/delete-user';
const APPROVE_DEVICE = '/api/auth/device/approve';

/** A request's JSON body as an object, or an empty one when it's missing or isn't one. */
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/**
 * Sign-in's own routes, with two that only a session from a browser sign-in with GitHub or
 * Google may use: deleting the account, and approving a device's code. A session from a device
 * code can do neither, so one got by tricking someone into approving a code can't delete their
 * account, or approve codes of its own to stay fresh. Better Auth checks the rest, such as that
 * the session is from the last 15 minutes before it deletes anything.
 */
async function signIn(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method === 'POST' && (pathname === DELETE_ACCOUNT || pathname === APPROVE_DEVICE)) {
    const via = await signedInVia(env, request);
    if (via === 'device' && pathname === DELETE_ACCOUNT) {
      // The web view asks for a fresh sign-in when it sees this.
      return json(
        {
          code: 'SESSION_NOT_FRESH',
          message: 'Sign in again with GitHub or Google, then delete the account.',
        },
        400,
      );
    }
    if (via === 'device') {
      return failure(403, 'refused', 'Approve a code from a browser signed in to Factwright.');
    }
  }
  return authFor(env).handler(request);
}

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
  const { account, day } = await bodyOf(request);
  if (
    typeof account !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(account) ||
    typeof day !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day)
  ) {
    return failure(400, 'refused', 'Name the account and the day, as YYYY-MM-DD.');
  }
  const restored = await env.STORES.get(env.STORES.idFromName(account))
    .restore(account, day)
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === DELETED) return DELETED;
      throw error;
    });
  if (restored === DELETED) return failure(410, 'deleted', 'That account was deleted.');
  return restored
    ? new Response(null, { status: 204 })
    : failure(404, 'not-found', 'There’s no backup of that account from that day.');
}

/**
 * Deletes an account and everything it has, found by its ID or its email, for someone who asked
 * by email and can't sign in. Only the operator can.
 */
async function deleteForOperator(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST' || !(await isOperator(request, env))) {
    return failure(404, 'not-found', 'There’s nothing here.');
  }
  const { account, email } = await bodyOf(request);
  const byId = typeof account === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(account);
  if (!byId && !(typeof email === 'string' && email.includes('@') && email.length <= 320)) {
    return failure(400, 'refused', 'Name the account, or its email.');
  }
  // Sign-in keeps emails in lowercase, however someone types theirs.
  const found = await env.DB.prepare(`SELECT id FROM "user" WHERE ${byId ? 'id' : 'email'} = ?`)
    .bind(byId ? account : String(email).trim().toLowerCase())
    .first<{ id: string }>();
  if (!found) return failure(404, 'not-found', 'There’s no such account.');
  await deleteEverything(env, found.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM "account" WHERE userId = ?').bind(found.id),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(found.id),
  ]);
  console.info(`The operator deleted account ${found.id}.`);
  return new Response(null, { status: 204 });
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
    try {
      if (pathname.startsWith('/api/auth/')) return await signIn(request, env, pathname);
      if (pathname === ADMIN_RESTORE) return await restore(request, env);
      if (pathname === ADMIN_DELETE) return await deleteForOperator(request, env);
      if (pathname === SIGN_IN_OPTIONS) return signInOptions(env);
      if (pathname.startsWith('/api/')) return await handleApi(request, env, authFor(env));
    } catch (error) {
      // Cloudflare's log of every request is off, so a failure is written down here: what was
      // asked, never its query, which can carry a sign-in code.
      console.error(`${request.method} ${pathname} failed: ${String(error)}`);
      throw error;
    }
    return env.ASSETS
      ? env.ASSETS.fetch(request)
      : failure(404, 'not-found', 'There’s nothing here.');
  },

  async scheduled(controller, env, context): Promise<void> {
    const when = new Date(controller.scheduledTime);
    context.waitUntil(Promise.all([forgetOldSignIns(env.DB, when), backUpAll(env, when)]));
  },
} satisfies ExportedHandler<Env>;
