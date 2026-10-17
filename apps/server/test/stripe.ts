import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A request the stand-in for Stripe got. */
export interface StripeRequest {
  method: string;
  path: string;
  form: URLSearchParams;
  authorization: string | undefined;
}

/** A subscription as the stand-in keeps it, in the shape of Stripe's newer API versions. */
export interface FakeSubscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  metadata: { account?: string };
  items: { data: { current_period_end: number }[] };
}

const read = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
  });

/**
 * Stands in for Stripe's API, on this computer: checkout and portal sessions, and subscriptions
 * to read and cancel. It keeps each request, in order, and fails them all while told to.
 */
export async function startStripe() {
  const requests: StripeRequest[] = [];
  const subscriptions = new Map<string, FakeSubscription>();
  let failing: number | null = null;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://stripe.test');
    requests.push({
      method: request.method ?? '',
      path: url.pathname,
      form: new URLSearchParams(await read(request)),
      authorization: request.headers.authorization,
    });
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (failing) return send(failing, { error: { message: 'The stand-in is failing.' } });
    if (request.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      return send(200, { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    }
    if (request.method === 'POST' && url.pathname === '/v1/billing_portal/sessions') {
      return send(200, { id: 'bps_test_1', url: 'https://billing.stripe.com/p/session/test_1' });
    }
    const id = /^\/v1\/subscriptions\/([^/]+)$/.exec(url.pathname)?.[1];
    const subscription = id ? subscriptions.get(decodeURIComponent(id)) : undefined;
    if (subscription && request.method === 'DELETE') subscription.status = 'canceled';
    if (subscription) return send(200, subscription);
    send(404, { error: { code: 'resource_missing' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    subscriptions,
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
