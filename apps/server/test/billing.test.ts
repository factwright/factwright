import { randomBytes } from 'node:crypto';
import type { SyncAccess } from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Account, startServer, type TestServer } from './server.ts';
import { type FakeStripe, signed, startStripe, subscription } from './stripe.ts';

/** Factwright's own server, selling sync through a stand-in for Stripe. */
const WEBHOOK_SECRET = 'whsec_test_only_0123456789';
const ADMIN = { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' };

let stripe: FakeStripe;
let server: TestServer;

beforeAll(async () => {
  stripe = await startStripe();
  server = await startServer({
    STRIPE_SECRET_KEY: 'rk_test_only',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_MONTHLY: 'price_month',
    STRIPE_PRICE_YEARLY: 'price_year',
    STRIPE_API_URL: stripe.url,
  });
});

afterAll(async () => {
  await server?.close();
  await stripe?.close();
});

/** A request as the desktop app sends it, with its session. */
function asApp(account: Account, method: string, path: string, body?: object) {
  return fetch(new URL(path, server.url), {
    method,
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
}

/** The first thing turning sync on sends, which needs sync: the locked account key. */
const saveKeys = (account: Account) =>
  asApp(account, 'PUT', '/api/sync/keys', {
    keyId: randomBytes(16).toString('base64url'),
    recovery: 'locked-account-key',
  });

const accessFor = async (account: Account) =>
  ((await (await asApp(account, 'GET', '/api/account')).json()) as { access: SyncAccess }).access;

/** Stripe telling the server about something, signed as Stripe signs it, unless told otherwise. */
function fromStripe(event: object, { secret = WEBHOOK_SECRET, secondsAgo = 0 } = {}) {
  const { body, signature } = signed(secret, event, secondsAgo);
  return fetch(new URL('/api/billing/stripe', server.url), {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body,
  });
}

/** An account paying for sync, as Stripe says once its checkout is done. */
async function paying(more: Parameters<typeof subscription>[1] = {}) {
  const sam = await server.signUp();
  const paid = subscription(sam.id, more);
  stripe.subscriptions.set(paid.id, paid);
  const done = await fromStripe({
    type: 'checkout.session.completed',
    data: {
      object: { mode: 'subscription', subscription: paid.id, client_reference_id: sam.id },
    },
  });
  expect(done.status).toBe(200);
  return { sam, paid };
}

const operator = (path: string, body: object) =>
  fetch(new URL(path, server.url), { method: 'POST', headers: ADMIN, body: JSON.stringify(body) });

describe('a server that sells sync', () => {
  it('tells the apps sync here is a subscription', async () => {
    const response = await fetch(new URL('/api/sign-in-options', server.url));
    expect(((await response.json()) as { features: string[] }).features).toEqual([
      'approve',
      'subscription',
    ]);
  });

  it('lets an account without sync read, sign a device out and pay, but send nothing', async () => {
    const sam = await server.signUp();
    const phone = await server.newSession(sam.id, 'Mozilla/5.0 (iPhone)');
    const refused = await saveKeys(sam);
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ error: 'subscription-needed' });
    expect((await asApp(sam, 'POST', '/api/sync/live/ticket')).status).toBe(402);
    expect((await asApp(sam, 'GET', '/api/sync/changes?since=0')).status).toBe(200);
    expect((await asApp(sam, 'DELETE', `/api/account/devices/${phone.sessionId}`)).status).toBe(
      204,
    );
    expect(await accessFor(sam)).toEqual({ allowed: false, gift: null, subscription: null });
  });

  it('starts Stripe’s checkout for a month or a year, naming the account', async () => {
    const sam = await server.signUp();
    const started = await asApp(sam, 'POST', '/api/billing/checkout', { period: 'year' });
    expect(await started.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const asked = stripe.requests.at(-1);
    expect(asked?.authorization).toBe('Bearer rk_test_only');
    expect(Object.fromEntries(asked?.form ?? [])).toEqual({
      mode: 'subscription',
      'line_items[0][price]': 'price_year',
      'line_items[0][quantity]': '1',
      client_reference_id: sam.id,
      'subscription_data[metadata][account]': sam.id,
      success_url: `${server.url.origin}/subscribe/done`,
      cancel_url: `${server.url.origin}/subscribe`,
      customer_email: sam.email,
    });
    const week = await asApp(sam, 'POST', '/api/billing/checkout', { period: 'week' });
    expect(week.status).toBe(400);
  });

  it('follows a subscription on Stripe’s word, and only Stripe’s', async () => {
    const sam = await server.signUp();
    const paid = subscription(sam.id);
    stripe.subscriptions.set(paid.id, paid);
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: { mode: 'subscription', subscription: paid.id, client_reference_id: sam.id },
      },
    };
    expect((await fromStripe(event, { secret: 'whsec_someone_else' })).status).toBe(400);
    expect((await fromStripe(event, { secondsAgo: 600 })).status).toBe(400);
    const unsigned = await fetch(new URL('/api/billing/stripe', server.url), {
      method: 'POST',
      body: JSON.stringify(event),
    });
    expect(unsigned.status).toBe(400);
    expect((await saveKeys(sam)).status).toBe(402);

    expect((await fromStripe(event)).status).toBe(200);
    expect((await saveKeys(sam)).status).toBe(204);
    const renews = new Date((paid.items.data[0]?.current_period_end ?? 0) * 1000).toISOString();
    expect(await accessFor(sam)).toEqual({
      allowed: true,
      gift: null,
      subscription: { status: 'active', renewsAt: renews, canceling: false },
    });
  });

  it('keeps syncing while a payment is retried, and stops once the subscription ends', async () => {
    const { sam, paid } = await paying();
    const changed = (type: string) =>
      fromStripe({ type, data: { object: { id: paid.id, metadata: { account: sam.id } } } });

    paid.status = 'past_due';
    await changed('customer.subscription.updated');
    expect((await asApp(sam, 'POST', '/api/sync/live/ticket')).status).toBe(200);

    paid.cancel_at_period_end = true;
    paid.status = 'active';
    await changed('customer.subscription.updated');
    expect((await accessFor(sam)).subscription).toMatchObject({ canceling: true });

    paid.status = 'canceled';
    await changed('customer.subscription.deleted');
    expect((await asApp(sam, 'POST', '/api/sync/live/ticket')).status).toBe(402);
    expect((await accessFor(sam)).allowed).toBe(false);
  });

  it('won’t let late word about an old subscription stop a new one', async () => {
    const { sam } = await paying({ id: 'sub_new' });
    const old = subscription(sam.id, { id: 'sub_old', status: 'canceled' });
    stripe.subscriptions.set(old.id, old);
    await fromStripe({
      type: 'customer.subscription.deleted',
      data: { object: { id: old.id, metadata: { account: sam.id } } },
    });
    expect(await accessFor(sam)).toMatchObject({
      allowed: true,
      subscription: { status: 'active' },
    });
  });

  it('opens Stripe’s customer portal for an account that’s paid', async () => {
    const { sam, paid } = await paying();
    const opened = await asApp(sam, 'POST', '/api/billing/portal');
    expect(await opened.json()).toEqual({ url: 'https://billing.stripe.com/p/session/test_1' });
    expect(Object.fromEntries(stripe.requests.at(-1)?.form ?? [])).toEqual({
      customer: paid.customer,
      return_url: `${server.url.origin}/account`,
    });
    const never = await server.signUp();
    expect((await asApp(never, 'POST', '/api/billing/portal')).status).toBe(404);
  });

  it('won’t start a checkout for an account that has sync', async () => {
    const { sam } = await paying();
    const again = await asApp(sam, 'POST', '/api/billing/checkout', { period: 'month' });
    expect(again.status).toBe(409);
  });

  it('gives free sync to someone who asked, by email, and takes it back', async () => {
    const sam = await server.signUp();
    expect(await (await operator('/api/admin/free-sync', { email: sam.email })).json()).toEqual({
      free: true,
      account: true,
    });
    expect((await saveKeys(sam)).status).toBe(204);
    expect((await accessFor(sam)).gift).toBe('free');

    await operator('/api/admin/free-sync', { email: sam.email, off: true });
    expect(await accessFor(sam)).toMatchObject({ allowed: false, gift: null });
  });

  it('gives free sync to an email before it has an account, once it signs up verified', async () => {
    const email = `${randomBytes(6).toString('hex')}@example.com`;
    const given = await operator('/api/admin/free-sync', { email: email.toUpperCase() });
    expect(await given.json()).toEqual({ free: true, account: false });
    const unverified = await server.signUp('Ana', { email, verified: false });
    expect((await saveKeys(unverified)).status).toBe(402);

    const other = `${randomBytes(6).toString('hex')}@example.com`;
    await operator('/api/admin/free-sync', { email: other });
    const dana = await server.signUp('Dana', { email: other });
    expect((await saveKeys(dana)).status).toBe(204);
    expect((await accessFor(dana)).gift).toBe('free');
  });

  it('gives every account there is now sync for good, for the people who had it first', async () => {
    const sam = await server.signUp();
    const marked = await operator('/api/admin/early', {});
    expect(((await marked.json()) as { accounts: number }).accounts).toBeGreaterThan(0);
    expect((await accessFor(sam)).gift).toBe('early');
    await operator('/api/admin/free-sync', { email: sam.email, off: true });
    expect((await saveKeys(sam)).status).toBe(204);
    const later = await server.signUp();
    expect((await accessFor(later)).gift).toBeNull();
  });

  it('lets only the operator give sync away', async () => {
    const sam = await server.signUp();
    for (const path of ['/api/admin/free-sync', '/api/admin/early']) {
      const tried = await fetch(new URL(path, server.url), {
        method: 'POST',
        headers: { authorization: `Bearer ${sam.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email: sam.email }),
      });
      expect(tried.status).toBe(404);
    }
    expect((await accessFor(sam)).allowed).toBe(false);
  });

  it('cancels a subscription before its account is deleted, or doesn’t delete it', async () => {
    const { sam, paid } = await paying();
    stripe.fail(500);
    const failed = await operator('/api/admin/delete', { account: sam.id });
    stripe.fail(null);
    expect(failed.status).toBe(500);
    expect((await asApp(sam, 'GET', '/api/account')).status).toBe(200);

    const deleted = await operator('/api/admin/delete', { account: sam.id });
    expect(deleted.status).toBe(204);
    expect(stripe.requests.at(-1)).toMatchObject({
      method: 'DELETE',
      path: `/v1/subscriptions/${paid.id}`,
    });
    expect(paid.status).toBe('canceled');
  });
});
