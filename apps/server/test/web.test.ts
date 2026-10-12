import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookie, someId, startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

/** A request from a browser signed in with its cookie, from a page at an origin. */
function fromBrowser(token: string, path: string, method: string, origin: string | null) {
  return fetch(new URL(path, server.url), {
    method,
    headers: {
      cookie: sessionCookie(token),
      'content-type': 'application/json',
      ...(origin && { origin }),
    },
    ...(method !== 'GET' && { body: '{}' }),
  });
}

describe('the web view’s requests', () => {
  it('are signed in by the browser’s cookie', async () => {
    const sam = await server.signUp();
    const response = await fromBrowser(sam.token, '/api/account', 'GET', null);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { user: { id: string } }).user.id).toBe(sam.id);
  });

  it('change things only from the app’s own pages', async () => {
    const sam = await server.signUp();
    const other = await server.newSession(sam.id, 'Mozilla/5.0 (iPhone)');
    const take = `/api/sync/links/${someId()}/take`;
    const forget = `/api/account/devices/${other.sessionId}`;
    for (const origin of ['https://elsewhere.example', null]) {
      expect((await fromBrowser(sam.token, take, 'POST', origin)).status).toBe(403);
      expect((await fromBrowser(sam.token, forget, 'DELETE', origin)).status).toBe(403);
    }
    expect((await sam.client.account()).devices).toHaveLength(2);

    const own = server.url.origin;
    expect((await fromBrowser(sam.token, take, 'POST', own)).status).toBe(404);
    expect((await fromBrowser(sam.token, forget, 'DELETE', own)).status).toBe(204);
    expect((await sam.client.account()).devices).toHaveLength(1);
  });

  it('sign out only from the app’s own pages', async () => {
    const sam = await server.signUp();
    const forged = await fromBrowser(
      sam.token,
      '/api/auth/sign-out',
      'POST',
      'https://elsewhere.example',
    );
    expect(forged.status).toBe(403);
    expect((await sam.client.account()).user.id).toBe(sam.id);
    const own = await fromBrowser(sam.token, '/api/auth/sign-out', 'POST', server.url.origin);
    expect(own.status).toBe(200);
    await expect(sam.client.account()).rejects.toMatchObject({ kind: 'signed-out' });
  });

  it('don’t need an origin from the desktop app, which has no cookie', async () => {
    const sam = await server.signUp();
    await expect(sam.client.takeLink(someId())).resolves.toBeNull();
  });
});
