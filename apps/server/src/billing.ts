import { type SyncAccess, utf8 } from '@factwright/sync';
import type { Env } from './env.ts';

/**
 * Selling sync, on Factwright's own server: who may sync, Stripe's checkout and customer portal
 * for paying, and keeping up with Stripe's word on each subscription. It's on only once all four
 * Stripe settings are set (env.ts). Until then, and always on a server of your own, sync costs
 * nothing and nobody is asked to pay.
 */

const STRIPE = 'https://api.stripe.com';

/** The subscription states sync works in: paid up, or a renewal's payment being retried. */
const SYNCING = new Set(['active', 'trialing', 'past_due']);

/** How old a webhook's signature may be, as Stripe's own libraries allow. */
const SIGNATURE_SECONDS = 300;

/** What a server that sells sync keeps about one account (migrations/0003_sync_access.sql). */
interface AccessRow {
  account: string;
  gift: 'early' | 'free' | null;
  customer: string | null;
  subscription: string | null;
  status: string | null;
  renewsAt: string | null;
  canceling: number;
}

/** Who's asking, as sign-in knows them. */
export interface Someone {
  id: string;
  email: string;
  emailVerified: boolean;
}

/** How long a month or a year of sync is bought for. */
export type Period = 'month' | 'year';

/** Whether this server sells sync: only once Stripe is set up, with both prices. */
export function sellsSync(env: Env): boolean {
  return Boolean(
    env.STRIPE_SECRET_KEY &&
      env.STRIPE_WEBHOOK_SECRET &&
      env.STRIPE_PRICE_MONTHLY &&
      env.STRIPE_PRICE_YEARLY,
  );
}

const rowOf = (env: Env, account: string) =>
  env.DB.prepare('SELECT * FROM "syncAccess" WHERE account = ?').bind(account).first<AccessRow>();

const allowedBy = (row: AccessRow | null) => Boolean(row?.gift) || SYNCING.has(row?.status ?? '');

/** Gives an account sync at no cost. "early" stays, as it's for good. */
const setGift = (env: Env, account: string, gift: 'early' | 'free') =>
  env.DB.prepare(
    `INSERT INTO "syncAccess" (account, gift, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT (account) DO UPDATE SET
       gift = CASE WHEN "syncAccess".gift = 'early' THEN 'early' ELSE excluded.gift END,
       updatedAt = excluded.updatedAt
     RETURNING *`,
  )
    .bind(account, gift, new Date().toISOString())
    .first<AccessRow>();

/**
 * How an account has sync. An account that couldn't sync, whose verified email was given free
 * sync before it signed up, gets it now.
 */
export async function accessOf(env: Env, someone: Someone): Promise<SyncAccess> {
  let row = await rowOf(env, someone.id);
  if (!allowedBy(row) && someone.emailVerified) {
    const given = await env.DB.prepare('SELECT 1 FROM "freeSyncEmail" WHERE email = ?')
      .bind(someone.email.toLowerCase())
      .first();
    if (given) row = await setGift(env, someone.id, 'free');
  }
  return {
    allowed: allowedBy(row),
    gift: row?.gift ?? null,
    subscription:
      row?.subscription && row.status
        ? { status: row.status, renewsAt: row.renewsAt, canceling: row.canceling === 1 }
        : null,
  };
}

/**
 * Gives free sync to whoever has an email, or takes it back: to the account with it now, and to
 * one made with it later. An account from before sync was sold keeps its own, which is for good.
 */
export async function giveFreeSync(
  env: Env,
  email: string,
  on: boolean,
): Promise<{ account: boolean }> {
  const address = email.trim().toLowerCase();
  const now = new Date().toISOString();
  const user = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?')
    .bind(address)
    .first<{ id: string }>();
  if (on) {
    await env.DB.prepare(
      'INSERT INTO "freeSyncEmail" (email, since) VALUES (?, ?) ON CONFLICT (email) DO NOTHING',
    )
      .bind(address, now)
      .run();
    if (user) await setGift(env, user.id, 'free');
  } else {
    await env.DB.prepare('DELETE FROM "freeSyncEmail" WHERE email = ?').bind(address).run();
    if (user) {
      await env.DB.prepare(
        `UPDATE "syncAccess" SET gift = NULL, updatedAt = ? WHERE account = ? AND gift = 'free'`,
      )
        .bind(now, user.id)
        .run();
    }
  }
  return { account: Boolean(user) };
}

