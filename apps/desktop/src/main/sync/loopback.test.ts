import { request } from 'node:http';
import { challengeOf } from '@factwright/sync';
import { describe, expect, it } from 'vitest';
import { LoopbackFlow } from './loopback.ts';

const SERVER = 'https://sync.sam.example';
const ISS = encodeURIComponent(SERVER);
const CODE = 'c'.repeat(43);

/** A sign-in whose trades get `reply`, noting each, and what its page asked. */
async function started(
  reply: () => Response | Promise<Response> = () => Response.json({ access_token: 'session' }),
  waitMs?: number,
) {
  const trades: Record<string, unknown>[] = [];
  const flow = new LoopbackFlow({
    server: SERVER,
    userAgent: 'Factwright/0.9.0 (Sam%E2%80%99s%20Mac)',
    fetch: async (_url, init) => {
      trades.push(JSON.parse(String(init?.body)));
      return reply();
    },
    ...(waitMs !== undefined && { waitMs }),
  });
  const { code, url } = await flow.start();
  const asked = new URL(url).searchParams;
  return {
    flow,
    code,
    url,
    trades,
    back: asked.get('redirect_uri') ?? '',
    state: asked.get('state') ?? '',
    challenge: asked.get('code_challenge') ?? '',
  };
}

/** The browser, going to an address on this computer, as it would: the page it got. */
async function visit(address: string, init: RequestInit = {}) {
  const response = await fetch(address, init);
  return { status: response.status, text: await response.text(), headers: response.headers };
}

/**
 * A request with a Host and a path of its own, as a web page that named this computer otherwise
 * would send, or a path no address has.
 */
function visitAs(host: string, address: string, path?: string): Promise<number> {
  const url = new URL(address);
  return new Promise((resolve, reject) => {
    request({
      host: url.hostname,
      port: url.port,
      path: path ?? url.pathname + url.search,
      headers: { host },
    })
      .on('response', (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      })
      .on('error', reject)
      .end();
  });
}

