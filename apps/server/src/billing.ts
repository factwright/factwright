import { type SubscriptionState, type SyncAccess, utf8 } from '@factwright/sync';
import type { Env } from './env.ts';

/**
 * Selling sync, on Factwright's own server: who may sync, one Stripe customer for each account
 * that pays, Stripe's checkout and customer portal, and keeping up with Stripe's word on each
 * subscription.
 *
 * Stripe is connected once its key and webhook secret are set. From then on, subscriptions are
 * kept up to date, and canceled along with their accounts. Sync is sold once both prices are set
 * too. Until then, and always on a server of your own, sync costs nothing.
 */

const STRIPE = 'https://api.stripe.com';
/**
 * The version of Stripe's API every call asks for, so what the server sends and reads doesn't
 * change with the account's default version in Stripe's dashboard. Checkout takes Managed Payments
 * from 2026-04-22.dahlia on.
 */
const STRIPE_VERSION = '2026-09-30.endive';

/** The subscription states sync works in: paid up, or a renewal's payment being retried. */
const SYNCING = ['active', 'trialing', 'past_due'];
const syncing = (status: string | null | undefined) => SYNCING.includes(status ?? '');
/** The same list, for SQL. They're fixed words, never anything a request sent. */
const SYNCING_SQL = SYNCING.map((status) => `'${status}'`).join(', ');

/** The states after which a subscription never syncs again. */
const OVER = ['canceled', 'incomplete_expired'];

/** How old a webhook's signature may be, as Stripe's own libraries allow. */
const SIGNATURE_SECONDS = 300;
/** The most a webhook's body may hold. Stripe's events are a few kilobytes. */
const WEBHOOK_BYTES = 512 * 1024;
/** How long a checkout stays open: a little over Stripe's shortest, so an old tab can't pay. */
const CHECKOUT_MINUTES = 35;
/** How soon an account can start another checkout, so a loop can't use up Stripe's limits. */
const CHECKOUT_SECONDS = 10;

/** What a server that sells sync keeps about one account (migrations/0003_sync_access.sql). */
interface AccessRow {
  account: string;
  gift: 'free' | null;
  customer: string | null;
  subscription: string | null;
  status: string | null;
  renewsAt: string | null;
  canceling: number;
  /** When the subscription was last read from Stripe, so an older read never wins. */
  checkedAt: string | null;
  checkoutAt: string | null;
}

/** Who's asking, as sign-in knows them. */
interface Someone {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date | string;
}

const now = () => new Date().toISOString();