/**
 * Gives every account there is now sync for good. It's run once, as sync starts being sold, for
 * the people who had it before. Returns how many accounts that is.
 */
export async function markEarly(env: Env): Promise<number> {
  const { meta } = await env.DB.prepare(
    `INSERT INTO "syncAccess" (account, gift, updatedAt) SELECT id, 'early', ? FROM "user" WHERE true
     ON CONFLICT (account) DO UPDATE SET gift = 'early', updatedAt = excluded.updatedAt`,
  )
    .bind(new Date().toISOString())
    .run();
  return meta.changes;
}

/** A call to Stripe's API with the restricted key, as a form. Null when what it names is gone. */
async function stripe<T>(
  env: Env,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  form?: Record<string, string>,
): Promise<T | null> {
  const response = await fetch(new URL(path, env.STRIPE_API_URL || STRIPE), {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(form && { 'content-type': 'application/x-www-form-urlencoded' }),
    },
    ...(form && { body: new URLSearchParams(form).toString() }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Stripe answered ${response.status} to ${method} ${path}.`);
  return (await response.json()) as T;
}

/**
 * Starts Stripe's checkout for a month or a year of sync, and returns its address. It names the
 * account on the subscription, so every event about it says whose it is. An account that's paid
 * before pays as the same Stripe customer.
 */
export async function startCheckout(
  env: Env,
  someone: Someone,
  period: Period,
  address: string,
): Promise<string> {
  const row = await rowOf(env, someone.id);
  const price = period === 'year' ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
  const session = await stripe<{ url: string }>(env, 'POST', '/v1/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': String(price),
    'line_items[0][quantity]': '1',
    client_reference_id: someone.id,
    'subscription_data[metadata][account]': someone.id,
    success_url: `${address}/subscribe/done`,
    cancel_url: `${address}/subscribe`,
    ...(row?.customer ? { customer: row.customer } : { customer_email: someone.email }),
  });
  if (!session?.url) throw new Error('Stripe’s checkout came back without an address.');
  return session.url;
}

/**
 * Opens Stripe's customer portal for an account that's paid, where it can switch between monthly
 * and yearly, change its card, cancel and get receipts. Null for one that never has.
 */
export async function openPortal(
  env: Env,
  account: string,
  address: string,
): Promise<string | null> {
  const row = await rowOf(env, account);
  if (!row?.customer) return null;
  const session = await stripe<{ url: string }>(env, 'POST', '/v1/billing_portal/sessions', {
    customer: row.customer,
    return_url: `${address}/account`,
  });
  return session?.url ?? null;
}

/**
 * Cancels an account's subscription straight away, before the account goes, so nobody pays for
 * one that's gone. It throws when Stripe can't, so the deletion stops and can be tried again.
 */
export async function cancelSubscription(env: Env, account: string): Promise<void> {
  if (!env.STRIPE_SECRET_KEY) return;
  const row = await rowOf(env, account);
  if (!row?.subscription || row.status === 'canceled' || row.status === 'incomplete_expired') {
    return;
  }
  await stripe(env, 'DELETE', `/v1/subscriptions/${encodeURIComponent(row.subscription)}`);
  // Kept here too, so trying the deletion again doesn't ask Stripe to cancel it twice.
  await env.DB.prepare(
    `UPDATE "syncAccess" SET status = 'canceled', canceling = 0, updatedAt = ? WHERE account = ?`,
  )
    .bind(new Date().toISOString(), account)
    .run();
}

const fromHex = (hex: string): Uint8Array | null =>
  /^(?:[\da-f]{2})+$/i.test(hex)
    ? new Uint8Array(hex.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [])
    : null;

/**
 * Whether a webhook's body is Stripe's: its Stripe-Signature header has a v1 signature, the
 * HMAC-SHA256 of "<t>.<body>" with the endpoint's secret, from the last five minutes.
 */
async function signedByStripe(secret: string, header: string | null, body: string) {
  const parts = (header ?? '').split(',').map((part) => part.trim().split('=', 2));
  const time = parts.find(([key]) => key === 't')?.[1] ?? '';
  const timestamp = Number(time);
  if (!/^\d+$/.test(time) || Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_SECONDS) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(`${time}.${body}`)));
  return parts.some(([key, value]) => {
    const given = key === 'v1' && value ? fromHex(value) : null;
    return given?.length === expected.length && crypto.subtle.timingSafeEqual(given, expected);
  });
}

/** A subscription as Stripe describes it, in whichever API version the account uses. */
interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  metadata?: { account?: string };
  /** Where older API versions keep when the time paid for ends. */
  current_period_end?: number;
  /** And where newer ones keep it. */
  items?: { data?: { current_period_end?: number }[] };
}

/**
 * Reads a subscription from Stripe as it is now, and keeps its state for its account: the one
 * Stripe names, or the one that paid as its customer. A subscription that isn't syncing never
 * replaces a different one that is, so a late event about an old one can't stop a new one.
 */
async function follow(env: Env, id: string, account: string | undefined): Promise<void> {
  const subscription = await stripe<StripeSubscription>(
    env,
    'GET',
    `/v1/subscriptions/${encodeURIComponent(id)}`,
  );
  if (!subscription) return;
  const owner =
    account ??
    subscription.metadata?.account ??
    (
      await env.DB.prepare('SELECT account FROM "syncAccess" WHERE customer = ?')
        .bind(subscription.customer)
        .first<{ account: string }>()
    )?.account;
  if (!owner) {
    console.error(`Stripe's subscription ${subscription.id} names no account here.`);
    return;
  }
  const ends = subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end;
  await env.DB.prepare(
    `INSERT INTO "syncAccess" (account, customer, subscription, status, renewsAt, canceling, updatedAt)
     SELECT id, ?, ?, ?, ?, ?, ? FROM "user" WHERE id = ?
     ON CONFLICT (account) DO UPDATE SET
       customer = excluded.customer, subscription = excluded.subscription,
       status = excluded.status, renewsAt = excluded.renewsAt,
       canceling = excluded.canceling, updatedAt = excluded.updatedAt
     WHERE "syncAccess".subscription IS NULL
       OR "syncAccess".subscription = excluded.subscription
       OR excluded.status IN ('active', 'trialing', 'past_due')
       OR "syncAccess".status IS NULL
       OR "syncAccess".status NOT IN ('active', 'trialing', 'past_due')`,
  )
    .bind(
      subscription.customer,
      subscription.id,
      subscription.status,
      ends ? new Date(ends * 1000).toISOString() : null,
      subscription.cancel_at_period_end ? 1 : 0,
      new Date().toISOString(),
      owner,
    )
    .run();
}

/** The events that change who may sync. Stripe gets an answer for any other, and that's all. */
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);

/**
 * Stripe's webhook: a checkout that finished, or a subscription that changed. Each time the
 * subscription is read again from Stripe, so events that come late, twice or out of order can't
 * leave it wrong. Refused unless Stripe signed it.
 */
export async function fromStripe(env: Env, request: Request): Promise<'done' | 'unsigned'> {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');
  if (!(await signedByStripe(String(env.STRIPE_WEBHOOK_SECRET), signature, body))) {
    return 'unsigned';
  }
  const { type, data } = JSON.parse(body) as {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  const object = data?.object ?? {};
  const named = (value: unknown) => (typeof value === 'string' ? value : undefined);
  if (type === 'checkout.session.completed' && object.mode === 'subscription') {
    const id = named(object.subscription);
    if (id) await follow(env, id, named(object.client_reference_id));
  } else if (type && SUBSCRIPTION_EVENTS.has(type)) {
    const id = named(object.id);
    if (id) await follow(env, id, named((object.metadata as { account?: unknown })?.account));
  }
  return 'done';
}
