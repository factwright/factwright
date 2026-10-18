import { returnAddress, STORE_RETURNS } from '@factwright/sync';
import { describe, expect, it } from 'vitest';
import { FACTWRIGHT_SYNC, hostPattern, manifest } from '../src/manifest.ts';
import {
  askServer,
  checkServer,
  codePage,
  DEFAULT_SERVER,
  hostOf,
  isOwn,
  isSyncServer,
  readServer,
  type ServerAnswer,
  serverName,
  signInWay,
} from '../src/server.ts';

const OWN = 'https://factwright-sync.sam.workers.dev';

/** The address it reads, or what's wrong with it. */
const read = (typed: string, local = false) => {
  const answer = readServer(typed, local);
  return answer.ok ? answer.server : answer.problem;
};

describe('a server of your own’s address', () => {
  it('takes an https address, as its origin', () => {
    expect(read(OWN)).toBe(OWN);
    expect(read(`${OWN}/`)).toBe(OWN);
    expect(read(`  ${OWN}  `)).toBe(OWN);
    expect(read('HTTPS://Factwright-Sync.Sam.Workers.Dev')).toBe(OWN);
    expect(read('https://sync.example.com:8443')).toBe('https://sync.example.com:8443');
  });

  it('takes an address typed without https:// as one', () => {
    expect(read('factwright-sync.sam.workers.dev')).toBe(OWN);
  });

  const HTTPS = 'Your server’s address must start with https://.';

  it('takes nothing but https in the stores’ build, this computer included', () => {
    expect(read('http://factwright-sync.sam.workers.dev')).toBe(HTTPS);
    expect(read('http://localhost:8787')).toBe(HTTPS);
    expect(read('http://127.0.0.1:8787')).toBe(HTTPS);
    expect(read('ftp://sync.example.com')).toBe(HTTPS);
  });

  it('takes this computer over http in a build for testing, and nowhere else', () => {
    expect(read('http://localhost:8787', true)).toBe('http://localhost:8787');
    expect(read('http://127.0.0.1:8787', true)).toBe('http://127.0.0.1:8787');
    expect(read('http://sync.example.com', true)).toBe(HTTPS);
    expect(read('http://localhost.example.com', true)).toBe(HTTPS);
  });

  it('takes the address alone: no path, query or fragment', () => {
    for (const typed of [`${OWN}/api`, `${OWN}/sync/`, `${OWN}?server=1`, `${OWN}/#jobs`]) {
      expect(read(typed)).toMatch(/nothing after it/);
    }
  });

  it('takes no user name or password', () => {
    // Put together here, so the source holds no address with a login, which secret scans flag.
    const login = (who: string) => OWN.replace('https://', `https://${who}@`);
    expect(read(login('sam'))).toMatch(/user name/);
    expect(read(login(['sam', 'not-a-password'].join(':')))).toMatch(/user name/);
  });

  it('takes no pattern a browser’s permission would read as many sites', () => {
    expect(read('https://*.workers.dev')).toMatch(/isn’t an address/);
    expect(read('https://*')).toMatch(/isn’t an address/);
  });

  it('says what to type when it isn’t an address', () => {
    expect(read('')).toMatch(/Type your server’s address/);
    expect(read('   ')).toMatch(/Type your server’s address/);
    expect(read('https://my server')).toMatch(/isn’t an address/);
    expect(read('https://')).toMatch(/isn’t an address/);
  });
});

