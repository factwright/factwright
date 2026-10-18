import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Account, startServer, type TestServer } from './server.ts';
import {
  type FakeStripe,
  type FakeSubscription,
  signed,
  startStripe,
  subscription,
} from './stripe.ts';

/**
 * Factwright's own server, selling sync through a stand-in for Stripe, since the start of 2026,
 * through Stripe's ordinary checkout, as wrangler.jsonc has it.
 */
const WEBHOOK_SECRET = 'whsec_test_only_0123456789';
const SELLING_SINCE = '2026-01-01T00:00:00.000Z';
const ADMIN = { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' };
/** The version of Stripe's API the server is written for. */
const STRIPE_VERSION = '2026-09-30.endive';

/**
 * What Managed Payments refuses on a subscription's checkout, as the start of each setting's
 * name: docs.stripe.com/payments/managed-payments/update-checkout, and the custom text and the
 * place of the card's reuse agreement, which its standard checkout refuses too.
 */
const REFUSED_BY_MANAGED_PAYMENTS = [
  'adaptive_pricing',
  'automatic_tax',
  'tax_id_collection',
  'subscription_data[default_tax_rates]',
  'payment_method_configuration',
  'payment_method_types',
  'excluded_payment_method_types',
  'customer_update[name]',
  'customer_update[address]',
  'shipping_address_collection',
  'shipping_options',
  'subscription_data[application_fee_percent]',
  'subscription_data[on_behalf_of]',
  'subscription_data[transfer_data]',
  'subscription_data[invoice_settings]',
  'invoice_creation',
  'custom_text',
  'consent_collection[payment_method_reuse_agreement]',
];

let stripe: FakeStripe;
let server: TestServer;

/** The settings that connect the server to the stand-in for Stripe, and sell sync. */
const selling = () => ({
  STRIPE_SECRET_KEY: 'rk_test_only',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_MONTHLY: 'price_month',
  STRIPE_PRICE_YEARLY: 'price_year',
  STRIPE_API_URL: stripe.url,
  EARLY_BEFORE: SELLING_SINCE,
});

beforeAll(async () => {
  stripe = await startStripe();
  server = await startServer(selling());
});

afterAll(async () => {
  await server?.close();
  await stripe?.close();
});

/** A request with a session's token, as the desktop app sends it, or the web view after sign-in. */
function as(account: { token: string }, method: string, path: string, body?: object) {
  return fetch(new URL(path, server.url), {
    method,
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
}

/** The first thing turning sync on sends, which needs sync: the locked account key. */
const saveKeys = (account: Account) =>
  as(account, 'PUT', '/api/sync/keys', {
    keyId: randomBytes(16).toString('base64url'),
    recovery: 'locked-account-key',
  });

const accessOf = async (account: Account) => (await account.client.account()).access;

/** Stripe telling the server about something, signed as Stripe signs it, unless told otherwise. */
function fromStripe(event: object, { secret = WEBHOOK_SECRET, secondsAgo = 0 } = {}) {
  const { body, signature } = signed(secret, event, secondsAgo);
  return fetch(new URL('/api/billing/stripe', server.url), {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body,
  });
}

const checkoutDone = (paid: FakeSubscription) =>
  fromStripe({
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', subscription: paid.id } },
  });

const changed = (paid: FakeSubscription, type = 'customer.subscription.updated') =>
  fromStripe({ type, data: { object: { id: paid.id } } });

/** An account paying for sync, as Stripe says once its checkout is done. */
async function paying(more: Partial<FakeSubscription> = {}) {
  const sam = await server.signUp();
  const paid = subscription(sam.id, more);
  stripe.customer(paid.customer);
  stripe.subscriptions.set(paid.id, paid);
  expect((await checkoutDone(paid)).status).toBe(200);
  return { sam, paid };
}

const operator = (path: string, body: object) =>
  fetch(new URL(path, server.url), { method: 'POST', headers: ADMIN, body: JSON.stringify(body) });

/** What the server keeps about an account's sync. */
const rowOf = (account: Account) =>
  server.env.DB.prepare('SELECT * FROM "syncAccess" WHERE account = ?')
    .bind(account.id)
    .first<{ customer: string | null; status: string | null; checkedAt: string | null }>();

describe('a server that sells sync', () => {
  it('tells the apps sync here is a subscription', async () => {
    expect(await server.clientFor(null).features()).toEqual([
      'approve',
      'subscription',
      'loopback-sign-in',
    ]);
  });

  it('lets an account without sync read, listen, call things off and pay, but send nothing', async () => {
    const sam = await server.signUp();
    const phone = await server.newSession(sam.id, 'Mozilla/5.0 (iPhone)');
    const refused = await saveKeys(sam);
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ error: 'subscription-needed' });
    expect((await as(sam, 'POST', '/api/sync/links', { id: 'x' })).status).toBe(402);
    for (const [method, path] of [
      ['GET', '/api/sync/changes?since=0'],
      ['POST', '/api/sync/live/ticket'],
      ['DELETE', `/api/sync/links/${randomBytes(16).toString('base64url')}`],
      ['POST', `/api/sync/requests/${randomBytes(16).toString('base64url')}/deny`],
    ] as const) {
      expect((await as(sam, method, path)).status, path).not.toBe(402);
    }
    expect((await as(sam, 'DELETE', `/api/account/devices/${phone.sessionId}`)).status).toBe(204);
    expect(await accessOf(sam)).toEqual({ allowed: false, gift: null, subscription: null });
  });

  it('keeps billing to a browser’s own sign-in, never a device code’s', async () => {
    const sam = await server.signUp();
    const desktop = await server.newSession(sam.id, 'Factwright/0.0.0 (Mac)', 'device');
    expect((await as(desktop, 'POST', '/api/billing/checkout', { period: 'month' })).status).toBe(
      403,
    );
    expect((await as(desktop, 'POST', '/api/billing/portal')).status).toBe(403);
  });

  it('starts Stripe’s checkout with the account’s own customer, made once', async () => {
    const sam = await server.signUp();
    const started = await as(sam, 'POST', '/api/billing/checkout', { period: 'year' });
    expect(await started.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const [made, opened] = stripe.requests.slice(-2);
    expect(made).toMatchObject({ path: '/v1/customers', idempotencyKey: `customer-${sam.id}` });
    expect(made?.form.get('metadata[account]')).toBe(sam.id);
    const form = Object.fromEntries(opened?.form ?? []);
    expect(opened).toMatchObject({
      authorization: 'Bearer rk_test_only',
      version: STRIPE_VERSION,
    });
    expect(form).toMatchObject({
      mode: 'subscription',
      customer: (await rowOf(sam))?.customer,
      'line_items[0][price]': 'price_year',
      'line_items[0][quantity]': '1',
      client_reference_id: sam.id,
      'subscription_data[metadata][account]': sam.id,
      success_url: `${server.url.origin}/subscribe/done`,
      cancel_url: `${server.url.origin}/subscribe`,
      // A box to tick, agreeing to the terms named in Stripe's public details.
      'consent_collection[terms_of_service]': 'required',
    });
    // Stripe's ordinary checkout, with Neatifai as the seller, and no tax added.
    expect(form['managed_payments[enabled]']).toBeUndefined();
    expect(form['automatic_tax[enabled]']).toBeUndefined();
    // It closes after about half an hour, so a tab left open can't pay later.
    const closes = Number(form.expires_at) - Date.now() / 1000;
    expect(closes).toBeGreaterThan(30 * 60);
    expect(closes).toBeLessThan(40 * 60);

    const again = await as(sam, 'POST', '/api/billing/checkout', { period: 'year' });
    expect(again.status).toBe(429);
    const other = await server.signUp();
    expect((await as(other, 'POST', '/api/billing/checkout', { period: 'week' })).status).toBe(400);
  });

  it('makes a new customer when Stripe has deleted the account’s old one', async () => {
    const sam = await server.signUp();
    await as(sam, 'POST', '/api/billing/checkout', { period: 'month' });
    const old = (await rowOf(sam))?.customer;
    stripe.forget(String(old));
    await server.env.DB.prepare('UPDATE "syncAccess" SET checkoutAt = NULL WHERE account = ?')
      .bind(sam.id)
      .run();
    const started = await as(sam, 'POST', '/api/billing/checkout', { period: 'month' });
    expect(started.status).toBe(200);
    expect((await rowOf(sam))?.customer).not.toBe(old);
  });

  it('follows a subscription on Stripe’s word, and only Stripe’s', async () => {
    const sam = await server.signUp();
    const paid = subscription(sam.id);
    stripe.customer(paid.customer);
    stripe.subscriptions.set(paid.id, paid);
    const event = {
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: paid.id } },
    };
    expect((await fromStripe(event, { secret: 'whsec_someone_else' })).status).toBe(400);
    expect((await fromStripe(event, { secondsAgo: 600 })).status).toBe(400);
    const unsigned = await fetch(new URL('/api/billing/stripe', server.url), {
      method: 'POST',
      body: JSON.stringify(event),
    });
    expect(unsigned.status).toBe(400);
    const huge = await fetch(new URL('/api/billing/stripe', server.url), {
      method: 'POST',
      body: 'x'.repeat(600 * 1024),
    });
    expect(huge.status).toBe(413);
    expect((await saveKeys(sam)).status).toBe(402);

    expect((await fromStripe(event)).status).toBe(200);
    expect((await saveKeys(sam)).status).toBe(204);
    const renews = new Date((paid.items.data[0]?.current_period_end ?? 0) * 1000).toISOString();
    expect(await accessOf(sam)).toEqual({
      allowed: true,
      gift: null,
      subscription: { state: 'active', renewsAt: renews },
    });
  });

  it('shows a subscription retrying, ending and ended, and stops sync once it’s ended', async () => {
    const { sam, paid } = await paying();
    paid.status = 'past_due';
    await changed(paid);
    expect((await accessOf(sam))?.subscription?.state).toBe('retrying');
    expect((await saveKeys(sam)).status).toBe(204);

    // A cancel in the customer portal, as newer Stripe accounts record it: an end date alone.
    paid.status = 'active';
    paid.cancel_at = Math.floor(Date.now() / 1000) + 3 * 86_400;
    await changed(paid);
    expect((await accessOf(sam))?.subscription).toEqual({
      state: 'ending',
      renewsAt: new Date(paid.cancel_at * 1000).toISOString(),
    });

    paid.status = 'canceled';
    await changed(paid, 'customer.subscription.deleted');
    expect(await accessOf(sam)).toMatchObject({ allowed: false, subscription: { state: 'ended' } });
    expect((await as(sam, 'POST', '/api/sync/links', { id: 'x' })).status).toBe(402);
  });

  it('cancels a second subscription for an account that has one, to be refunded', async () => {
    const { sam, paid } = await paying();
    const second = subscription(sam.id, { id: `${paid.id}_2`, customer: paid.customer });
    stripe.subscriptions.set(second.id, second);
    await checkoutDone(second);
    expect(second.status).toBe('canceled');
    expect(paid.status).toBe('active');
    expect((await accessOf(sam))?.subscription?.state).toBe('active');
  });

  it('cancels a subscription whose account isn’t here', async () => {
    const gone = subscription(randomBytes(16).toString('hex'));
    stripe.customer(gone.customer);
    stripe.subscriptions.set(gone.id, gone);
    expect((await checkoutDone(gone)).status).toBe(200);
    expect(gone.status).toBe('canceled');
  });

  it('never lets an older read of a subscription win over a newer one', async () => {
    const { sam, paid } = await paying();
    await server.env.DB.prepare('UPDATE "syncAccess" SET checkedAt = ? WHERE account = ?')
      .bind(new Date(Date.now() + 60_000).toISOString(), sam.id)
      .run();
    paid.status = 'canceled';
    await changed(paid, 'customer.subscription.deleted');
    expect((await rowOf(sam))?.status).toBe('active');
  });

  it('opens Stripe’s customer portal for an account that’s paid', async () => {
    const { sam, paid } = await paying();
    const opened = await as(sam, 'POST', '/api/billing/portal');
    expect(await opened.json()).toEqual({ url: 'https://billing.stripe.com/p/session/test_1' });
    expect(Object.fromEntries(stripe.requests.at(-1)?.form ?? [])).toEqual({
      customer: paid.customer,
      return_url: `${server.url.origin}/account`,
    });
    stripe.forget(paid.customer);
    expect((await as(sam, 'POST', '/api/billing/portal')).status).toBe(404);
    const never = await server.signUp();
    expect((await as(never, 'POST', '/api/billing/portal')).status).toBe(404);
  });

  it('won’t start a checkout for an account that has sync', async () => {
    const { sam } = await paying();
    expect((await as(sam, 'POST', '/api/billing/checkout', { period: 'month' })).status).toBe(409);
  });

  it('gives free sync by email to a verified account now, or to the next one with that email', async () => {
    const sam = await server.signUp();
    expect(await (await operator('/api/admin/free-sync', { email: sam.email })).json()).toEqual({
      free: true,
      to: 'account',
      wasPaying: false,
    });
    expect((await saveKeys(sam)).status).toBe(204);
    expect((await accessOf(sam))?.gift).toBe('free');

    // Someone who signed up with another person's unverified email doesn't get their gift.
    const unverified = `${randomBytes(6).toString('hex')}@example.com`;
    const mallory = await server.signUp('Mallory', { email: unverified, verified: false });
    expect(await (await operator('/api/admin/free-sync', { email: unverified })).json()).toEqual({
      free: true,
      to: 'email',
      wasPaying: false,
    });
    expect((await saveKeys(mallory)).status).toBe(402);

    const later = `${randomBytes(6).toString('hex')}@example.com`;
    await operator('/api/admin/free-sync', { email: ` ${later.toUpperCase()} ` });
    const dana = await server.signUp('Dana', { email: later });
    expect((await saveKeys(dana)).status).toBe(204);
    expect((await accessOf(dana))?.gift).toBe('free');
    const waiting = await server.env.DB.prepare('SELECT * FROM "freeSyncEmail" WHERE email = ?')
      .bind(later)
      .first();
    expect(waiting).toBeNull();
  });

  it('takes free sync back, from an account and from an email still waiting', async () => {
    const sam = await server.signUp();
    await operator('/api/admin/free-sync', { email: sam.email });
    await operator('/api/admin/free-sync', { email: sam.email, off: true });
    expect(await accessOf(sam)).toMatchObject({ allowed: false, gift: null });

    const later = `${randomBytes(6).toString('hex')}@example.com`;
    await operator('/api/admin/free-sync', { email: later });
    await operator('/api/admin/free-sync', { email: later, off: true });
    const dana = await server.signUp('Dana', { email: later });
    expect((await saveKeys(dana)).status).toBe(402);
  });

  it('ends a paying account’s subscription with its time paid for, once it’s given free sync', async () => {
    const { sam, paid } = await paying();
    const given = await operator('/api/admin/free-sync', { email: sam.email });
    expect(await given.json()).toEqual({ free: true, to: 'account', wasPaying: true });
    expect(stripe.requests.at(-1)).toMatchObject({
      method: 'POST',
      path: `/v1/subscriptions/${paid.id}`,
    });
    expect(paid.cancel_at_period_end).toBe(true);
    expect(await accessOf(sam)).toMatchObject({ gift: 'free', subscription: { state: 'ending' } });
  });

  it('keeps sync for good for accounts made before it was sold', async () => {
    const before = new Date(Date.parse(SELLING_SINCE) - 86_400_000);
    const sam = await server.signUp('Sam', { since: before });
    expect(await accessOf(sam)).toMatchObject({ allowed: true, gift: 'early' });
    await operator('/api/admin/free-sync', { email: sam.email, off: true });
    expect((await saveKeys(sam)).status).toBe(204);
  });

  it('lets only the operator give sync away', async () => {
    const sam = await server.signUp();
    const tried = await as(sam, 'POST', '/api/admin/free-sync', { email: sam.email });
    expect(tried.status).toBe(404);
    expect((await accessOf(sam))?.allowed).toBe(false);
  });

  it('puts the account’s billing in its export', async () => {
    const { sam, paid } = await paying();
    const exported = (await (await as(sam, 'GET', '/api/account/export')).json()) as {
      billing: object;
    };
    expect(exported.billing).toMatchObject({
      customer: paid.customer,
      subscription: paid.id,
      status: 'active',
      canceling: false,
    });
  });

  it('checks once a day on subscriptions Stripe hasn’t sent word about', async () => {
    const { sam, paid } = await paying();
    await server.env.DB.prepare('UPDATE "syncAccess" SET renewsAt = ? WHERE account = ?')
      .bind(new Date(Date.now() - 3 * 86_400_000).toISOString(), sam.id)
      .run();
    paid.status = 'canceled';
    server.worker.scheduled({ cron: '17 4 * * *', scheduledTime: new Date() });
    await expect.poll(async () => (await rowOf(sam))?.status).toBe('canceled');
  });

  it('deletes the account’s Stripe customer before the account, or doesn’t delete it', async () => {
    const { sam, paid } = await paying();
    stripe.fail(500);
    const failed = await as(sam, 'POST', '/api/auth/delete-user', {});
    stripe.fail(null);
    expect(failed.status).toBe(500);
    expect((await sam.client.account()).user.id).toBe(sam.id);

    const deleted = await as(sam, 'POST', '/api/auth/delete-user', {});
    expect(deleted.status).toBe(200);
    expect(stripe.requests.at(-1)).toMatchObject({
      method: 'DELETE',
      path: `/v1/customers/${paid.customer}`,
    });
    expect(paid.status).toBe('canceled');
    await expect(sam.client.account()).rejects.toMatchObject({ kind: 'signed-out' });
  });

  it('cancels its subscriptions when the operator deletes an account', async () => {
    const { sam, paid } = await paying();
    expect((await operator('/api/admin/delete', { account: sam.id })).status).toBe(204);
    expect(paid.status).toBe('canceled');
  });

  it('asks for the API version it’s written for, every time it calls Stripe', () => {
    const calls = stripe.requests.map(
      ({ method, path }) => `${method} ${path.replace(/\/(?:cus|sub)_[^/]+$/, '/:id')}`,
    );
    expect(new Set(calls)).toEqual(
      new Set([
        'POST /v1/customers',
        'DELETE /v1/customers/:id',
        'POST /v1/checkout/sessions',
        'POST /v1/billing_portal/sessions',
        'GET /v1/subscriptions/:id',
        'POST /v1/subscriptions/:id',
        'DELETE /v1/subscriptions/:id',
      ]),
    );
    expect(stripe.requests.filter(({ version }) => version !== STRIPE_VERSION)).toEqual([]);
  });
});

