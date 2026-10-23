import { CLIENTS, type Feature, isLegal, utf8 } from '@factwright/sync';
import { forgetOldSignIns } from './accounts-upkeep.ts';
import { failure, handleApi, json, NOT_FOUND } from './api.ts';
import { authFor, deleteEverything, signedInVia } from './auth.ts';
import {
  checkSubscriptions,
  emailKey,
  fromStripe,
  giveFreeSync,
  sellsSync,
  stripeConnected,
  takeBackFreeSync,
} from './billing.ts';
import { runAll } from './daily-job.ts';
import type { Env } from './env.ts';
import { extensionRedirects } from './extension-sign-in.ts';
import { DELETED } from './store.ts';
import { countSyncDaily } from './sync-totals.ts';

export { UserStore } from './store.ts';

const STRIPE_WEBHOOK = '/api/billing/stripe';
const SIGN_IN_OPTIONS = '/api/sign-in-options';
const DELETE_ACCOUNT = '/api/auth/delete-user';
const APPROVE_DEVICE = '/api/auth/device/approve';
const DEVICE_CODE = '/api/auth/device/code';

/** An email someone sent, as sign-in keeps emails, or null when it isn't one. */
const emailIn = (value: unknown): string | null =>
  typeof value === 'string' && value.includes('@') && value.length <= 320 ? emailKey(value) : null;

/** A JSON body as an object, or an empty one when it's missing or isn't one. */
async function bodyOf(message: Request | Response): Promise<Record<string, unknown>> {
  const body: unknown = await message.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/**
 * Who asks for a device code, by their name in CLIENTS, such as "extension", from the request's
 * JSON, as Factwright's apps send it. Any other request, such as a form, names no one.
 */
async function askerOf(request: Request): Promise<string | undefined> {
  const { client_id } = await bodyOf(request.clone());
  return Object.entries(CLIENTS).find(([, id]) => id === client_id)?.[0];
}

/**
 * A new device code, with who asked for it added to the address of the page that approves it,
 * such as "for=extension", so the web view's sign-in page can say who's asking before anyone signs
 * in. Sign-in itself says so only to the account a code is tied to, once that account opens it.
 * Anyone can change an address, so the web view only ever picks words with it: the page that lets
 * a device in goes by sign-in's own word. The rest of the answer stays as sign-in gave it.
 */
async function withAsker(response: Response, asker: string | undefined): Promise<Response> {
  if (!asker || response.status !== 200) return response;
  const answer = await bodyOf(response.clone());
  const page = answer.verification_uri_complete;
  if (typeof page !== 'string' || !URL.canParse(page)) return response;
  const named = new URL(page);
  named.searchParams.set('for', asker);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return Response.json(
    { ...answer, verification_uri_complete: named.toString() },
    { status: response.status, headers },
  );
}

/**
 * Sign-in's own routes, with two that only a session from a browser sign-in with GitHub or
 * Google may use: deleting the account, and approving a device's code. A session from a device
 * code can do neither, so one got by tricking someone into approving a code can't delete their
 * account, or approve codes of its own to stay fresh. Better Auth checks the rest, such as that
 * the session is from the last 15 minutes before it deletes anything. A new device code names who
 * asked for it, for the web view's words (withAsker).
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
  if (request.method === 'POST' && pathname === DEVICE_CODE) {
    const asker = await askerOf(request);
    return withAsker(await authFor(env, request).handler(request), asker);
  }
  return authFor(env, request).handler(request);
}

/**
 * The ways to sign in this server has set up, for the web view's buttons; what it can do beyond
 * the basics, so devices offer only that, such as whether sync here is a subscription, and whether
 * the desktop app can sign in with no code to compare (desktop-sign-in.ts); the return
 * addresses the extension's sign-in window may go back to, for the extension to tell whether
 * it can sign in that way here, and the page to check what it's asked; and the terms and privacy
 * policy signing in agrees to, when it has them. Older servers list no features or return
 * addresses, and a server of your own no legal pages.
 */
async function signInOptions(env: Env): Promise<Response> {
  const providers = [
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? ['github'] : []),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? ['google'] : []),
  ];
  const features: Feature[] = [
    'approve',
    ...(sellsSync(env) ? (['subscription'] as const) : []),
    'loopback-sign-in',
  ];
  const legal = { terms: env.TERMS_URL, privacy: env.PRIVACY_URL };
  return json({
    providers,
    features,
    extensionRedirects: await extensionRedirects(env.EXTENSION_IDS),
    ...(isLegal(legal) && { legal }),
  });
}