/** Whether Stripe is connected: its key and its webhook secret are set. */
export function stripeConnected(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

/** Whether this server sells sync: Stripe connected, and both prices set. */
export function sellsSync(env: Env): boolean {
  return stripeConnected(env) && Boolean(env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_YEARLY);
}

/**
 * Whether sync is sold through Stripe Managed Payments (STRIPE_MANAGED_PAYMENTS is true), with
 * Stripe's affiliate as the merchant of record, handling the tax, rather than through Stripe's
 * ordinary checkout, where Stripe only takes the payment. The terms say which it is, so a value
 * that's neither true nor false stops checkout, rather than being taken for one of them.
 */
function managedPayments(env: Env): boolean {
  const setting =
    String(env.STRIPE_MANAGED_PAYMENTS ?? '')
      .trim()
      .toLowerCase() || 'false';
  if (setting !== 'true' && setting !== 'false') {
    throw new Error(`STRIPE_MANAGED_PAYMENTS is "${setting}". Set it to true or false.`);
  }
  return setting === 'true';
}

/** An email as sign-in keeps it, and as it's matched: trimmed and in lowercase. */
export const emailKey = (email: string) => email.trim().toLowerCase();

const rowOf = (env: Env, account: string) =>
  env.DB.prepare('SELECT * FROM "syncAccess" WHERE account = ?').bind(account).first<AccessRow>();

/** Whether an account was made before sync was sold (EARLY_BEFORE), so it keeps sync for good. */
function early(env: Env, someone: Pick<Someone, 'createdAt'>): boolean {
  const cutoff = Date.parse(env.EARLY_BEFORE ?? '');
  return Number.isFinite(cutoff) && new Date(someone.createdAt).getTime() < cutoff;
}

function stateOf(row: AccessRow): SubscriptionState {
  if (!syncing(row.status)) return 'ended';
  if (row.canceling) return 'ending';
  return row.status === 'past_due' ? 'retrying' : 'active';
}

/**
 * Notes an account the first time the server sees it while selling sync, so it's looked up once,
 * not on every request. A gift of free sync that was waiting for its email, verified, becomes the
 * account's own, and the email is forgotten.
 */
async function firstSight(env: Env, someone: Someone): Promise<AccessRow | null> {
  const email = someone.emailVerified ? emailKey(someone.email) : '';
  const [noted] = await env.DB.batch<AccessRow>([
    env.DB.prepare(
      `INSERT INTO "syncAccess" (account, gift, updatedAt)
       VALUES (?, CASE WHEN EXISTS (SELECT 1 FROM "freeSyncEmail" WHERE email = ?) THEN 'free' END, ?)
       ON CONFLICT (account) DO UPDATE SET gift = coalesce("syncAccess".gift, excluded.gift)
       RETURNING *`,
    ).bind(someone.id, email, now()),
    env.DB.prepare('DELETE FROM "freeSyncEmail" WHERE email = ?').bind(email),
  ]);
  return noted?.results[0] ?? null;
}

/** How an account has sync. */
export async function accessOf(env: Env, someone: Someone): Promise<SyncAccess> {
  const row = (await rowOf(env, someone.id)) ?? (await firstSight(env, someone));
  const gift = early(env, someone) ? 'early' : (row?.gift ?? null);
  return {
    allowed: gift !== null || syncing(row?.status),
    gift,
    subscription: row?.subscription ? { state: stateOf(row), renewsAt: row.renewsAt } : null,
  };
}

/** What the server keeps about an account's sync, for its export. Null when there's nothing. */
export async function billingRecord(env: Env, account: string) {
  const row = await rowOf(env, account);
  if (!row) return null;
  const { gift, customer, subscription, status, renewsAt, canceling } = row;
  return { gift, customer, subscription, status, renewsAt, canceling: canceling === 1 };
}

/** What Stripe says when it refuses a request. */
class StripeError extends Error {
  readonly code: string | undefined;
  readonly param: string | undefined;

  constructor(status: number, code: string | undefined, param: string | undefined) {
    super(`Stripe answered ${status}${code ? ` (${code})` : ''}.`);
    this.code = code;
    this.param = param;
  }
}

/**
 * A call to Stripe's API with the restricted key, as a form, in the API version the server is
 * written for. Null when the object it names is gone; a StripeError when Stripe refuses it. A key
 * for a POST makes trying it again safe.
 */
async function stripe<T>(
  env: Env,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  form?: Record<string, string>,
  idempotencyKey?: string,
): Promise<T | null> {
  const response = await fetch(new URL(path, env.STRIPE_API_URL || STRIPE), {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'stripe-version': STRIPE_VERSION,
      ...(form && { 'content-type': 'application/x-www-form-urlencoded' }),
      ...(idempotencyKey && { 'idempotency-key': idempotencyKey }),
    },
    ...(form && { body: new URLSearchParams(form).toString() }),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; param?: string };
    };
    throw new StripeError(response.status, error?.code, error?.param);
  }
  return (await response.json()) as T;
}

/** A Stripe customer that Stripe says no longer exists, such as one deleted in its dashboard. */
const customerGone = (error: unknown) =>
  error instanceof StripeError && error.code === 'resource_missing' && error.param === 'customer';

/**
 * The account's Stripe customer, made the first time it pays. Every checkout uses it, so all the
 * account's subscriptions are in one place, and Stripe can refuse a second one. Asking again
 * makes no second customer, unless the first was deleted in Stripe ("again").
 */
async function customerFor(env: Env, someone: Someone, again = false): Promise<string> {
  const row = again ? null : await rowOf(env, someone.id);
  if (row?.customer) return row.customer;
  const made = await stripe<{ id: string }>(
    env,
    'POST',
    '/v1/customers',
    { email: someone.email, 'metadata[account]': someone.id },
    again ? `customer-${someone.id}-${Date.now()}` : `customer-${someone.id}`,
  );
  if (!made?.id) throw new Error('Stripe made no customer.');
  await env.DB.prepare(
    `INSERT INTO "syncAccess" (account, customer, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT (account) DO UPDATE SET customer = excluded.customer, updatedAt = excluded.updatedAt`,
  )
    .bind(someone.id, made.id, now())
    .run();
  return made.id;
}

