import { beforeAll, describe, expect, it, vi } from 'vitest';
import { type AccessKeys, signedIn } from './access.ts';

const TEAM = 'factwright.cloudflareaccess.com';
const AUD = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';
const SETTINGS = { teamDomain: TEAM, aud: AUD };
const NOW = Date.parse('2026-10-27T15:00:00.000Z');
const SECONDS = NOW / 1000;

const RS256 = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
} as const;

/** Access's signing key, and another that isn't Access's. */
let access: CryptoKeyPair;
let stranger: CryptoKeyPair;

beforeAll(async () => {
  access = (await crypto.subtle.generateKey(RS256, false, ['sign', 'verify'])) as CryptoKeyPair;
  stranger = (await crypto.subtle.generateKey(RS256, false, ['sign', 'verify'])) as CryptoKeyPair;
});

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const part = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** The claims Access puts in a token for Steve. */
const CLAIMS = {
  aud: [AUD],
  email: 'steve@factwright.com',
  exp: SECONDS + 3600,
  iat: SECONDS - 60,
  nbf: SECONDS - 60,
  iss: `https://${TEAM}`,
  type: 'app',
  sub: '7335d417-61da-459d-899c-0a01c76a2f94',
};

/** A token as Access signs one, with whatever's given in place of its usual parts. */
async function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key = access.privateKey,
) {
  const signing = `${part({ alg: 'RS256', kid: 'key-1', typ: 'JWT', ...header })}.${part({ ...CLAIMS, ...claims })}`;
  const signature = await crypto.subtle.sign(RS256, key, new TextEncoder().encode(signing));
  return `${signing}.${base64url(new Uint8Array(signature))}`;
}

/** Access's keys, by ID, noting each time they're asked for and whether afresh. */
function accessKeys(keys = (_fresh: boolean) => new Map([['key-1', access.publicKey]])) {
  const asked: [string, boolean][] = [];
  const fetchKeys: AccessKeys = async (team, fresh) => {
    asked.push([team, fresh]);
    return keys(fresh);
  };
  return { asked, fetchKeys };
}

/** A request to the admin page, carrying the token given. */
const request = (jwt?: string, url = 'https://factwright.com/roadmap/admin') =>
  new Request(url, { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} });