/** Starts a checkout for an account on a server, as its account page in the browser does. */
const checkout = (on: TestServer, account: Account, period: string) =>
  fetch(new URL('/api/billing/checkout', on.url), {
    method: 'POST',
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ period }),
  });

describe('a server that sells sync through Stripe Managed Payments', () => {
  let managed: TestServer;

  beforeAll(async () => {
    managed = await startServer({ ...selling(), STRIPE_MANAGED_PAYMENTS: 'true' });
  });

  afterAll(async () => {
    await managed?.close();
  });

  it('starts Stripe’s checkout with Managed Payments on, and nothing it refuses', async () => {
    const sam = await managed.signUp();
    const started = await checkout(managed, sam, 'month');
    expect(await started.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const opened = stripe.requests.at(-1);
    expect(opened).toMatchObject({ path: '/v1/checkout/sessions', version: STRIPE_VERSION });
    const form = Object.fromEntries(opened?.form ?? []);
    expect(form).toMatchObject({
      mode: 'subscription',
      'line_items[0][price]': 'price_month',
      'line_items[0][quantity]': '1',
      client_reference_id: sam.id,
      'subscription_data[metadata][account]': sam.id,
      success_url: `${managed.url.origin}/subscribe/done`,
      cancel_url: `${managed.url.origin}/subscribe`,
      'consent_collection[terms_of_service]': 'required',
      'managed_payments[enabled]': 'true',
    });
    // Its own customer, which Stripe fills in with the name and address the tax needs.
    expect(form.customer).toMatch(/^cus_/);
    const refused = Object.keys(form).filter((name) =>
      REFUSED_BY_MANAGED_PAYMENTS.some((start) => name.startsWith(start)),
    );
    expect(refused).toEqual([]);
  });
});

describe('a server whose way of selling sync is neither true nor false', () => {
  let unsure: TestServer;

  beforeAll(async () => {
    unsure = await startServer({ ...selling(), STRIPE_MANAGED_PAYMENTS: 'yes' });
  });

  afterAll(async () => {
    await unsure?.close();
  });

  it('starts no checkout, rather than guess which way the terms say', async () => {
    const sam = await unsure.signUp();
    const asked = stripe.requests.length;
    expect((await checkout(unsure, sam, 'year')).status).toBe(500);
    expect(stripe.requests.length).toBe(asked);
  });
});
