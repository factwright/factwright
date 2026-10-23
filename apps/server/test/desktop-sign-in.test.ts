import {
  challengeOf,
  DESKTOP_SIGN_IN,
  EXTENSION_SIGN_IN,
  loopbackReturn,
  randomBytes,
  STORE_RETURNS,
  toBase64Url,
} from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DESKTOP_ANSWER_PATH, DESKTOP_TOKEN_PATH } from '../src/desktop-sign-in.ts';
import { sessionCookie, startServer, type TestServer } from './server.ts';

let server: TestServer;

/** The app's address on the computer, at the port it picked to listen at. */
const BACK = loopbackReturn(51004);

beforeAll(async () => {
  // As a server of your own runs: at the address each request came to.
  server = await startServer({ APP_URL: '', TERMS_URL: '', PRIVACY_URL: '' });
});

afterAll(() => server?.close());

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** What the app says it is, with its computer's name, as it sends it. */
const APP = 'Factwright/0.9.0 (Sam%E2%80%99s%20Mac)';

/** What the app makes for one sign-in: its verifier, the challenge and the state. */
async function newAsk(redirect: unknown = BACK) {
  const verifier = toBase64Url(randomBytes(32));
  return {
    verifier,
    values: {
      client_id: 'factwright-desktop',
      response_type: 'code',
      redirect_uri: redirect,
      code_challenge: await challengeOf(verifier),
      code_challenge_method: 'S256',
      state: toBase64Url(randomBytes(16)),
    } as Record<string, unknown>,
  };
}

/**
 * The web view's page answering, from a browser signed in with `token`'s session, for the account
 * it names.
 */
async function answer(
  values: Record<string, unknown>,
  allow: boolean,
  {
    token,
    account,
    origin = server.url.origin,
  }: { token?: string; account?: string; origin?: string } = {},
) {
  const response = await fetch(new URL(DESKTOP_SIGN_IN.answer, server.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': CHROME_ON_MAC,
      ...(token && { cookie: sessionCookie(token), origin }),
    },
    body: JSON.stringify({ ...values, allow, ...(account && { account }) }),
  });
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** What the answer carries back to the app, in its query. */
const query = (url: unknown) => new URL(String(url)).searchParams;

/** The app trading a code, as it does from the computer: no cookies, its own name. */
async function trade(
  code: unknown,
  verifier: string,
  {
    redirect = BACK,
    at = DESKTOP_SIGN_IN.token,
    client = 'factwright-desktop',
  }: { redirect?: string; at?: string; client?: string } = {},
) {
  const response = await fetch(new URL(at, server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': APP },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: client,
      redirect_uri: redirect,
    }),
  });
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** A code for Sam, allowed from Sam's browser. */
async function allowed(redirect = BACK) {
  const sam = await server.signUp();
  const ask = await newAsk(redirect);
  const answered = await answer(ask.values, true, { token: sam.token, account: sam.id });
  expect(answered.status).toBe(200);
  return { sam, ask, code: query(answered.body.url).get('code') ?? '' };
}

