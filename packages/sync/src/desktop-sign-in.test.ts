import { describe, expect, it } from 'vitest';
import {
  desktopAskUrl,
  isLoopbackReturn,
  LoopbackSignIn,
  loopbackReturn,
  readDesktopAsk,
  readDesktopAskQuery,
} from './desktop-sign-in.ts';
import { challengeOf } from './extension-sign-in.ts';

const SERVER = 'https://sync.sam.example';
const BACK = loopbackReturn(51004);

describe('the app’s address on the computer', () => {
  it('is 127.0.0.1 at a port, with the one path', () => {
    expect(BACK).toBe('http://127.0.0.1:51004/signed-in');
    expect(isLoopbackReturn(BACK)).toBe(true);
    expect(isLoopbackReturn(loopbackReturn(1))).toBe(true);
    expect(isLoopbackReturn(loopbackReturn(65_535))).toBe(true);
  });

  it('is nothing else', () => {
    for (const redirect of [
      'http://127.0.0.1:65536/signed-in',
      'http://127.0.0.1:0/signed-in',
      'http://127.0.0.1:051004/signed-in',
      'http://127.0.0.1/signed-in',
      'http://127.0.0.1:51004/',
      'http://127.0.0.1:51004/signed-in/',
      'http://127.0.0.1:51004/signed-in?code=planted',
      'http://127.0.0.1:51004/signed-in#',
      'https://127.0.0.1:51004/signed-in',
      'http://localhost:51004/signed-in',
      'http://[::1]:51004/signed-in',
      'http://127.0.0.2:51004/signed-in',
      'http://user@127.0.0.1:51004/signed-in',
      'http://127.0.0.1.evil.example:51004/signed-in',
      // 127.0.0.1:51004 as a user name and password, at another host. Joined here, so the
      // secret scan doesn't take it for a password.
      ['http://127.0.0.1:51004', 'evil.example/signed-in'].join('@'),
      'https://sync.evil.example/signed-in',
      '',
      42,
      null,
    ]) {
      expect(isLoopbackReturn(redirect), String(redirect)).toBe(false);
    }
  });
});

describe('the page’s address', () => {
  it('carries what binds the answer to one sign-in, and reads back as it went', async () => {
    const challenge = await challengeOf('a'.repeat(43));
    const ask = { redirect: BACK, challenge, state: 'b'.repeat(22) };
    const url = new URL(desktopAskUrl(SERVER, ask));
    expect(url.origin + url.pathname).toBe(`${SERVER}/sign-in/desktop`);
    expect(url.searchParams.get('client_id')).toBe('factwright-desktop');
    expect(readDesktopAskQuery(url.searchParams)).toEqual(ask);
  });

  it('is read only with each of its fields once, as the page and the server could read either', async () => {
    const challenge = await challengeOf('a'.repeat(43));
    const url = new URL(
      desktopAskUrl(SERVER, { redirect: BACK, challenge, state: 'b'.repeat(22) }),
    );
    for (const field of ['redirect_uri', 'state', 'code_challenge', 'client_id']) {
      const doubled = new URLSearchParams(url.searchParams);
      doubled.append(field, doubled.get(field) ?? '');
      expect(readDesktopAskQuery(doubled), field).toBeNull();
    }
  });

  it('is read only as the app makes it', async () => {
    const challenge = await challengeOf('a'.repeat(43));
    const good = {
      client_id: 'factwright-desktop',
      response_type: 'code',
      redirect_uri: BACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'b'.repeat(22),
    };
    expect(readDesktopAsk(good)).not.toBeNull();
    for (const change of [
      { client_id: 'factwright-extension' },
      { response_type: 'token' },
      { code_challenge_method: 'plain' },
      { code_challenge: 'c'.repeat(42) },
      { state: 'b'.repeat(21) },
      { state: 'b'.repeat(129) },
      { redirect_uri: 'https://gjhjddlohoonikgdbfcfnljeffilblai.chromiumapp.org/' },
      { redirect_uri: 'https://sync.evil.example/signed-in' },
      { redirect_uri: 42 },
    ]) {
      expect(readDesktopAsk({ ...good, ...change }), JSON.stringify(change)).toBeNull();
    }
  });
});