/**
 * Starts Stripe's checkout for a month or a year of sync, and returns its address, or
 * "slow-down" when the account started one moments ago. The checkout closes after about half an
 * hour, and names the account on its subscription, so every event about it says whose it is.
 * - It asks for a tick, agreeing to the terms of service named in Stripe's public details.
 * - It always says whether Managed Payments is on. Stripe can turn it on for an account's
 *   checkouts by default, and a checkout's own word decides over that.
 * - With Managed Payments, Stripe works out the tax, and asks for the name and address it needs
 *   for it, so the checkout sends none of the settings Managed Payments refuses, such as
 *   automatic_tax and customer_update. Without it, the checkout adds no tax.
 */
export async function startCheckout(
  env: Env,
  someone: Someone,
  period: 'month' | 'year',
  address: string,
): Promise<string | 'slow-down'> {
  const managed = managedPayments(env);
  const recent = new Date(Date.now() - CHECKOUT_SECONDS * 1000).toISOString();
  const { meta } = await env.DB.prepare(
    `INSERT INTO "syncAccess" (account, checkoutAt, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT (account) DO UPDATE SET checkoutAt = excluded.checkoutAt
     WHERE coalesce("syncAccess".checkoutAt, '') < ?`,
  )
    .bind(someone.id, now(), now(), recent)
    .run();
  if (meta.changes === 0) return 'slow-down';
  const open = async (customer: string) =>
    stripe<{ url: string }>(env, 'POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      customer,
      'line_items[0][price]': String(
        period === 'year' ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY,
      ),
      'line_items[0][quantity]': '1',
      client_reference_id: someone.id,
      'subscription_data[metadata][account]': someone.id,
      expires_at: String(Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60),
      success_url: `${address}/subscribe/done`,
      cancel_url: `${address}/subscribe`,
      'consent_collection[terms_of_service]': 'required',
      'managed_payments[enabled]': String(managed),
    });
  let session: { url: string } | null;
  try {
    session = await open(await customerFor(env, someone));
  } catch (error) {
    if (!customerGone(error)) throw error;
    session = await open(await customerFor(env, someone, true));
  }
  if (!session?.url) throw new Error('Stripe’s checkout came back without an address.');
  return session.url;
}

/**
 * Opens Stripe's customer portal for an account that's paid, where it can switch between monthly
 * and yearly, change its card, cancel and get receipts. Null for one with no Stripe customer.
 */
export async function openPortal(
  env: Env,
  account: string,
  address: string,
): Promise<string | null> {
  const row = await rowOf(env, account);
  if (!row?.customer) return null;
  try {
    const session = await stripe<{ url: string }>(env, 'POST', '/v1/billing_portal/sessions', {
      customer: row.customer,
      return_url: `${address}/account`,
    });
    return session?.url ?? null;
  } catch (error) {
    if (customerGone(error)) return null;
    throw error;
  }
}

/** A subscription as Stripe describes it, in the API version the server asks for. */
interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  /** When it's set to end, in Unix seconds. Newer accounts' portal cancels set this alone. */
  cancel_at?: number | null;
  metadata?: { account?: string };
  /** When the time paid for ends, kept on each of its items. */
  items?: { data?: { current_period_end?: number }[] };
}

/** Cancels a subscription straight away. One that's gone, or over already, is left as it is. */
async function cancel(env: Env, id: string): Promise<void> {
  const path = `/v1/subscriptions/${encodeURIComponent(id)}`;
  try {
    await stripe(env, 'DELETE', path);
  } catch (error) {
    const current = await stripe<StripeSubscription>(env, 'GET', path);
    if (current && !OVER.includes(current.status)) throw error;
  }
}

/**
 * Reads a subscription from Stripe as it is now, and keeps its state for its account: the one
 * its metadata names, or the one that owns its customer.
 * - One whose account is gone is canceled, so nobody pays for an account that isn't here.
 * - A second live subscription for an account that has one is canceled, and logged so its
 *   payment can be refunded.
 * - A read that's older than the last one kept never wins, nor does a subscription that isn't
 *   syncing over a different one that is, so late or out-of-order events can't leave it wrong.
 */
