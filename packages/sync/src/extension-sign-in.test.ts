import { describe, expect, it } from 'vitest';
import {
  askUrl,
  challengeOf,
  EXTENSION_IDS,
  readAsk,
  readAskQuery,
  returnAddress,
  STORE_RETURNS,
  WindowSignIn,
} from './extension-sign-in.ts';

const SERVER = 'https://app.factwright.com';
const [CHROME] = STORE_RETURNS as [string, string];

describe('return addresses', () => {
  it('are the stores’ copies’, as each browser names them for its ID', async () => {
    expect(STORE_RETURNS).toEqual([
      await returnAddress(EXTENSION_IDS.chrome),
      await returnAddress(EXTENSION_IDS.firefox),
    ]);
  });

  it('come from Chrome’s ID as it is, and from a hash of Firefox’s', async () => {
    expect(await returnAddress('abcdefghijklmnopabcdefghijklmnop')).toBe(
      'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
    );
    // What Firefox's identity.getRedirectURL() gave for this ID, in Firefox 155.
    expect(await returnAddress('save@factwright.com')).toBe(
      'https://3f1d1eb28d34ed53855b8a8b1a556111830e0649.extensions.allizom.org/',
    );
    expect(await returnAddress('{6c1f0d3e-5b7a-4c2e-9f1d-2a3b4c5d6e7f}')).toMatch(
      /^https:\/\/[0-9a-f]{40}\.extensions\.allizom\.org\/$/,
    );
  });

  it('come only from an extension’s ID', async () => {
    for (const id of [
      'https://example.com/',
      'example.com',
      'ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP',
      'abcdefghijklmnopqrstuvwxyzabcdef',
      'a@b/c',
      '',
    ]) {
      expect(await returnAddress(id), id).toBeNull();
    }
  });
});

describe('the page’s address', () => {
  it('carries what binds the answer to one sign-in, and reads back as it went', async () => {
    const challenge = await challengeOf('a'.repeat(43));
    const ask = { redirect: CHROME, challenge, state: 'b'.repeat(22) };
    const url = new URL(askUrl(SERVER, ask));
    expect(url.origin + url.pathname).toBe(`${SERVER}/sign-in/extension`);
    expect(readAsk(Object.fromEntries(url.searchParams))).toEqual(ask);
  });

  it('is read only with each of its fields once, as the browser could read either', async () => {
    const challenge = await challengeOf('a'.repeat(43));
    const url = new URL(askUrl(SERVER, { redirect: CHROME, challenge, state: 'b'.repeat(22) }));
    expect(readAskQuery(url.searchParams)).not.toBeNull();
    for (const field of ['redirect_uri', 'state', 'code_challenge', 'client_id']) {
      const doubled = new URLSearchParams(url.searchParams);
      doubled.append(field, doubled.get(field) ?? '');
      expect(readAskQuery(doubled), field).toBeNull();
    }
  });

  it('is read only as the extension makes it', async () => {
    const challenge = await challengeOf('a'.repeat(43));
    const good = {
      client_id: 'factwright-extension',
      response_type: 'code',
      redirect_uri: CHROME,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'b'.repeat(22),
    };
    expect(readAsk(good)).not.toBeNull();
    for (const change of [
      { client_id: 'factwright-desktop' },
      { response_type: 'token' },
      { code_challenge_method: 'plain' },
      { code_challenge: 'c'.repeat(42) },
      { code_challenge: `${challenge}=` },
      { state: 'b'.repeat(21) },
      { state: 'b'.repeat(129) },
      { state: 'b'.repeat(21).concat('&') },
      { redirect_uri: 42 },
      { redirect_uri: `${CHROME}${'x'.repeat(200)}` },
    ]) {
      expect(readAsk({ ...good, ...change }), JSON.stringify(change)).toBeNull();
    }
  });

  it('carries the challenge of the verifier the sign-in keeps', async () => {
    let sent: Record<string, unknown> = {};
    const flow = new WindowSignIn({
      server: SERVER,
      redirect: CHROME,
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ access_token: 'token' });
      },
    });
    const asked = new URL(await flow.start()).searchParams;
    await flow.finish(
      `${CHROME}#code=${'c'.repeat(43)}&state=${asked.get('state')}&iss=${encodeURIComponent(SERVER)}`,
    );
    expect(await challengeOf(String(sent.code_verifier))).toBe(asked.get('code_challenge'));
    expect(sent).toMatchObject({
      grant_type: 'authorization_code',
      code: 'c'.repeat(43),
      client_id: 'factwright-extension',
      redirect_uri: CHROME,
    });
  });
});

