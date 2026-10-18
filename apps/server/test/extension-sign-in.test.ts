import {
  challengeOf,
  EXTENSION_SIGN_IN,
  randomBytes,
  STORE_RETURNS,
  toBase64Url,
} from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANSWER_PATH, TOKEN_PATH } from '../src/extension-sign-in.ts';
import { sessionCookie, startServer, type TestServer } from './server.ts';

let server: TestServer;

/** A copy of the extension the server's EXTENSION_IDS adds, as a test's or one you built. */
const OWN_COPY = 'abcdefghijklmnopabcdefghijklmnop';
const OWN_COPY_RETURN = `https://${OWN_COPY}.chromiumapp.org/`;
const [CHROME, FIREFOX] = STORE_RETURNS as [string, string];

beforeAll(async () => {
  server = await startServer({ EXTENSION_IDS: `${OWN_COPY}, not-an-id, https://example.com/` });
});

afterAll(() => server?.close());

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** What the extension makes for one sign-in: its verifier, the challenge and the state. */
async function newAsk(redirect = CHROME) {
  const verifier = toBase64Url(randomBytes(32));
  return {
    verifier,
    values: {
      client_id: 'factwright-extension',
      response_type: 'code',
      redirect_uri: redirect,
      code_challenge: await challengeOf(verifier),
      code_challenge_method: 'S256',
      state: toBase64Url(randomBytes(16)),
    } as Record<string, unknown>,
  };
}

/** The web view's page answering, from a browser signed in with `token`'s session. */
async function answer(
  values: Record<string, unknown>,
  allow: boolean,
  { token, origin = server.url.origin }: { token?: string; origin?: string } = {},
) {
  const response = await fetch(new URL(EXTENSION_SIGN_IN.answer, server.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': CHROME_ON_MAC,
      ...(token && { cookie: sessionCookie(token), origin }),
    },
    body: JSON.stringify({ ...values, allow }),
  });
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** What the answer carries to the return address, in its fragment. */
const fragment = (url: unknown) => new URLSearchParams(new URL(String(url)).hash.slice(1));