async function follow(env: Env, id: string): Promise<void> {
  const checkedAt = now();
  const subscription = await stripe<StripeSubscription>(
    env,
    'GET',
    `/v1/subscriptions/${encodeURIComponent(id)}`,
  );
  if (!subscription) return;
  const account =
    subscription.metadata?.account ??
    (
      await env.DB.prepare('SELECT account FROM "syncAccess" WHERE customer = ?')
        .bind(subscription.customer)
        .first<{ account: string }>()
    )?.account;
  const owner = account
    ? await env.DB.prepare('SELECT id FROM "user" WHERE id = ?')
        .bind(account)
        .first<{ id: string }>()
    : null;
  if (!owner) {
    if (!OVER.includes(subscription.status)) {
      await cancel(env, subscription.id);
      console.error(`Canceled Stripe's subscription ${subscription.id}: its account isn't here.`);
    }
    return;
  }
  const kept = await rowOf(env, owner.id);
  if (
    kept?.subscription &&
    kept.subscription !== subscription.id &&
    syncing(kept.status) &&
    syncing(subscription.status)
  ) {
    const first = await stripe<StripeSubscription>(
      env,
      'GET',
      `/v1/subscriptions/${encodeURIComponent(kept.subscription)}`,
    );
    if (first && syncing(first.status)) {
      await cancel(env, subscription.id);
      console.error(
        `Canceled ${subscription.id}, a second subscription for one account. Refund it in Stripe.`,
      );
      return;
    }
  }
  const ends = subscription.cancel_at ?? subscription.items?.data?.[0]?.current_period_end;
  const canceling = subscription.cancel_at_period_end || subscription.cancel_at != null;
  await env.DB.prepare(
    `INSERT INTO "syncAccess"
       (account, customer, subscription, status, renewsAt, canceling, checkedAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account) DO UPDATE SET
       customer = excluded.customer, subscription = excluded.subscription,
       status = excluded.status, renewsAt = excluded.renewsAt, canceling = excluded.canceling,
       checkedAt = excluded.checkedAt, updatedAt = excluded.updatedAt
     WHERE CASE WHEN "syncAccess".subscription = excluded.subscription
       THEN coalesce("syncAccess".checkedAt, '') <= excluded.checkedAt
       ELSE excluded.status IN (${SYNCING_SQL})
         OR coalesce("syncAccess".status, '') NOT IN (${SYNCING_SQL}) END`,
  )
    .bind(
      owner.id,
      subscription.customer,
      subscription.id,
      subscription.status,
      ends ? new Date(ends * 1000).toISOString() : null,
      canceling ? 1 : 0,
      checkedAt,
      checkedAt,
    )
    .run();
}

/**
 * Gives free sync to someone who asked, by email. An account with that email, verified, gets it
 * now; if it's paying, its subscription ends when the time paid for does, as nobody pays for a
 * gift. An email with no verified account waits for one to sign up with it.
 */
export async function giveFreeSync(
  env: Env,
  email: string,
): Promise<{ to: 'account' | 'email'; wasPaying: boolean }> {
  const address = emailKey(email);
  const user = await env.DB.prepare('SELECT id, emailVerified FROM "user" WHERE email = ?')
    .bind(address)
    .first<{ id: string; emailVerified: number }>();
  if (!user?.emailVerified) {
    await env.DB.prepare(
      'INSERT INTO "freeSyncEmail" (email, since) VALUES (?, ?) ON CONFLICT (email) DO NOTHING',
    )
      .bind(address, now())
      .run();
    return { to: 'email', wasPaying: false };
  }
  const row = await env.DB.prepare(
    `INSERT INTO "syncAccess" (account, gift, updatedAt) VALUES (?, 'free', ?)
     ON CONFLICT (account) DO UPDATE SET gift = 'free', updatedAt = excluded.updatedAt
     RETURNING *`,
  )
    .bind(user.id, now())
    .first<AccessRow>();
  const wasPaying = Boolean(row?.subscription && syncing(row.status) && !row.canceling);
  if (wasPaying && row?.subscription && stripeConnected(env)) {
    await stripe(env, 'POST', `/v1/subscriptions/${encodeURIComponent(row.subscription)}`, {
      cancel_at_period_end: 'true',
    });
    await env.DB.prepare('UPDATE "syncAccess" SET canceling = 1 WHERE account = ?')
      .bind(user.id)
      .run();
  }
  return { to: 'account', wasPaying };
}

/** Takes back free sync given to an email: from its account, and from any sign-up still to come. */
export async function takeBackFreeSync(env: Env, email: string): Promise<void> {
  const address = emailKey(email);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM "freeSyncEmail" WHERE email = ?').bind(address),
    env.DB.prepare(
      `UPDATE "syncAccess" SET gift = NULL, updatedAt = ?
       WHERE gift = 'free' AND account = (SELECT id FROM "user" WHERE email = ?)`,
    ).bind(now(), address),
  ]);
}

/**
 * Before an account goes, deletes its Stripe customer, which cancels every subscription it has.
 * Its payments and invoices stay in the Stripe account. It throws when it can't, so the deletion
 * stops and can be tried again. With Stripe not connected it refuses, while the account may still
 * be paying.
 */
