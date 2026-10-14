import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authOptions, deviceName } from '../src/auth-options.ts';
import { startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer({ GITHUB_CLIENT_ID: 'github-app-id', GITHUB_CLIENT_SECRET: 'shh' });
});

afterAll(() => server?.close());

const DESKTOP = `Factwright/0.0.0 (${encodeURIComponent('Sam’s Mac')})`;

async function post(path: string, body: object, headers: Record<string, string> = {}) {
  const response = await fetch(new URL(path, server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': DESKTOP, ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const askForCode = () => post('/api/auth/device/code', { client_id: 'factwright-desktop' });

/** The browser page opening the code for the signed-in user, which ties the code to them. */
async function openCode(userCode: unknown, token: string) {
  const response = await fetch(
    new URL(`/api/auth/device?user_code=${String(userCode)}`, server.url),
    { headers: { authorization: `Bearer ${token}` } },
  );
  return (await response.json()) as Record<string, unknown>;
}

const pollForToken = (deviceCode: unknown) =>
  post('/api/auth/device/token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: deviceCode,
    client_id: 'factwright-desktop',
  });

describe('signing the desktop app in', () => {
  it('works with a code the user approves in their browser', async () => {
    const code = await askForCode();
    expect(code.status).toBe(200);
    expect(code.body).toMatchObject({
      user_code: expect.stringMatching(/^[A-Z0-9]{8}$/),
      verification_uri: `${server.url.origin}/device`,
      expires_in: 600,
      interval: 5,
    });
    expect(String(code.body.verification_uri_complete)).toContain(String(code.body.user_code));

    // In the browser, signed in, the user checks the code and approves it.
    const sam = await server.signUp();
    expect(await openCode(code.body.user_code, sam.token)).toMatchObject({
      status: 'pending',
      client_id: 'factwright-desktop',
    });
    const approved = await post(
      '/api/auth/device/approve',
      { userCode: code.body.user_code },
      { authorization: `Bearer ${sam.token}` },
    );
    expect(approved.status).toBe(200);

    const token = await pollForToken(code.body.device_code);
    expect(token.status).toBe(200);
    expect(token.body.access_token).toEqual(expect.any(String));

    // The app's new session is its own device, named by the app.
    const desktop = server.clientFor(String(token.body.access_token), DESKTOP);
    const account = await desktop.account();
    expect(account.user.id).toBe(sam.id);
    expect(account.devices.find((device) => device.current)?.name).toBe('Factwright on Sam’s Mac');
  });

  it('keeps the device’s name for the session, and no IP address', async () => {
    const code = await askForCode();
    const sam = await server.signUp();
    await openCode(code.body.user_code, sam.token);
    await post(
      '/api/auth/device/approve',
      { userCode: code.body.user_code },
      {
        authorization: `Bearer ${sam.token}`,
      },
    );
    const token = String((await pollForToken(code.body.device_code)).body.access_token);
    const session = await server.env.DB.prepare(
      'SELECT userAgent, ipAddress FROM "session" WHERE token = ?',
    )
      .bind(token)
      .first<{ userAgent: string; ipAddress: string | null }>();
    expect(session).toEqual({ userAgent: 'Factwright on Sam’s Mac', ipAddress: null });
    const via = await server.env.DB.prepare('SELECT via FROM "session" WHERE token = ?')
      .bind(token)
      .first<{ via: string }>();
    expect(via?.via).toBe('device');
  });

  it('won’t let a device code’s session approve another code', async () => {
    const sam = await server.signUp();
    const first = await askForCode();
    await openCode(first.body.user_code, sam.token);
    await post(
      '/api/auth/device/approve',
      { userCode: first.body.user_code },
      {
        authorization: `Bearer ${sam.token}`,
      },
    );
    const device = String((await pollForToken(first.body.device_code)).body.access_token);

    // With that session, someone tries to approve a code of their own, to stay signed in.
    const second = await askForCode();
    await openCode(second.body.user_code, device);
    const refused = await post(
      '/api/auth/device/approve',
      { userCode: second.body.user_code },
      {
        authorization: `Bearer ${device}`,
      },
    );
    expect(refused.status).toBe(403);
    expect((await pollForToken(second.body.device_code)).body.error).toBe('authorization_pending');

    // Sam, in the browser, still can.
    const approved = await post(
      '/api/auth/device/approve',
      { userCode: second.body.user_code },
      {
        authorization: `Bearer ${sam.token}`,
      },
    );
    expect(approved.status).toBe(200);
  });

  it('waits until the user approves, and stops if they deny it', async () => {
    const waiting = await askForCode();
    expect((await pollForToken(waiting.body.device_code)).body.error).toBe('authorization_pending');

    const denied = await askForCode();
    const sam = await server.signUp();
    await openCode(denied.body.user_code, sam.token);
    await post(
      '/api/auth/device/deny',
      { userCode: denied.body.user_code },
      { authorization: `Bearer ${sam.token}` },
    );
    expect((await pollForToken(denied.body.device_code)).body.error).toBe('access_denied');
  });

  it('keeps answering the app for as long as a code lasts', async () => {
    // Every 5 seconds for the code's 10 minutes, with no quiet minute in between.
    const waiting = await askForCode();
    const refused: number[] = [];
    for (let check = 0; check <= 120; check++) {
      if ((await pollForToken(waiting.body.device_code)).status === 429) refused.push(check);
    }
    expect(refused).toEqual([]);
  });

  it('is only for the Factwright app', async () => {
    const other = await post('/api/auth/device/code', { client_id: 'something-else' });
    expect(other.status).toBe(400);
  });

  it('can’t be approved without signing in, or by another account', async () => {
    const code = await askForCode();
    const approved = await post('/api/auth/device/approve', { userCode: code.body.user_code });
    expect(approved.status).toBe(401);
    const sam = await server.signUp();
    const other = await server.signUp();
    await openCode(code.body.user_code, sam.token);
    const stolen = await post(
      '/api/auth/device/approve',
      { userCode: code.body.user_code },
      { authorization: `Bearer ${other.token}` },
    );
    expect(stolen.status).toBe(403);
  });
});

describe('signing in on the web', () => {
  it('goes to GitHub, and comes back to the app', async () => {
    const started = await post('/api/auth/sign-in/social', {
      provider: 'github',
      callbackURL: '/',
    });
    const url = new URL(String(started.body.url));
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('client_id')).toBe('github-app-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${server.url.origin}/api/auth/callback/github`,
    );
  });

  it('won’t send people anywhere but the app afterward', async () => {
    const started = await post('/api/auth/sign-in/social', {
      provider: 'github',
      callbackURL: 'https://elsewhere.example/steal',
    });
    expect(started.status).toBe(403);
  });

  it('tells the web view which ways it has to sign in, and what more it can do', async () => {
    const response = await fetch(new URL('/api/sign-in-options', server.url));
    expect(await response.json()).toEqual({ providers: ['github'], features: ['approve'] });
  });

  it('has no Google until it’s set up', async () => {
    const started = await post('/api/auth/sign-in/social', {
      provider: 'google',
      callbackURL: '/',
    });
    expect(started.status).not.toBe(200);
  });
});

describe('what sign-in keeps', () => {
  const options = authOptions({
    appUrl: 'https://app.factwright.com',
    secret: 'test-only-secret',
    database: undefined,
    beforeDeleteUser: async () => {},
  });
  const hooks = options.databaseHooks;

  it('keeps none of GitHub’s or Google’s tokens', async () => {
    const given = {
      id: 'a',
      userId: 'u',
      accountId: '42',
      providerId: 'google',
      accessToken: 'gho-access',
      refreshToken: 'refresh',
      idToken: 'eyJ-id-token-with-name-and-email',
      accessTokenExpiresAt: new Date(),
      refreshTokenExpiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    for (const hook of [hooks.account.create.before, hooks.account.update.before]) {
      const { data } = (await hook(given)) as { data: Record<string, unknown> };
      expect(data).toMatchObject({ providerId: 'google', accountId: '42' });
      for (const field of ['accessToken', 'refreshToken', 'idToken'])
        expect(data[field]).toBeNull();
    }
  });

  it('marks a session from a browser’s sign-in with GitHub or Google, and no other', async () => {
    const session = {
      id: 's',
      userId: 'u',
      token: 't',
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
      ipAddress: '203.0.113.7',
    };
    const via = async (path?: string) => {
      const context = path === undefined ? null : ({ path } as never);
      const made = (await hooks.session.create.before(session, context)) as {
        data: { via: string; ipAddress: unknown; userAgent: string };
      };
      return made.data;
    };
    expect((await via('/callback/:id')).via).toBe('web');
    for (const path of ['/device/token', '/sign-in/social', '/sign-in/anonymous', undefined]) {
      expect((await via(path)).via, String(path)).toBe('device');
    }
    expect(await via('/callback/:id')).toMatchObject({
      ipAddress: null,
      userAgent: 'Safari on iPhone',
    });
  });

  it('won’t list sessions, or sign other sessions out, by sign-in’s own routes', async () => {
    const sam = await server.signUp();
    const device = await server.newSession(sam.id, 'Factwright/0.0.0 (Someone’s PC)', 'device');
    for (const [method, path] of [
      ['GET', '/list-sessions'],
      ['POST', '/revoke-session'],
      ['POST', '/revoke-sessions'],
      ['POST', '/revoke-other-sessions'],
    ] as const) {
      const response = await fetch(new URL(`/api/auth${path}`, server.url), {
        method,
        headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ token: sam.token }) } : {}),
      });
      expect(response.status, path).toBe(404);
    }
    expect((await sam.client.account()).user.id).toBe(sam.id);
  });

  it('keeps no link to the profile picture', async () => {
    const user = {
      id: 'u',
      name: 'Sam Rivera',
      email: 'sam@example.com',
      emailVerified: true,
      image: 'https://avatars.githubusercontent.com/u/1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    for (const hook of [hooks.user.create.before, hooks.user.update.before]) {
      const { data } = (await hook(user)) as { data: Record<string, unknown> };
      expect(data).toMatchObject({ name: 'Sam Rivera', email: 'sam@example.com', image: null });
    }
  });

  it('can’t hand out, refresh or read a provider’s token or profile', async () => {
    const sam = await server.signUp();
    for (const path of ['/get-access-token', '/refresh-token', '/account-info']) {
      const response = await fetch(new URL(`/api/auth${path}`, server.url), {
        method: path === '/account-info' ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${sam.token}`, 'content-type': 'application/json' },
        ...(path === '/account-info' ? {} : { body: JSON.stringify({ providerId: 'github' }) }),
      });
      expect(response.status, path).toBe(404);
    }
  });
});

describe('device names', () => {
  it('come back as they are, once a session keeps one', () => {
    for (const name of ['Factwright on Sam’s Mac', 'Safari on iPhone', 'Chrome', 'A browser']) {
      expect(deviceName(name)).toBe(name);
    }
  });

  it('read what kind of device signed in', () => {
    expect(deviceName('Factwright/1.2.0 (Sam%E2%80%99s%20MacBook%20Pro)')).toBe(
      'Factwright on Sam’s MacBook Pro',
    );
    expect(deviceName('Factwright/1.2.0 (Test Mac)')).toBe('Factwright on Test Mac');
    expect(
      deviceName(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone');
    expect(
      deviceName(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0',
      ),
    ).toBe('Edge on Windows');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15) Chrome/141.0 Mobile Safari/537.36')).toBe(
      'Chrome on Android',
    );
    expect(deviceName(null)).toBe('A browser');
  });
});