describe('the answer the browser comes back with', () => {
  /** A sign-in whose token request answers with `reply`, and the state it asked with. */
  async function signIn(reply: () => Promise<Response> | Response = () => Response.json({})) {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const flow = new LoopbackSignIn({
      server: SERVER,
      redirect: BACK,
      userAgent: 'Factwright/0.9.0 (Sam%E2%80%99s%20Mac)',
      fetch: async (url, init) => {
        sent.push({ url: String(url), init });
        return reply();
      },
    });
    const asked = new URL(await flow.start()).searchParams;
    return { flow, asked, state: asked.get('state') ?? '', sent };
  }
  const CODE = 'c'.repeat(43);
  /** This sign-in's server, as its answers name it. */
  const ISS = `iss=${encodeURIComponent(SERVER)}`;

  it('gets the session for a code, trading it with the verifier the challenge came from', async () => {
    const { flow, asked, state, sent } = await signIn(() =>
      Response.json({ access_token: 'session' }),
    );
    const returned = `${BACK}?code=${CODE}&state=${state}&${ISS}`;
    expect(flow.isFor(returned)).toBe(true);
    expect(await flow.finish(returned)).toEqual({ ok: true, token: 'session' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${SERVER}/api/auth/desktop/token`);
    const body = JSON.parse(String(sent[0]?.init?.body));
    expect(body).toMatchObject({
      grant_type: 'authorization_code',
      code: CODE,
      client_id: 'factwright-desktop',
      redirect_uri: BACK,
    });
    expect(await challengeOf(body.code_verifier)).toBe(asked.get('code_challenge'));
    // Only to the server asked, never on to wherever it sends the request.
    expect(sent[0]?.init?.redirect).toBe('error');
    // Named for the computer, as the app's sessions are.
    expect(new Headers(sent[0]?.init?.headers).get('user-agent')).toBe(
      'Factwright/0.9.0 (Sam%E2%80%99s%20Mac)',
    );
  });

  it('says no for a no, and asks the server nothing', async () => {
    const { flow, state, sent } = await signIn();
    expect(await flow.finish(`${BACK}?error=access_denied&state=${state}&${ISS}`)).toMatchObject({
      ok: false,
      reason: 'denied',
    });
    expect(sent).toHaveLength(0);
  });

  it('isn’t this sign-in’s with another state, at another address, or with a field twice', async () => {
    const { flow, state, sent } = await signIn();
    for (const returned of [
      `${BACK}?code=${CODE}&state=${state}x&${ISS}`,
      `${BACK}?code=${CODE}&${ISS}`,
      `${BACK}#code=${CODE}&state=${state}&${ISS}`,
      `${loopbackReturn(51005)}?code=${CODE}&state=${state}&${ISS}`,
      `http://127.0.0.1:51004/?code=${CODE}&state=${state}&${ISS}`,
      `${BACK}?code=${CODE}&state=${state}&state=${state}&${ISS}`,
      `${BACK}?code=${CODE}&code=${CODE}&state=${state}&${ISS}`,
      `${BACK}?code=${CODE}&state=${state}&${ISS}&${ISS}`,
      'not an address',
    ]) {
      expect(flow.isFor(returned), returned).toBe(false);
      expect((await flow.finish(returned)).ok, returned).toBe(false);
    }
    expect(sent).toHaveLength(0);
  });

  it('takes nothing another server gave, or that names none, and sends it nowhere', async () => {
    // A server of your own that sent the browser on to Factwright's page, and the code Factwright
    // gave, which would go back to that server to trade, and so to it.
    const { flow, state, sent } = await signIn();
    const factwright = `${BACK}?code=${CODE}&state=${state}&iss=${encodeURIComponent('https://app.factwright.com')}`;
    // It's this sign-in's answer, so it ends it, and says where it came from.
    expect(flow.isFor(factwright)).toBe(true);
    expect(await flow.finish(factwright)).toEqual({
      ok: false,
      reason: 'failed',
      message:
        'That sign-in came back from app.factwright.com, not sync.sam.example, so Factwright didn’t use it.',
    });
    for (const returned of [
      `${BACK}?code=${CODE}&state=${state}`,
      `${BACK}?code=${CODE}&state=${state}&${ISS}/`,
      `${BACK}?code=${CODE}&state=${state}&iss=javascript%3Aalert(1)`,
    ]) {
      expect(await flow.finish(returned), returned).toMatchObject({ ok: false, reason: 'failed' });
    }
    // A no from another server isn't this sign-in's no.
    expect(
      await flow.finish(
        `${BACK}?error=access_denied&state=${state}&iss=${encodeURIComponent('https://app.factwright.com')}`,
      ),
    ).toMatchObject({ ok: false, reason: 'failed' });
    expect(sent).toHaveLength(0);
  });

  it('takes no code out of shape', async () => {
    const { flow, state, sent } = await signIn();
    expect(await flow.finish(`${BACK}?code=short&state=${state}&${ISS}`)).toMatchObject({
      ok: false,
      reason: 'failed',
    });
    expect(sent).toHaveLength(0);
  });

  it('says why when the code doesn’t work, or the server can’t be reached', async () => {
    const used = await signIn(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    expect(await used.flow.finish(`${BACK}?code=${CODE}&state=${used.state}&${ISS}`)).toMatchObject(
      { ok: false, reason: 'expired' },
    );
    const busy = await signIn(() => new Response('', { status: 429 }));
    expect(await busy.flow.finish(`${BACK}?code=${CODE}&state=${busy.state}&${ISS}`)).toMatchObject(
      { ok: false, message: expect.stringMatching(/Wait a minute/) },
    );
    const offline = await signIn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(
      await offline.flow.finish(`${BACK}?code=${CODE}&state=${offline.state}&${ISS}`),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/Couldn’t reach/) });
  });
});
