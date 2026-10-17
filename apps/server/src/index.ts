import { type Feature, isLegal, utf8 } from '@factwright/sync';
import { forgetOldSignIns } from './accounts-upkeep.ts';
import { failure, handleApi, json } from './api.ts';
import { authFor, deleteEverything, signedInVia } from './auth.ts';
import { fromStripe, giveFreeSync, markEarly, sellsSync } from './billing.ts';
import { runAll } from './daily-job.ts';
import type { Env } from './env.ts';
import { DELETED } from './store.ts';
import { countSyncDaily } from './sync-totals.ts';

export { UserStore } from './store.ts';

const ADMIN_RESTORE = '/api/admin/restore';
const ADMIN_DELETE = '/api/admin/delete';
const ADMIN_FREE_SYNC = '/api/admin/free-sync';
const ADMIN_EARLY = '/api/admin/early';
const STRIPE_WEBHOOK = '/api/billing/stripe';
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
  return authFor(env, request).handler(request);
}

/**
 * The ways to sign in this server has set up, for the web view's buttons; what it can do beyond
 * the basics, so devices offer only that, such as whether sync here is a subscription; and the
 * terms and privacy policy signing in agrees to, when it has them. Older servers list no
 * features, and a server of your own no legal pages.
 */
function signInOptions(env: Env): Response {
  const providers = [
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? ['github'] : []),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? ['google'] : []),
  ];
  const features: Feature[] = ['approve', ...(sellsSync(env) ? (['subscription'] as const) : [])];
  const legal = { terms: env.TERMS_URL, privacy: env.PRIVACY_URL };
  return json({ providers, features, ...(isLegal(legal) && { legal }) });
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

/**
 * Gives free sync to someone who asked, by their email, or takes it back with "off": true. It
 * works before they have an account, which then gets it when they sign up. Only the operator can.
 */
async function freeSyncForOperator(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST' || !(await isOperator(request, env))) {
    return failure(404, 'not-found', 'There’s nothing here.');
  }
  const { email, off } = await bodyOf(request);
  if (!(typeof email === 'string' && email.includes('@') && email.length <= 320)) {
    return failure(400, 'refused', 'Name the email.');
  }
  const { account } = await giveFreeSync(env, email, off !== true);
  console.info(`The operator ${off === true ? 'took back' : 'gave'} free sync for an email.`);
  return json({ free: off !== true, account });
}

/**
 * Gives every account there is now sync for good, once, as sync starts being sold: those people
 * had it before. Only the operator can.
 */
async function earlyForOperator(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST' || !(await isOperator(request, env))) {
    return failure(404, 'not-found', 'There’s nothing here.');
  }
  const accounts = await markEarly(env);
  console.info(`The operator gave ${accounts} early accounts sync for good.`);
  return json({ accounts });
}

/** Stripe's word on a checkout or a subscription, on a server that sells sync (billing.ts). */
async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST' || !sellsSync(env)) {
    return failure(404, 'not-found', 'There’s nothing here.');
  }
  return (await fromStripe(env, request)) === 'done'
    ? json({ received: true })
    : failure(400, 'refused', 'That isn’t signed by Stripe.');
}

/**
 * Backs up every account's store, one at a time, as the day's snapshot. One that fails doesn't
 * stop the rest. Once they're all done, the backup fails if any did, so the run is marked as
 * failed. An account deleted partway has no store left to back up, so it isn't a failure.
 */
async function backUpAll(env: Env, when: Date): Promise<void> {
  const day = when.toISOString().slice(0, 10);
  const { results } = await env.DB.prepare('SELECT id FROM "user" ORDER BY id').all<{
    id: string;
  }>();
  let failed = 0;
  for (const { id } of results) {
    try {
      await env.STORES.get(env.STORES.idFromName(id)).backup(id, day);
    } catch (error) {
      if (error instanceof Error && error.message === DELETED) continue;
      failed += 1;
      console.error(`Couldn't back up account ${id}'s store: ${String(error)}`);
    }
  }
  if (failed > 0) {
    throw new Error(`${failed} of ${results.length} accounts' stores weren't backed up.`);
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
      if (pathname === ADMIN_FREE_SYNC) return await freeSyncForOperator(request, env);
      if (pathname === ADMIN_EARLY) return await earlyForOperator(request, env);
      if (pathname === STRIPE_WEBHOOK) return await stripeWebhook(request, env);
      if (pathname === SIGN_IN_OPTIONS) return signInOptions(env);
      if (pathname.startsWith('/api/')) {
        return await handleApi(request, env, authFor(env, request));
      }
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
    context.waitUntil(
      runAll({
        'cleanup of old sign-ins': forgetOldSignIns(env.DB, when),
        backup: backUpAll(env, when),
        'count of sync totals': countSyncDaily(env, when),
      }),
    );
  },
} satisfies ExportedHandler<Env>;