export async function closeBilling(env: Env, account: string): Promise<void> {
  const row = await rowOf(env, account);
  if (!row?.customer && !row?.subscription) return;
  const mayBePaying = Boolean(row.subscription && !OVER.includes(row.status ?? ''));
  if (!stripeConnected(env)) {
    if (mayBePaying) {
      throw new Error(`Account ${account} may still be paying, and Stripe isn't connected.`);
    }
    console.error(
      `Account ${account}'s Stripe customer ${row.customer} is left to delete in Stripe.`,
    );
    return;
  }
  if (row.customer) {
    await stripe(env, 'DELETE', `/v1/customers/${encodeURIComponent(row.customer)}`);
  } else if (row.subscription && mayBePaying) {
    await cancel(env, row.subscription);
  }
  // Kept here too, so trying the deletion again doesn't ask Stripe twice.
  await env.DB.prepare(
    `UPDATE "syncAccess" SET customer = NULL, status = 'canceled', canceling = 0, updatedAt = ?
     WHERE account = ?`,
  )
    .bind(now(), account)
    .run();
}

/**
 * Once a day, reads again from Stripe any subscription that should have had word from it by now,
 * in case a webhook was missed: one whose time paid for ran out over a day ago, or one that's
 * waited on a payment for over an hour. One that fails doesn't stop the rest; the check then
 * fails, once they're all done, so the run is marked as failed.
 */
export async function checkSubscriptions(env: Env, when: Date): Promise<void> {
  if (!stripeConnected(env)) return;
  const { results } = await env.DB.prepare(
    `SELECT subscription FROM "syncAccess" WHERE subscription IS NOT NULL AND (
       (status IN (${SYNCING_SQL}) AND renewsAt < ?) OR (status = 'incomplete' AND checkedAt < ?)
     ) LIMIT 200`,
  )
    .bind(
      new Date(when.getTime() - 86_400_000).toISOString(),
      new Date(when.getTime() - 3_600_000).toISOString(),
    )
    .all<{ subscription: string }>();
  let failed = 0;
  for (const { subscription } of results) {
    try {
      await follow(env, subscription);
    } catch (error) {
      failed += 1;
      console.error(`Couldn't check Stripe's subscription ${subscription}: ${String(error)}`);
    }
  }
  if (failed > 0) throw new Error(`${failed} of ${results.length} subscriptions weren't checked.`);
}

/** A request's body as text, or null once it's longer than it may be. */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return null;
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = (await reader?.read()) ?? { done: true, value: undefined };
    if (done || !value) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader?.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const fromHex = (hex: string): Uint8Array | null =>
  /^(?:[\da-f]{2})+$/i.test(hex)
    ? Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
    : null;

/**
 * Whether a webhook's body is Stripe's: its Stripe-Signature header has a v1 signature, the
 * HMAC-SHA256 of "<t>.<body>" with the endpoint's secret, from the last five minutes.
 */
async function signedByStripe(secret: string, header: string | null, body: string) {
  const parts = (header ?? '').split(',').map((part) => part.trim().split('=', 2));
  const time = parts.find(([key]) => key === 't')?.[1] ?? '';
  if (!/^\d+$/.test(time) || Math.abs(Date.now() / 1000 - Number(time)) > SIGNATURE_SECONDS) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = utf8(`${time}.${body}`);
  for (const [name, value] of parts) {
    const signature = name === 'v1' && value ? fromHex(value) : null;
    if (signature && (await crypto.subtle.verify('HMAC', key, signature, signed))) return true;
  }
  return false;
}

/**
 * Stripe's webhook: a checkout that finished, or a subscription that changed. Each time the
 * subscription is read again from Stripe rather than trusted from the event, so events that come
 * late, twice or out of order can't leave it wrong, and a forged one couldn't give anyone sync.
 */
export async function fromStripe(
  env: Env,
  request: Request,
): Promise<'done' | 'unsigned' | 'too-big'> {
  const body = await readCapped(request, WEBHOOK_BYTES);
  if (body === null) return 'too-big';
  const signature = request.headers.get('stripe-signature');
  if (!(await signedByStripe(String(env.STRIPE_WEBHOOK_SECRET), signature, body))) {
    return 'unsigned';
  }
  const { type, data } = JSON.parse(body) as {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  const object = data?.object ?? {};
  const id =
    type === 'checkout.session.completed' && object.mode === 'subscription'
      ? object.subscription
      : type?.startsWith('customer.subscription.')
        ? object.id
        : null;
  if (typeof id === 'string') await follow(env, id);
  return 'done';
}
