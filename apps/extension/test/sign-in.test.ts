// @vitest-environment node
import { sessionCookie, startServer, type TestServer } from '@factwright/server/testing';
import {
  challengeOf,
  EXTENSION_SIGN_IN,
  randomBytes,
  readAsk,
  STORE_RETURNS,
  toBase64Url,
} from '@factwright/sync';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { returnAddress, windowSignIn } from '../src/account.ts';

/**
 * The browser's own window for extensions, standing in for Chrome's: it opens the page it's
 * given, where `person` answers it, and hands back the address the page went on to.
 */
const browser = vi.hoisted(() => {
  const state: {
    opened: string[];
    person: (url: string) => Promise<string>;
  } = { opened: [], person: async () => '' };
  (globalThis as { chrome?: unknown }).chrome = {
    identity: {
      getRedirectURL: () => 'https://gjhjddlohoonikgdbfcfnljeffilblai.chromiumapp.org/',
      launchWebAuthFlow: async ({ url }: { url: string; interactive: boolean }) => {
        state.opened.push(url);
        return state.person(url);
      },
    },
  };
  return state;
});

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
}, 60_000);

afterAll(() => server?.close());

beforeEach(() => {
  browser.opened.length = 0;
});

/**
 * Someone signed in to the server in this browser, answering the page as the web view does: its
 * request, with their browser's cookie, from the page's own address, for the account it names.
 * The browser then hands the extension the address the page goes on to.
 */
function answers({ id, token }: { id: string; token: string }, allow: boolean) {
  return async (url: string) => {
    const page = new URL(url);
    const ask = readAsk(Object.fromEntries(page.searchParams));
    const response = await fetch(new URL(EXTENSION_SIGN_IN.answer, server.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie(token),
        origin: server.url.origin,
      },
      body: JSON.stringify({ ...Object.fromEntries(page.searchParams), allow, account: id }),
    });
    const { url: next } = (await response.json()) as { url: string };
    expect(ask && next.startsWith(`${ask.redirect}#`)).toBe(true);
    return next;
  };
}

describe('signing in through the browser’s window', () => {
  it('opens the server’s own page, asking for this copy alone, tied to this sign-in', async () => {
    const sam = await server.signUp();
    browser.person = answers(sam, true);
    await windowSignIn(server.url.origin, STORE_RETURNS[0] as string);
    const [opened] = browser.opened;
    const page = new URL(opened ?? '');
    expect(page.origin + page.pathname).toBe(`${server.url.origin}/sign-in/extension`);
    expect(Object.fromEntries(page.searchParams)).toMatchObject({
      client_id: 'factwright-extension',
      response_type: 'code',
      redirect_uri: returnAddress(),
      code_challenge_method: 'S256',
      code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      state: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    });
  });

  it('gets a session of its own for the account allowed in the browser', async () => {
    const sam = await server.signUp();
    browser.person = answers(sam, true);
    const result = await windowSignIn(server.url.origin, returnAddress() ?? '');
    expect(result.ok).toBe(true);
    const token = result.ok ? result.token : '';
    expect(token).not.toBe(sam.token);
    const account = await server.clientFor(token).account();
    expect(account.user.id).toBe(sam.id);
    const kept = await server.env.DB.prepare('SELECT via FROM "session" WHERE token = ?')
      .bind(token)
      .first<{ via: string }>();
    expect(kept?.via).toBe('device');
  });

  it('says so when the person doesn’t allow it', async () => {
    const sam = await server.signUp();
    browser.person = answers(sam, false);
    expect(await windowSignIn(server.url.origin, returnAddress() ?? '')).toMatchObject({
      ok: false,
      reason: 'denied',
    });
  });

  it('takes the window closing, in Chrome or Firefox, as canceling', async () => {
    for (const said of ['The user did not approve access.', 'User cancelled or denied access.']) {
      browser.person = () => Promise.reject(new Error(said));
      expect(await windowSignIn(server.url.origin, returnAddress() ?? '')).toMatchObject({
        ok: false,
        reason: 'canceled',
      });
    }
  });

  it('says what the browser said when the window stops short', async () => {
    browser.person = () => Promise.reject(new Error('Authorization page could not be loaded.'));
    expect(await windowSignIn(server.url.origin, returnAddress() ?? '')).toEqual({
      ok: false,
      reason: 'failed',
      message: 'Authorization page could not be loaded.',
    });
  });

  it('takes no answer from a server it didn’t ask, and sends that server nothing', async () => {
    const sam = await server.signUp();
    // A server of your own that sends the window on to Factwright's page, with the state it saw
    // and a challenge of its own, to have the code Factwright gives sent back to it to trade.
    const evil = 'https://sync.evil.example';
    const challenge = await challengeOf(toBase64Url(randomBytes(32)));
    browser.person = async (url) => {
      const onward = new URL(EXTENSION_SIGN_IN.page, server.url);
      onward.search = new URLSearchParams({
        ...Object.fromEntries(new URL(url).searchParams),
        code_challenge: challenge,
      }).toString();
      return answers(sam, true)(onward.toString());
    };
    const sent = vi.spyOn(globalThis, 'fetch');
    try {
      expect(await windowSignIn(evil, returnAddress() ?? '')).toMatchObject({
        ok: false,
        reason: 'failed',
      });
      const reached = sent.mock.calls.map(
        ([input]) => new URL(input instanceof Request ? input.url : String(input)).origin,
      );
      expect(reached).not.toContain(evil);
      expect(reached).toContain(server.url.origin);
    } finally {
      sent.mockRestore();
    }
  });

  it('gets nothing for an answer another sign-in was given', async () => {
    const sam = await server.signUp();
    // The person allows one sign-in, and the window hands that answer to another.
    let first = '';
    browser.person = async (url) => {
      first = await answers(sam, true)(url);
      return first;
    };
    await windowSignIn(server.url.origin, returnAddress() ?? '');
    browser.person = async () => first;
    expect((await windowSignIn(server.url.origin, returnAddress() ?? '')).ok).toBe(false);
  });
});