describe('who’s signed in to the admin page', () => {
  it('is whoever Access signed a token for, for this application', async () => {
    const { asked, fetchKeys } = accessKeys();
    expect(await signedIn(request(await token()), SETTINGS, fetchKeys, NOW)).toBe(
      'steve@factwright.com',
    );
    expect(asked).toEqual([[TEAM, false]]);
    // An audience given on its own, rather than in a list, counts too.
    expect(await signedIn(request(await token({ aud: AUD })), SETTINGS, fetchKeys, NOW)).toBe(
      'steve@factwright.com',
    );
  });

  it('takes the team’s domain as its address too', async () => {
    const settings = { teamDomain: `https://${TEAM}/`, aud: ` ${AUD} ` };
    const { fetchKeys } = accessKeys();
    expect(await signedIn(request(await token()), settings, fetchKeys, NOW)).toBe(
      'steve@factwright.com',
    );
  });

  it('is no one without a token, or before the Access application’s settings are in place', async () => {
    const { asked, fetchKeys } = accessKeys();
    const jwt = await token();
    expect(await signedIn(request(), SETTINGS, fetchKeys, NOW)).toBeNull();
    expect(await signedIn(request(jwt), {}, fetchKeys, NOW)).toBeNull();
    expect(await signedIn(request(jwt), { teamDomain: TEAM }, fetchKeys, NOW)).toBeNull();
    expect(await signedIn(request(jwt), { aud: AUD }, fetchKeys, NOW)).toBeNull();
    expect(asked).toEqual([]);
  });

  it('asks only an Access team for its keys', async () => {
    const { asked, fetchKeys } = accessKeys();
    const jwt = await token();
    for (const teamDomain of ['example.com', 'factwright.cloudflareaccess.com.example.com']) {
      expect(await signedIn(request(jwt), { teamDomain, aud: AUD }, fetchKeys, NOW)).toBeNull();
    }
    expect(asked).toEqual([]);
  });

  it('is no one for a token another application, team or key signed', async () => {
    const { fetchKeys } = accessKeys();
    const refused = async (jwt: string) =>
      expect(await signedIn(request(jwt), SETTINGS, fetchKeys, NOW)).toBeNull();
    await refused(await token({ aud: ['another-application'] }));
    await refused(await token({ aud: undefined }));
    await refused(await token({ iss: 'https://another.cloudflareaccess.com' }));
    await refused(await token({}, {}, stranger.privateKey));
  });

  it('is no one once the token runs out, or before it starts', async () => {
    const { fetchKeys } = accessKeys();
    const at = async (claims: Record<string, unknown>) =>
      signedIn(request(await token(claims)), SETTINGS, fetchKeys, NOW);
    expect(await at({ exp: SECONDS - 61 })).toBeNull();
    expect(await at({ exp: undefined })).toBeNull();
    expect(await at({ nbf: SECONDS + 61 })).toBeNull();
    expect(await at({ iat: SECONDS + 61 })).toBeNull();
    // A clock a little off either way is fine.
    expect(await at({ exp: SECONDS - 30, nbf: SECONDS + 30, iat: SECONDS + 30 })).toBe(
      'steve@factwright.com',
    );
  });

  it('is no one for a token without an email, such as a service token’s', async () => {
    const { fetchKeys } = accessKeys();
    for (const email of [undefined, '', 42]) {
      expect(await signedIn(request(await token({ email })), SETTINGS, fetchKeys, NOW)).toBeNull();
    }
  });

  it('is no one for a token that isn’t signed the way Access signs', async () => {
    const { fetchKeys } = accessKeys();
    const jwt = await token();
    const [head, body, signature] = jwt.split('.');
    const refused = async (each: string) =>
      expect(await signedIn(request(each), SETTINGS, fetchKeys, NOW), each).toBeNull();
    await refused(`${part({ alg: 'none', kid: 'key-1' })}.${body}.`);
    await refused(`${part({ alg: 'HS256', kid: 'key-1' })}.${body}.${signature}`);
    await refused(`${part({ alg: 'RS256' })}.${body}.${signature}`);
    // Its claims changed after it was signed.
    await refused(`${head}.${part({ ...CLAIMS, email: 'someone@example.com' })}.${signature}`);
    await refused(`${head}.${body}`);
    await refused(`${jwt}.more`);
    await refused('not a token at all');
    await refused(`${head}.%%%.${signature}`);
  });

  it('fetches Access’s keys afresh once for a key it doesn’t have yet, as when Access rotates them', async () => {
    // The keys kept from before, and the ones Access gives now.
    const { asked, fetchKeys } = accessKeys((fresh) =>
      fresh ? new Map([['key-2', access.publicKey]]) : new Map([['key-1', access.publicKey]]),
    );
    expect(
      await signedIn(request(await token({}, { kid: 'key-2' })), SETTINGS, fetchKeys, NOW),
    ).toBe('steve@factwright.com');
    expect(asked).toEqual([
      [TEAM, false],
      [TEAM, true],
    ]);
    asked.length = 0;
    expect(
      await signedIn(request(await token({}, { kid: 'key-3' })), SETTINGS, fetchKeys, NOW),
    ).toBeNull();
    expect(asked).toEqual([
      [TEAM, false],
      [TEAM, true],
    ]);
  });

  it('is no one when Access’s keys can’t be fetched', async () => {
    const failing: AccessKeys = async () => {
      throw new Error('Access is down');
    };
    expect(await signedIn(request(await token()), SETTINGS, failing, NOW)).toBeNull();
  });

  it('fetches the team’s keys from its certs address, and keeps them a while', async () => {
    const pair = (await crypto.subtle.generateKey(RS256, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const team = 'keys-test.cloudflareaccess.com';
    const settings = { teamDomain: team, aud: AUD };
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return Response.json({ keys: [{ ...jwk, kid: 'key-1', alg: 'RS256', use: 'sig' }] });
    });
    try {
      const jwt = await token({ iss: `https://${team}` }, {}, pair.privateKey);
      expect(await signedIn(request(jwt), settings, undefined, NOW)).toBe('steve@factwright.com');
      expect(await signedIn(request(jwt), settings, undefined, NOW)).toBe('steve@factwright.com');
      expect(fetched).toEqual([`https://${team}/cdn-cgi/access/certs`]);
      // A token with a key it doesn't know can't make it fetch again straight away.
      const unknown = await token({ iss: `https://${team}` }, { kid: 'key-9' }, pair.privateKey);
      expect(await signedIn(request(unknown), settings, undefined, NOW)).toBeNull();
      expect(fetched).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is no one when Access’s certs address doesn’t answer', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 502 }));
    try {
      const team = 'down-test.cloudflareaccess.com';
      const jwt = await token({ iss: `https://${team}` });
      expect(
        await signedIn(request(jwt), { teamDomain: team, aud: AUD }, undefined, NOW),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lets a local preview in as the address in its .dev.vars, on localhost alone', async () => {
    const settings = { localAdmin: 'steve@factwright.com' };
    const { asked, fetchKeys } = accessKeys();
    for (const url of [
      'http://localhost:8788/roadmap/admin',
      'http://127.0.0.1:8788/roadmap/admin/api/ideas',
      'http://[::1]:8788/roadmap/admin',
    ]) {
      expect(await signedIn(request(undefined, url), settings, fetchKeys, NOW), url).toBe(
        'steve@factwright.com',
      );
    }
    for (const url of ['https://factwright.com/roadmap/admin', 'https://localhost.example.com/']) {
      expect(await signedIn(request(undefined, url), settings, fetchKeys, NOW), url).toBeNull();
    }
    expect(asked).toEqual([]);
  });
});