/** The extension trading a code, as it does from its setup page: no cookies, the browser's name. */
async function trade(code: unknown, verifier: string, redirect = CHROME) {
  const response = await fetch(new URL(EXTENSION_SIGN_IN.token, server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': CHROME_ON_MAC },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: 'factwright-extension',
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
async function allowed(redirect = CHROME) {
  const sam = await server.signUp();
  const ask = await newAsk(redirect);
  const answered = await answer(ask.values, true, { token: sam.token });
  expect(answered.status).toBe(200);
  return { sam, ask, code: fragment(answered.body.url).get('code') ?? '' };
}

describe('signing the browser extension in through its window', () => {
  it('sits under sign-in’s own paths', () => {
    expect(EXTENSION_SIGN_IN.answer).toBe(`/api/auth${ANSWER_PATH}`);
    expect(EXTENSION_SIGN_IN.token).toBe(`/api/auth${TOKEN_PATH}`);
  });

  it('tells the extension and the page which return addresses it knows', async () => {
    const options = (await (
      await fetch(new URL('/api/sign-in-options', server.url))
    ).json()) as Record<string, unknown>;
    // The stores' copies, and the one EXTENSION_IDS adds. What isn't an extension's ID isn't.
    expect(options.extensionRedirects).toEqual([CHROME, FIREFOX, OWN_COPY_RETURN]);
  });

  it('gives a code once it’s allowed, which the extension trades for a session of its own', async () => {
    const sam = await server.signUp();
    const ask = await newAsk();
    const answered = await answer(ask.values, true, { token: sam.token });
    expect(answered.status).toBe(200);
    expect(answered.cache).toBe('no-store');
    const url = new URL(String(answered.body.url));
    // To the return address, with the answer in the fragment alone, never the query.
    expect(`${url.origin}/`).toBe(CHROME);
    expect(url.pathname + url.search).toBe('/');
    const back = fragment(url);
    expect(back.get('state')).toBe(ask.values.state);
    expect(back.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const traded = await trade(back.get('code'), ask.verifier);
    expect(traded.status).toBe(200);
    expect(traded.cache).toBe('no-store');
    expect(traded.body).toMatchObject({ token_type: 'Bearer', access_token: expect.any(String) });
    expect(traded.body.access_token).not.toBe(sam.token);

    // Its own session, on Sam's account, named for the extension and the browser it's in.
    const extension = server.clientFor(String(traded.body.access_token), CHROME_ON_MAC);
    const account = await extension.account();
    expect(account.user.id).toBe(sam.id);
    expect(account.devices.find((device) => device.current)?.name).toBe(
      'Save to Factwright in Chrome on Mac',
    );
    const kept = await server.env.DB.prepare(
      'SELECT userAgent, ipAddress, via FROM "session" WHERE token = ?',
    )
      .bind(traded.body.access_token)
      .first();
    expect(kept).toEqual({
      userAgent: 'Save to Factwright in Chrome on Mac',
      ipAddress: null,
      via: 'device',
    });
  });

  it('keeps no code in the database, only a hash of it', async () => {
    const { code } = await allowed();
    const { results } = await server.env.DB.prepare('SELECT identifier, value FROM "verification"')
      .bind()
      .all<{ identifier: string; value: string }>();
    expect(results.some((row) => row.identifier.startsWith('extension-code:'))).toBe(true);
    expect(results.some((row) => row.identifier.includes(code) || row.value.includes(code))).toBe(
      false,
    );
  });

  it('takes a code once', async () => {
    const { ask, code } = await allowed();
    expect((await trade(code, ask.verifier)).status).toBe(200);
    const again = await trade(code, ask.verifier);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_grant');
  });

  it('takes a code once, even when it’s traded twice at the same moment', async () => {
    const { ask, code } = await allowed();
    const both = await Promise.all([trade(code, ask.verifier), trade(code, ask.verifier)]);
    expect(both.map((each) => each.status).sort()).toEqual([200, 400]);
  });

  it('takes a code only with its own verifier, and a wrong one uses it up', async () => {
    const { ask, code } = await allowed();
    const wrong = await trade(code, toBase64Url(randomBytes(32)));
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('invalid_grant');
    expect((await trade(code, ask.verifier)).status).toBe(400);
  });

  it('takes a code only for the return address it was given for', async () => {
    const { ask, code } = await allowed();
    expect((await trade(code, ask.verifier, FIREFOX)).status).toBe(400);
  });

  it('takes a code only for two minutes', async () => {
    const { ask, code } = await allowed();
    await server.env.DB.prepare(
      `UPDATE "verification" SET expiresAt = ? WHERE identifier LIKE 'extension-code:%'`,
    )
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    const late = await trade(code, ask.verifier);
    expect(late.status).toBe(400);
    expect(late.body.error).toBe('invalid_grant');
  });

  it('takes a code no one gave, in no shape at all', async () => {
    const { verifier } = await newAsk();
    expect((await trade(toBase64Url(randomBytes(32)), verifier)).body.error).toBe('invalid_grant');
    for (const code of ['', 'short', 42, null]) {
      expect((await trade(code, verifier)).body.error).toBe('invalid_request');
    }
    const { ask, code } = await allowed();
    expect((await trade(code, 'too-short')).body.error).toBe('invalid_request');
    // A verifier out of shape is turned away before the code is tried, so it still works.
    expect((await trade(code, ask.verifier)).status).toBe(200);
  });

  it('goes back only to the return addresses it knows, exactly as they are', async () => {
    const sam = await server.signUp();
    for (const redirect of [CHROME, FIREFOX, OWN_COPY_RETURN]) {
      const { values } = await newAsk(redirect);
      expect((await answer(values, true, { token: sam.token })).status).toBe(200);
    }
    for (const redirect of [
      // Another extension, in Chrome and in Firefox.
      'https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.chromiumapp.org/',
      'https://0000000000000000000000000000000000000000.extensions.allizom.org/',
      // Ours, but not as the browser names it.
      CHROME.replace('https://', 'http://'),
      CHROME.toUpperCase(),
      `${CHROME}callback`,
      `${CHROME}?code=planted`,
      `${CHROME}#`,
      CHROME.slice(0, -1),
      `${CHROME.slice(0, -1)}.example.com/`,
      // Firefox's way to return to this computer, which isn't taken.
      'http://127.0.0.1/mozoauth2/3f1d1eb28d34ed53855b8a8b1a556111830e0649',
      // Anywhere else.
      'https://example.com/',
      server.url.origin,
      '/account',
      'javascript:alert(1)',
    ]) {
      const { values } = await newAsk(redirect);
      for (const allow of [true, false]) {
        const refused = await answer(values, allow, { token: sam.token });
        expect(refused.status, redirect).toBe(400);
        expect(refused.body.error).toBe('invalid_request');
        expect(refused.body.url).toBeUndefined();
      }
    }
  });

  it('needs PKCE with S256, a state, and the extension as the one asking', async () => {
    const sam = await server.signUp();
    const { values } = await newAsk();
    const broken: Record<string, unknown>[] = [
      { code_challenge_method: 'plain' },
      { code_challenge_method: undefined },
      { code_challenge: undefined },
      { code_challenge: 'too-short' },
      { state: undefined },
      { state: 'short' },
      { state: 'has spaces and & that would change the answer' },
      { client_id: 'factwright-desktop' },
      { client_id: undefined },
      { response_type: 'token' },
    ];
    for (const change of broken) {
      const refused = await answer({ ...values, ...change }, true, { token: sam.token });
      expect(refused.status, JSON.stringify(change)).toBe(400);
    }
    expect((await answer(values, 'yes' as unknown as boolean, { token: sam.token })).status).toBe(
      400,
    );
  });

  it('says no to the return address when the person doesn’t allow it, without a code', async () => {
    const { values } = await newAsk(FIREFOX);
    const declined = await answer(values, false);
    expect(declined.status).toBe(200);
    const url = new URL(String(declined.body.url));
    expect(`${url.origin}/`).toBe(FIREFOX);
    expect(Object.fromEntries(fragment(url))).toEqual({
      error: 'access_denied',
      state: values.state,
    });
  });

  it('needs a browser signed in here to allow it', async () => {
    const { values } = await newAsk();
    expect((await answer(values, true)).status).toBe(401);
  });

  it('won’t let a session from a device code, or from this, allow it', async () => {
    const sam = await server.signUp();
    const device = await server.newSession(sam.id, CHROME_ON_MAC, 'device');
    const { values } = await newAsk();
    const refused = await answer(values, true, { token: device.token });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('access_denied');

    // The extension's own session, as a bearer token, can't either.
    const { ask, code } = await allowed();
    const extension = String((await trade(code, ask.verifier)).body.access_token);
    const asBearer = await fetch(new URL(EXTENSION_SIGN_IN.answer, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${extension}` },
      body: JSON.stringify({ ...ask.values, allow: true }),
    });
    expect(asBearer.status).toBe(403);
  });

  it('takes an answer only from the app’s own pages', async () => {
    const sam = await server.signUp();
    const { values } = await newAsk();
    const elsewhere = await answer(values, true, {
      token: sam.token,
      origin: 'https://evil.example',
    });
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.url).toBeUndefined();
  });

  it('gives a session that can’t approve a device’s code or delete the account', async () => {
    const { ask, code } = await allowed();
    const extension = String((await trade(code, ask.verifier)).body.access_token);
    const auth = { authorization: `Bearer ${extension}`, 'content-type': 'application/json' };
    const approve = await fetch(new URL('/api/auth/device/approve', server.url), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ userCode: 'ABCDEFGH' }),
    });
    expect(approve.status).toBe(403);
    const deleted = await fetch(new URL('/api/auth/delete-user', server.url), {
      method: 'POST',
      headers: auth,
      body: '{}',
    });
    expect(deleted.status).toBe(400);
  });

  it('works for a copy the server’s EXTENSION_IDS adds', async () => {
    const { ask, code } = await allowed(OWN_COPY_RETURN);
    expect((await trade(code, ask.verifier, OWN_COPY_RETURN)).status).toBe(200);
  });

  it('gives nothing for an account deleted since it was allowed', async () => {
    const { sam, ask, code } = await allowed();
    await server.env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(sam.id).run();
    expect((await trade(code, ask.verifier)).body.error).toBe('invalid_grant');
  });
});
