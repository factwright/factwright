import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { text } from 'node:stream/consumers';

/** A request the stand-in for Stripe got. */
interface StripeRequest {
  method: string;
  path: string;
  form: URLSearchParams;
  authorization: string | undefined;
  idempotencyKey: string | undefined;
  /** The API version it asked for (Stripe-Version). */
  version: string | undefined;
}

/** A subscription as the stand-in keeps it, in the shape of the API version the server asks for. */
export interface FakeSubscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  metadata: { account?: string };
  items: { data: { current_period_end: number }[] };
}

/**
 * Stands in for Stripe's API, on this computer: customers to make and delete, checkout and
 * portal sessions, and subscriptions to read, update and cancel. It keeps each request, in
 * order, and fails them all while told to.
 */
export async function startStripe() {
  const requests: StripeRequest[] = [];
  const subscriptions = new Map<string, FakeSubscription>();
  const customers = new Map<string, { id: string; deleted: boolean }>();
  const byKey = new Map<string, string>();
  let made = 0;
  let failing: number | null = null;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://stripe.test');
    const form = new URLSearchParams(await text(request));
    const key = request.headers['idempotency-key'];
    const version = request.headers['stripe-version'];
    requests.push({
      method: request.method ?? '',
      path: url.pathname,
      form,
      authorization: request.headers.authorization,
      idempotencyKey: typeof key === 'string' ? key : undefined,
      version: typeof version === 'string' ? version : undefined,
    });
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const missing = (param?: string) =>
      send(param ? 400 : 404, { error: { code: 'resource_missing', ...(param && { param }) } });
    const live = (id: string | null) => Boolean(id && customers.get(id)?.deleted === false);
    if (failing) return send(failing, { error: { message: 'The stand-in is failing.' } });

    if (request.method === 'POST' && url.pathname === '/v1/customers') {
      const known = typeof key === 'string' ? byKey.get(key) : undefined;
      const id = known ?? `cus_${++made}`;
      if (!known) customers.set(id, { id, deleted: false });
      if (typeof key === 'string') byKey.set(key, id);
      return send(200, {
        id,
        email: form.get('email'),
        metadata: { account: form.get('metadata[account]') },
      });
    }
    const customer = /^\/v1\/customers\/([^/]+)$/.exec(url.pathname)?.[1];
    if (request.method === 'DELETE' && customer) {
      const found = customers.get(customer);
      if (!found || found.deleted) return missing();
      found.deleted = true;
      for (const each of subscriptions.values()) {
        if (each.customer === customer) each.status = 'canceled';
      }
      return send(200, { id: customer, deleted: true });
    }
    if (request.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      if (!live(form.get('customer'))) return missing('customer');
      return send(200, { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    }
    if (request.method === 'POST' && url.pathname === '/v1/billing_portal/sessions') {
      if (!live(form.get('customer'))) return missing('customer');
      return send(200, { id: 'bps_test_1', url: 'https://billing.stripe.com/p/session/test_1' });
    }
    const id = /^\/v1\/subscriptions\/([^/]+)$/.exec(url.pathname)?.[1];
    const subscription = id ? subscriptions.get(decodeURIComponent(id)) : undefined;
    if (!subscription) return missing();
    if (request.method === 'DELETE') {
      // As Stripe does, a subscription that's over can't be canceled again.
      if (subscription.status === 'canceled') {
        return send(400, { error: { message: 'This subscription is canceled.' } });
      }
      subscription.status = 'canceled';
    }
    if (request.method === 'POST' && form.get('cancel_at_period_end') === 'true') {
      subscription.cancel_at_period_end = true;
    }
    send(200, subscription);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    subscriptions,
    /** Makes a customer, as if checkout had, for subscriptions made by hand. */
    customer(id: string) {
      customers.set(id, { id, deleted: false });
      return id;
    },
    /** Deletes a customer, as if someone had in Stripe's dashboard. */
    forget(id: string) {
      customers.delete(id);
    },
    /** Answers every request with this status, until it's given null. */
    fail(status: number | null) {
      failing = status;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeStripe = Awaited<ReturnType<typeof startStripe>>;

/** A subscription for an account, active and renewing in a month, unless told otherwise. */
export function subscription(account: string, more: Partial<FakeSubscription> = {}) {
  return {
    id: `sub_${account.slice(0, 8)}`,
    status: 'active',
    customer: `cus_${account.slice(0, 8)}`,
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { account },
    items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400 }] },
    ...more,
  } satisfies FakeSubscription;
}

/** A webhook event's body, signed the way Stripe signs them, some seconds before now. */
export function signed(secret: string, event: object, secondsAgo = 0) {
  const body = JSON.stringify(event);
  const time = Math.floor(Date.now() / 1000) - secondsAgo;
  const v1 = createHmac('sha256', secret).update(`${time}.${body}`).digest('hex');
  return { body, signature: `t=${time},v1=${v1}` };
}