describe('signing the desktop app in through the browser, back to its computer', () => {
  it('sits under sign-in’s own paths', () => {
    expect(DESKTOP_SIGN_IN.answer).toBe(`/api/auth${DESKTOP_ANSWER_PATH}`);
    expect(DESKTOP_SIGN_IN.token).toBe(`/api/auth${DESKTOP_TOKEN_PATH}`);
  });

  it('tells the app it can sign in this way', async () => {
    const options = (await (
      await fetch(new URL('/api/sign-in-options', server.url))
    ).json()) as Record<string, unknown>;
    expect(options.features).toContain('loopback-sign-in');
  });

  it('gives a code once it’s allowed, which the app trades for a session of its own', async () => {
    const sam = await server.signUp();
    const ask = await newAsk();
    const answered = await answer(ask.values, true, { token: sam.token, account: sam.id });
    expect(answered.status).toBe(200);
    expect(answered.cache).toBe('no-store');
    const url = new URL(String(answered.body.url));
    // Back to the app's address on the computer, with the answer in the query, where it hears it.
    expect(`${url.origin}${url.pathname}`).toBe(BACK);
    expect(url.hash).toBe('');
    const back = url.searchParams;
    expect([...back.keys()].sort()).toEqual(['code', 'iss', 'state']);
    expect(back.get('state')).toBe(ask.values.state);
    expect(back.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Naming this server, as the browser reached it, for the app to check it's the one it asked.
    expect(back.get('iss')).toBe(server.url.origin);

    const traded = await trade(back.get('code'), ask.verifier);
    expect(traded.status).toBe(200);
    expect(traded.cache).toBe('no-store');
    expect(traded.body).toMatchObject({ token_type: 'Bearer', access_token: expect.any(String) });
    expect(traded.body.access_token).not.toBe(sam.token);

    // Its own session, on Sam's account, named for the computer, as a device code's would be.
    const app = server.clientFor(String(traded.body.access_token), APP);
    const account = await app.account();
    expect(account.user.id).toBe(sam.id);
    expect(account.devices.find((device) => device.current)?.name).toBe('Factwright on Sam’s Mac');
    const kept = await server.env.DB.prepare(
      'SELECT userAgent, ipAddress, via FROM "session" WHERE token = ?',
    )
      .bind(traded.body.access_token)
      .first();
    expect(kept).toEqual({ userAgent: 'Factwright on Sam’s Mac', ipAddress: null, via: 'device' });
  });

  it('keeps no code in the database, only a hash of it', async () => {
    const { code } = await allowed();
    const { results } = await server.env.DB.prepare('SELECT identifier, value FROM "verification"')
      .bind()
      .all<{ identifier: string; value: string }>();
    expect(results.some((row) => row.identifier.startsWith('desktop-code:'))).toBe(true);
    expect(results.some((row) => row.identifier.includes(code) || row.value.includes(code))).toBe(
      false,
    );
  });

  it('takes a code once, even when it’s traded twice at the same moment', async () => {
    const { ask, code } = await allowed();
    const both = await Promise.all([trade(code, ask.verifier), trade(code, ask.verifier)]);
    expect(both.map((each) => each.status).sort()).toEqual([200, 400]);
    const again = await trade(code, ask.verifier);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_grant');
  });

  it('takes a code only with its own verifier, and a wrong one uses it up', async () => {
    const { ask, code } = await allowed();
    const wrong = await trade(code, toBase64Url(randomBytes(32)));
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('invalid_grant');
    expect((await trade(code, ask.verifier)).status).toBe(400);
  });

  it('takes a code only for the address it was given for', async () => {
    const { ask, code } = await allowed();
    expect((await trade(code, ask.verifier, { redirect: loopbackReturn(51005) })).status).toBe(400);
  });

  it('takes a code only for two minutes', async () => {
    const { ask, code } = await allowed();
    await server.env.DB.prepare(
      `UPDATE "verification" SET expiresAt = ? WHERE identifier LIKE 'desktop-code:%'`,
    )
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    const late = await trade(code, ask.verifier);
    expect(late.status).toBe(400);
    expect(late.body.error).toBe('invalid_grant');
  });

  it('never signs in one app with a code given for the other', async () => {
    // The desktop app's code, traded as the extension, at either way in.
    const desktop = await allowed();
    const asExtension = await trade(desktop.code, desktop.ask.verifier, {
      at: EXTENSION_SIGN_IN.token,
      client: 'factwright-extension',
    });
    expect(asExtension.status).toBe(400);
    expect(
      (await trade(desktop.code, desktop.ask.verifier, { client: 'factwright-extension' })).status,
    ).toBe(400);

    // The extension's code, traded as the desktop app.
    const sam = await server.signUp();
    const [chrome] = STORE_RETURNS as [string];
    const verifier = toBase64Url(randomBytes(32));
    const given = await fetch(new URL(EXTENSION_SIGN_IN.answer, server.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie(sam.token),
        origin: server.url.origin,
      },
      body: JSON.stringify({
        client_id: 'factwright-extension',
        response_type: 'code',
        redirect_uri: chrome,
        code_challenge: await challengeOf(verifier),
        code_challenge_method: 'S256',
        state: toBase64Url(randomBytes(16)),
        allow: true,
        account: sam.id,
      }),
    });
    const { url } = (await given.json()) as { url: string };
    const extensionCode = new URLSearchParams(new URL(url).hash.slice(1)).get('code');
    expect((await trade(extensionCode, verifier, { redirect: chrome })).body.error).toBe(
      'invalid_grant',
    );
  });

  it('takes a code no one gave, in no shape at all', async () => {
    const { verifier } = await newAsk();
    expect((await trade(toBase64Url(randomBytes(32)), verifier)).body.error).toBe('invalid_grant');
    for (const code of ['', 'short', 42, null]) {
      expect((await trade(code, verifier)).body.error).toBe('invalid_request');
    }
  });

  it('goes back only to the app’s address on the computer, exactly as the app makes it', async () => {
    const sam = await server.signUp();
    for (const port of [1, 51004, 65_535]) {
      const { values } = await newAsk(loopbackReturn(port));
      expect((await answer(values, true, { token: sam.token, account: sam.id })).status).toBe(200);
    }
    for (const redirect of [
      // Off the computer.
      'https://sync.evil.example/signed-in',
      'http://sync.evil.example:51004/signed-in',
      'http://127.0.0.1.evil.example:51004/signed-in',
      // 127.0.0.1:51004 as a user name and password, at another host. Joined here, so the
      // secret scan doesn't take it for a password.
      ['http://127.0.0.1:51004', 'evil.example/signed-in'].join('@'),
      // On it, but not as the app makes it.
      'http://localhost:51004/signed-in',
      'http://[::1]:51004/signed-in',
      'https://127.0.0.1:51004/signed-in',
      'http://127.0.0.1/signed-in',
      'http://127.0.0.1:0/signed-in',
      'http://127.0.0.1:65536/signed-in',
      'http://127.0.0.1:51004/',
      'http://127.0.0.1:51004/signed-in?code=planted',
      'http://127.0.0.1:51004/signed-in#',
      // The extension's.
      ...STORE_RETURNS,
      'javascript:alert(1)',
      42,
    ]) {
      const { values } = await newAsk(redirect);
      for (const allow of [true, false]) {
        const refused = await answer(values, allow, { token: sam.token, account: sam.id });
        expect(refused.status, String(redirect)).toBe(400);
        expect(refused.body.error).toBe('invalid_request');
        expect(refused.body.url).toBeUndefined();
      }
    }
  });

  it('needs PKCE with S256, a state, and the desktop app as the one asking', async () => {
    const sam = await server.signUp();
    const { values } = await newAsk();
    for (const change of [
      { code_challenge_method: 'plain' },
      { code_challenge: undefined },
      { state: 'short' },
      { client_id: 'factwright-extension' },
      { client_id: undefined },
      { response_type: 'token' },
    ] as Record<string, unknown>[]) {
      const refused = await answer({ ...values, ...change }, true, {
        token: sam.token,
        account: sam.id,
      });
      expect(refused.status, JSON.stringify(change)).toBe(400);
    }
  });

  it('says no to the app when the person doesn’t allow it, without a code', async () => {
    const { values } = await newAsk();
    const declined = await answer(values, false);
    expect(declined.status).toBe(200);
    expect(Object.fromEntries(query(declined.body.url))).toEqual({
      error: 'access_denied',
      state: values.state,
      iss: server.url.origin,
    });
  });

  it('allows it only for the account the page named, from a browser signed in here', async () => {
    const sam = await server.signUp();
    const alex = await server.signUp('Alex Chen');
    const { values } = await newAsk();
    const changed = await answer(values, true, { token: alex.token, account: sam.id });
    expect(changed.status).toBe(409);
    expect(changed.body.url).toBeUndefined();
    expect((await answer(values, true)).status).toBe(401);
    const device = await server.newSession(sam.id, APP, 'device');
    expect((await answer(values, true, { token: device.token, account: sam.id })).status).toBe(403);
  });

  it('takes an answer only from the app’s own pages', async () => {
    const sam = await server.signUp();
    const { values } = await newAsk();
    const elsewhere = await answer(values, true, {
      token: sam.token,
      account: sam.id,
      origin: 'https://evil.example',
    });
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.url).toBeUndefined();
  });

  it('gives a session that can’t approve a device’s code, allow another, or delete the account', async () => {
    const { ask, code } = await allowed();
    const app = String((await trade(code, ask.verifier)).body.access_token);
    const auth = { authorization: `Bearer ${app}`, 'content-type': 'application/json' };
    const approve = await fetch(new URL('/api/auth/device/approve', server.url), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ userCode: 'ABCDEFGH' }),
    });
    expect(approve.status).toBe(403);
    const another = await fetch(new URL(DESKTOP_SIGN_IN.answer, server.url), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ ...(await newAsk()).values, allow: true }),
    });
    expect(another.status).toBe(403);
    const deleted = await fetch(new URL('/api/auth/delete-user', server.url), {
      method: 'POST',
      headers: auth,
      body: '{}',
    });
    expect(deleted.status).toBe(400);
  });
});