describe('checking a server', () => {
  const answering =
    (status: number, body: string, type = 'application/json'): typeof fetch =>
    async () =>
      new Response(body, { status, headers: { 'content-type': type } });

  it('counts a server that lists its ways to sign in as a Factwright sync server', async () => {
    const options = { providers: ['github'], features: ['approve'] };
    expect(await checkServer(OWN, answering(200, JSON.stringify(options)))).toBe('ok');
    // One with no way to sign in set up yet still answers as one, as its web view says.
    expect(await checkServer(OWN, answering(200, '{"providers":[]}'))).toBe('ok');
  });

  it('asks the server’s own sign-in options, without the browser’s cookies or a redirect', async () => {
    let asked: { url: string; init?: RequestInit } | null = null;
    await checkServer(OWN, async (url, init) => {
      asked = { url: String(url), init };
      return new Response('{"providers":[]}');
    });
    expect(asked).toMatchObject({
      url: `${OWN}/api/sign-in-options`,
      init: { credentials: 'omit', redirect: 'manual' },
    });
  });

  it('tells a server that answers as something else', async () => {
    expect(await checkServer(OWN, answering(404, '<h1>Not found</h1>', 'text/html'))).toBe(
      'not-sync',
    );
    expect(await checkServer(OWN, answering(403, 'Forbidden', 'text/plain'))).toBe('not-sync');
    expect(await checkServer(OWN, answering(200, '<!doctype html><p>Hi', 'text/html'))).toBe(
      'not-sync',
    );
    expect(await checkServer(OWN, answering(200, '{"ok":true}'))).toBe('not-sync');
    expect(await checkServer(OWN, answering(200, 'null'))).toBe('not-sync');
    // A redirect, as the browser shows one it didn't follow.
    expect(await checkServer(OWN, async () => Response.redirect(`${OWN}/elsewhere`, 302))).toBe(
      'not-sync',
    );
  });

  it('tells a server that didn’t answer, or not for now, so trying again may work', async () => {
    expect(
      await checkServer(OWN, async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toBe('unreachable');
    // Busy or failing for now, as while it's deployed.
    for (const status of [429, 500, 502, 503]) {
      expect(await checkServer(OWN, answering(status, '{"providers":[]}'))).toBe('unreachable');
    }
    // Its answer stopped partway, as when it took too long.
    const cut = new ReadableStream({
      start: (controller) => controller.error(new DOMException('Timed out', 'TimeoutError')),
    });
    expect(await checkServer(OWN, async () => new Response(cut))).toBe('unreachable');
  });

  it('reads the return addresses the server knows for the sign-in window', async () => {
    const redirects = ['https://gjhjddlohoonikgdbfcfnljeffilblai.chromiumapp.org/'];
    expect(
      await askServer(
        OWN,
        answering(200, JSON.stringify({ providers: [], extensionRedirects: [...redirects, 42] })),
      ),
    ).toEqual({ check: 'ok', redirects });
    // A server from before the window knows none, so the extension signs in with a code there.
    expect(await askServer(OWN, answering(200, '{"providers":[]}'))).toEqual({
      check: 'ok',
      redirects: [],
    });
    expect(
      await askServer(
        OWN,
        answering(200, JSON.stringify({ providers: [], extensionRedirects: redirects[0] })),
      ),
    ).toEqual({ check: 'ok', redirects: [] });
    // And one that isn't a sync server, none at all.
    expect(
      await askServer(OWN, answering(200, JSON.stringify({ extensionRedirects: redirects }))),
    ).toEqual({ check: 'not-sync', redirects: [] });
  });

  it('reads sign-in options as a Factwright sync server’s only with a list of ways to sign in', () => {
    expect(isSyncServer({ providers: ['github', 'google'] })).toBe(true);
    expect(isSyncServer({ providers: 'github' })).toBe(false);
    expect(isSyncServer([])).toBe(false);
    expect(isSyncServer('providers')).toBe(false);
    expect(isSyncServer(null)).toBe(false);
  });
});

describe('how setup signs in', () => {
  const ID = 'gjhjddlohoonikgdbfcfnljeffilblai';
  const RETURN = STORE_RETURNS[0] as string;
  /** A sync server's answer, knowing these return addresses. */
  const knows = (...redirects: string[]): ServerAnswer => ({ check: 'ok', redirects });

  it('signs in to the server it’s built for through the window, where that knows this copy', () => {
    expect(signInWay(DEFAULT_SERVER, knows(...STORE_RETURNS), RETURN, ID)).toEqual({
      by: 'window',
      redirect: RETURN,
    });
  });

  it('and with a code where it doesn’t, in a browser with no window, or when asked for one', () => {
    // From before the window, or a copy it doesn't know, such as one built from the code.
    expect(signInWay(DEFAULT_SERVER, knows(), RETURN, ID)).toEqual({ by: 'code' });
    expect(signInWay(DEFAULT_SERVER, knows(STORE_RETURNS[1] as string), RETURN, ID)).toEqual({
      by: 'code',
    });
    expect(signInWay(DEFAULT_SERVER, knows(RETURN), null, ID)).toEqual({ by: 'code' });
    expect(signInWay(DEFAULT_SERVER, knows(RETURN), RETURN, ID, true)).toEqual({ by: 'code' });
  });

  it('signs in to a server of your own through the window alone, even when asked for a code', () => {
    expect(signInWay(OWN, knows(...STORE_RETURNS), RETURN, ID)).toEqual({
      by: 'window',
      redirect: RETURN,
    });
    expect(signInWay(OWN, knows(RETURN), RETURN, ID, true)).toEqual({
      by: 'window',
      redirect: RETURN,
    });
  });

  it('never with a code, which a server of your own could have from another server, such as Factwright’s', () => {
    // One that offers no window, from before it or acting as if it were, to have setup show a
    // code Factwright's sync gave it, for the person to allow there.
    expect(signInWay(OWN, knows(), RETURN, ID)).toEqual({
      problem:
        'factwright-sync.sam.workers.dev needs an update for this version of Save to Factwright, which signs in to a server of your own through the browser’s window. Update it, then try again.',
    });
    // One that doesn't know this copy, as one built from the code, which it can add.
    const built = 'abcdefghijklmnopabcdefghijklmnop';
    expect(
      signInWay(OWN, knows(...STORE_RETURNS), `https://${built}.chromiumapp.org/`, built),
    ).toEqual({
      problem: `factwright-sync.sam.workers.dev doesn’t know this copy of Save to Factwright, so it can’t sign it in. Add its ID, ${built}, to EXTENSION_IDS in the server’s settings, then try again.`,
    });
    // A browser with no window for extensions.
    expect(signInWay(OWN, knows(...STORE_RETURNS), null, ID)).toEqual({
      problem:
        'This browser has no sign-in window for extensions, which Save to Factwright needs to sign in to a server of your own.',
    });
  });
});

describe('the page a code’s sign-in opens', () => {
  const HOST = hostOf(DEFAULT_SERVER);

  it('is the server’s own page', () => {
    const url = `${DEFAULT_SERVER}/device?user_code=WDJBMJHT&for=extension`;
    expect(codePage(url, DEFAULT_SERVER)).toEqual({ ok: true, url });
  });

  it('is never another address, or anything that isn’t a page on one', () => {
    expect(codePage('https://sync.example.com/device?user_code=WDJBMJHT', DEFAULT_SERVER)).toEqual({
      ok: false,
      problem: `${HOST} sends its sign-in to another address, sync.example.com, so Save to Factwright didn’t open it.`,
    });
    for (const url of ['/device?user_code=WDJBMJHT', 'file:///etc/hosts', 'javascript:void 0']) {
      expect(codePage(url, DEFAULT_SERVER)).toEqual({
        ok: false,
        problem: `${HOST} didn’t give a sign-in page Save to Factwright can open.`,
      });
    }
  });
});

describe('the server it’s built for', () => {
  it('is Factwright’s sync, unless the build names another', () => {
    expect(DEFAULT_SERVER).toBe(new URL(DEFAULT_SERVER).origin);
    expect(isOwn(DEFAULT_SERVER)).toBe(false);
    expect(serverName(DEFAULT_SERVER)).toBe('Factwright’s sync');
  });

  it('names a server of your own by its address', () => {
    expect(isOwn(OWN)).toBe(true);
    expect(serverName(OWN)).toBe('your sync server, factwright-sync.sam.workers.dev');
  });
});

describe('the manifest’s permissions', () => {
  it('asks for the browser’s own sign-in window, which shows no warning, and nothing more', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      expect(manifest(target, '1.0.0').permissions).toEqual([
        'activeTab',
        'scripting',
        'storage',
        'contextMenus',
        'identity',
      ]);
    }
  });

  it('gives Firefox the ID whose return address sync servers know', async () => {
    const gecko = (
      manifest('firefox', '1.0.0').browser_specific_settings as {
        gecko: { id: string };
      }
    ).gecko;
    expect(await returnAddress(gecko.id)).toBe(STORE_RETURNS[1]);
  });

  it('has no content scripts, and nothing a page can load or message', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      const built = manifest(target, '1.0.0');
      expect(built.content_scripts).toBeUndefined();
      expect(built.web_accessible_resources).toBeUndefined();
      expect(built.externally_connectable).toBeUndefined();
    }
  });
});

describe('the manifest’s sites', () => {
  it('reaches Factwright’s sync from install, and may ask for one https server of your own', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      const built = manifest(target, '1.0.0');
      expect(built.host_permissions).toEqual(['https://app.factwright.com/*']);
      expect(built.optional_host_permissions).toEqual(['https://*/*']);
    }
  });

  it('in a build for a local server, may also ask for this computer over http', () => {
    const built = manifest('chrome', '1.0.0', 'http://localhost:8787');
    expect(built.host_permissions).toEqual(['http://localhost/*']);
    expect(built.optional_host_permissions).toEqual(['https://*/*', 'http://127.0.0.1/*']);
  });

  it('names a server’s site on any port, as permissions leave ports out', () => {
    expect(hostPattern('https://sync.example.com:8443')).toBe('https://sync.example.com/*');
    expect(hostPattern(FACTWRIGHT_SYNC)).toBe('https://app.factwright.com/*');
  });
});
