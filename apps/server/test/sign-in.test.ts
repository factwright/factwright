import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deviceName } from '../src/auth-options.ts';
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
      verification_uri: 'http://localhost/device',
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
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/callback/github');
  });

  it('won’t send people anywhere but the app afterward', async () => {
    const started = await post('/api/auth/sign-in/social', {
      provider: 'github',
      callbackURL: 'https://elsewhere.example/steal',
    });
    expect(started.status).toBe(403);
  });

  it('has no Google until it’s set up', async () => {
    const started = await post('/api/auth/sign-in/social', {
      provider: 'google',
      callbackURL: '/',
    });
    expect(started.status).not.toBe(200);
  });
});

describe('device names', () => {
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