describe('signing in back on this computer', () => {
  it('asks the server’s page, with nothing to show, to come back to an address here', async () => {
    const { flow, code, url, back, challenge } = await started();
    expect(code).toBeNull();
    expect(url.startsWith(`${SERVER}/sign-in/desktop?`)).toBe(true);
    expect(back).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/signed-in$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    flow.cancel();
  });

  it('takes this sign-in’s answer, trades its code, and says so in the browser', async () => {
    const { flow, back, state, challenge, trades } = await started();
    const page = await visit(`${back}?code=${CODE}&state=${state}&iss=${ISS}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('<h1>Factwright is signed in</h1>');
    expect(page.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await flow.finish()).toEqual({ ok: true, token: 'session' });
    expect(trades).toHaveLength(1);
    expect(await challengeOf(String(trades[0]?.code_verifier))).toBe(challenge);
    // It listens no more.
    await expect(fetch(back)).rejects.toThrow();
  });

  it('keeps waiting through anything that isn’t this sign-in’s answer', async () => {
    const { flow, back, state, trades } = await started();
    const other = await visit(`${back}?code=${CODE}&state=${state}x&iss=${ISS}`);
    expect(other.status).toBe(400);
    expect(other.text).toContain('This isn’t the sign-in Factwright is waiting for.');
    expect((await visit(`${new URL(back).origin}/favicon.ico`)).status).toBe(404);
    expect(
      (await visit(`${back}?code=${CODE}&state=${state}&iss=${ISS}`, { method: 'POST' })).status,
    ).toBe(405);
    // Another name for this computer, as a web page could point one at it.
    expect(await visitAs('evil.example', `${back}?code=${CODE}&state=${state}&iss=${ISS}`)).toBe(
      400,
    );
    expect(await visitAs('localhost', `${back}?code=${CODE}&state=${state}&iss=${ISS}`)).toBe(400);
    expect(trades).toEqual([]);

    expect((await visit(`${back}?code=${CODE}&state=${state}&iss=${ISS}`)).status).toBe(200);
    expect(await flow.finish()).toEqual({ ok: true, token: 'session' });
  });

  it('answers a request it can’t read, and keeps waiting', async () => {
    const { flow, back, state } = await started();
    const here = new URL(back).host;
    expect(await visitAs(here, back, '//[')).toBe(400);
    expect((await visit(`${back}?code=${CODE}&state=${state}&iss=${ISS}`)).status).toBe(200);
    expect(await flow.finish()).toEqual({ ok: true, token: 'session' });
  });

  it('ends with an answer another server gave, and sends its code nowhere', async () => {
    const { flow, back, state, trades } = await started();
    const iss = encodeURIComponent('https://app.factwright.com');
    const page = await visit(`${back}?code=${CODE}&state=${state}&iss=${iss}`);
    expect(page.status).toBe(400);
    expect(page.text).toContain('<h1>Factwright didn’t sign in</h1>');
    expect(page.text).toContain(
      'That sign-in came back from app.factwright.com, not sync.sam.example, so Factwright didn’t use it. Go back to Factwright to try again.',
    );
    expect(await flow.finish()).toMatchObject({ ok: false, reason: 'failed' });
    expect(trades).toEqual([]);
  });

  it('says no when the person turned it away', async () => {
    const { flow, back, state, trades } = await started();
    const page = await visit(`${back}?error=access_denied&state=${state}&iss=${ISS}`);
    expect(page.text).toContain('<h1>Factwright won’t sign in</h1>');
    expect(await flow.finish()).toMatchObject({ ok: false, reason: 'denied' });
    expect(trades).toEqual([]);
  });

  it('runs out, and listens no more', async () => {
    const { flow, back } = await started(undefined, 50);
    expect(await flow.finish()).toEqual({
      ok: false,
      reason: 'expired',
      message: 'The sign-in ran out. Try again.',
    });
    await expect(fetch(back)).rejects.toThrow();
  });

  it('stops at once when called off, and listens no more', async () => {
    const { flow, back } = await started();
    const finishing = flow.finish();
    flow.cancel();
    expect(await finishing).toMatchObject({ ok: false, reason: 'canceled' });
    expect(flow.canceled).toBe(true);
    await expect(fetch(back)).rejects.toThrow();
  });

  it('called off as its code is traded, says how the trade went, so the session can be ended', async () => {
    let trading: () => void = () => {};
    const traded = new Promise<void>((resolve) => {
      trading = resolve;
    });
    let release: () => void = () => {};
    const { flow, back, state } = await started(async () => {
      trading();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({ access_token: 'session' });
    });
    const page = visit(`${back}?code=${CODE}&state=${state}&iss=${ISS}`);
    await traded;
    flow.cancel();
    release();
    expect(await flow.finish()).toEqual({ ok: true, token: 'session' });
    expect(flow.canceled).toBe(true);
    expect((await page).text).toContain('Signing in was canceled in Factwright.');
  });

  it('running out as its code is traded, says how the trade went, so the session can be ended', async () => {
    let release: () => void = () => {};
    const { flow, back, state, trades } = await started(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({ access_token: 'session' });
    }, 100);
    const finishing = flow.finish();
    const page = visit(`${back}?code=${CODE}&state=${state}&iss=${ISS}`);
    await expect.poll(() => trades.length).toBe(1);
    // Past its time, with the trade still going.
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    expect(await finishing).toEqual({ ok: true, token: 'session' });
    expect((await page).status).toBe(200);
  });

  it('takes one answer only', async () => {
    let release: () => void = () => {};
    const { flow, back, state, trades } = await started(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({ access_token: 'session' });
    });
    const answer = `${back}?code=${CODE}&state=${state}&iss=${ISS}`;
    const first = visit(answer);
    await expect.poll(() => trades.length).toBe(1);
    const second = await visit(answer);
    expect(second.status).toBe(400);
    expect(second.text).toContain('This isn’t the sign-in Factwright is waiting for.');
    release();
    expect((await first).status).toBe(200);
    expect(await flow.finish()).toEqual({ ok: true, token: 'session' });
    expect(trades).toHaveLength(1);
  });
});