/** Whether a request carries the operator's token. Without one set, nothing does. */
async function isOperator(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const given = utf8(request.headers.get('authorization') ?? '');
  const expected = utf8(`Bearer ${env.ADMIN_TOKEN}`);
  return given.length === expected.length && crypto.subtle.timingSafeEqual(given, expected);
}

/** Puts an account's store back as a day's backup left it. */
async function restore(request: Request, env: Env): Promise<Response> {
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
 * by email and can't sign in.
 */
async function deleteForOperator(request: Request, env: Env): Promise<Response> {
  const { account, email } = await bodyOf(request);
  const byId = typeof account === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(account);
  const address = emailIn(email);
  if (!byId && !address) return failure(400, 'refused', 'Name the account, or its email.');
  const found = await env.DB.prepare(`SELECT id FROM "user" WHERE ${byId ? 'id' : 'email'} = ?`)
    .bind(byId ? account : address)
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
 * says whether it went to an account now, or waits for one to sign up with the email, verified,
 * and whether that account was paying, as its subscription then ends with the time paid for.
 */
async function freeSyncForOperator(request: Request, env: Env): Promise<Response> {
  const { email, off } = await bodyOf(request);
  const address = emailIn(email);
  if (!address) return failure(400, 'refused', 'Name the email.');
  if (off === true) {
    await takeBackFreeSync(env, address);
    console.info('The operator took back free sync for an email.');
    return json({ free: false });
  }
  const given = await giveFreeSync(env, address);
  console.info(`The operator gave free sync, to an ${given.to}.`);
  return json({ free: true, ...given });
}

/** What only the operator can do, with the operator's token. To anyone else they don't exist. */
const FOR_OPERATOR: ReadonlyMap<string, (request: Request, env: Env) => Promise<Response>> =
  new Map([
    ['/api/admin/restore', restore],
    ['/api/admin/delete', deleteForOperator],
    ['/api/admin/free-sync', freeSyncForOperator],
  ]);

/** Stripe's word on a checkout or a subscription, once Stripe is connected (billing.ts). */
async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST' || !stripeConnected(env)) return NOT_FOUND();
  const result = await fromStripe(env, request);
  if (result === 'too-big') return failure(413, 'too-big', 'That request is too big.');
  return result === 'done'
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
      const forOperator = FOR_OPERATOR.get(pathname);
      if (forOperator) {
        return request.method === 'POST' && (await isOperator(request, env))
          ? await forOperator(request, env)
          : NOT_FOUND();
      }
      if (pathname === STRIPE_WEBHOOK) return await stripeWebhook(request, env);
      if (pathname === SIGN_IN_OPTIONS) return await signInOptions(env);
      if (pathname.startsWith('/api/')) {
        return await handleApi(request, env, authFor(env, request));
      }
    } catch (error) {
      // Cloudflare's log of every request is off, so a failure is written down here: what was
      // asked, never its query, which can carry a sign-in code.
      console.error(`${request.method} ${pathname} failed: ${String(error)}`);
      throw error;
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : NOT_FOUND();
  },

  async scheduled(controller, env, context): Promise<void> {
    const when = new Date(controller.scheduledTime);
    context.waitUntil(
      runAll({
        'cleanup of old sign-ins': forgetOldSignIns(env.DB, when),
        backup: backUpAll(env, when),
        'count of sync totals': countSyncDaily(env, when),
        'check of subscriptions': checkSubscriptions(env, when),
      }),
    );
  },
} satisfies ExportedHandler<Env>;