describe('the window’s answer', () => {
  /** A sign-in whose token request answers with `reply`, and the state it asked with. */
  async function signIn(reply: () => Promise<Response> | Response = () => Response.json({})) {
    let asked = 0;
    const flow = new WindowSignIn({
      server: SERVER,
      redirect: CHROME,
      fetch: async () => {
        asked += 1;
        return reply();
      },
    });
    const state = new URL(await flow.start()).searchParams.get('state') ?? '';
    return { flow, state, asked: () => asked };
  }
  const CODE = 'c'.repeat(43);
  /** This sign-in's server, as its answers name it. */
  const ISS = `iss=${encodeURIComponent(SERVER)}`;

  it('gets the session for a code', async () => {
    const { flow, state } = await signIn(() => Response.json({ access_token: 'session' }));
    expect(await flow.finish(`${CHROME}#code=${CODE}&state=${state}&${ISS}`)).toEqual({
      ok: true,
      token: 'session',
    });
  });

  it('says no for a no, and asks the server nothing', async () => {
    const { flow, state, asked } = await signIn();
    expect(await flow.finish(`${CHROME}#error=access_denied&state=${state}&${ISS}`)).toMatchObject({
      ok: false,
      reason: 'denied',
    });
    expect(asked()).toBe(0);
  });

  it('takes nothing with another sign-in’s state, or at another address', async () => {
    const { flow, state, asked } = await signIn();
    for (const returned of [
      `${CHROME}#code=${CODE}&state=${state}x&${ISS}`,
      `${CHROME}#code=${CODE}&${ISS}`,
      `${CHROME}?code=${CODE}&state=${state}&${ISS}`,
      `https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.chromiumapp.org/#code=${CODE}&state=${state}&${ISS}`,
      `${CHROME}#code=short&state=${state}&${ISS}`,
      'not an address',
    ]) {
      expect((await flow.finish(returned)).ok, returned).toBe(false);
    }
    expect(asked()).toBe(0);
  });

  it('takes nothing another server gave, or that names none, and sends it nowhere', async () => {
    // A server of your own that sent the window on to Factwright's page, and the code Factwright
    // gave, which would go back to that server to trade, and so to it.
    const { flow, state, asked } = await signIn();
    for (const returned of [
      `${CHROME}#code=${CODE}&state=${state}&iss=${encodeURIComponent('https://sync.evil.example')}`,
      `${CHROME}#code=${CODE}&state=${state}`,
      `${CHROME}#code=${CODE}&state=${state}&${ISS}/`,
    ]) {
      expect(await flow.finish(returned), returned).toMatchObject({ ok: false, reason: 'failed' });
    }
    // A no from another server isn't this sign-in's no.
    expect(
      await flow.finish(
        `${CHROME}#error=access_denied&state=${state}&iss=${encodeURIComponent('https://sync.evil.example')}`,
      ),
    ).toMatchObject({ ok: false, reason: 'failed' });
    expect(asked()).toBe(0);
  });

  it('says why when the code doesn’t work, or the server can’t be reached', async () => {
    const used = await signIn(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    expect(
      await used.flow.finish(`${CHROME}#code=${CODE}&state=${used.state}&${ISS}`),
    ).toMatchObject({
      ok: false,
      reason: 'expired',
    });
    const busy = await signIn(() => new Response('', { status: 429 }));
    expect(
      await busy.flow.finish(`${CHROME}#code=${CODE}&state=${busy.state}&${ISS}`),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Wait a minute/),
    });
    const offline = await signIn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(
      await offline.flow.finish(`${CHROME}#code=${CODE}&state=${offline.state}&${ISS}`),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/Couldn’t reach/) });
  });
});
