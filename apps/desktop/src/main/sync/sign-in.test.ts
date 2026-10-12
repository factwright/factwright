import { startServer, type TestServer } from '@factwright/server/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeviceSignIn } from './sign-in.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const USER_AGENT = `Factwright/0.0.0 (${encodeURIComponent('Sam’s Mac')})`;

/** The browser page: signed in, it opens the code, then approves or denies it. */
async function browser(code: string, token: string, answer: 'approve' | 'deny') {
  const userCode = code.replace('-', '');
  await fetch(new URL(`/api/auth/device?user_code=${userCode}`, server.url), {
    headers: { authorization: `Bearer ${token}` },
  });
  await fetch(new URL(`/api/auth/device/${answer}`, server.url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ userCode }),
  });
}

const signIn = () =>
  new DeviceSignIn({
    server: server.url.toString(),
    userAgent: USER_AGENT,
    sleep: async () => {},
  });

describe('signing the app in through the browser', () => {
  it('shows a code to check, then gets the app’s own session once it’s approved', async () => {
    const flow = signIn();
    const pending = await flow.start();
    expect(pending.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(pending.url).toContain('/device?user_code=');
    const sam = await server.signUp();
    await browser(pending.code, sam.token, 'approve');
    const result = await flow.finish();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const account = await server.clientFor(result.token, USER_AGENT).account();
    expect(account.user.id).toBe(sam.id);
    expect(account.devices.find((device) => device.current)?.name).toBe('Factwright on Sam’s Mac');
  });

  it('stops when the browser declines, or the user cancels', async () => {
    const declined = signIn();
    const pending = await declined.start();
    const sam = await server.signUp();
    await browser(pending.code, sam.token, 'deny');
    expect(await declined.finish()).toMatchObject({ ok: false, reason: 'denied' });

    const canceled = new DeviceSignIn({
      server: server.url.toString(),
      userAgent: USER_AGENT,
      sleep: (_ms, signal) =>
        new Promise((resolve) => signal.addEventListener('abort', () => resolve())),
    });
    await canceled.start();
    const stopped = canceled.finish();
    canceled.cancel();
    expect(await stopped).toMatchObject({ ok: false, reason: 'canceled' });
  });
});
