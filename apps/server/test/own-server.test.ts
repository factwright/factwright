import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOT_LISTED } from '../src/auth-options.ts';
import { sessionCookie, someId, startServer, type TestServer } from './server.ts';

/**
 * A server of your own: no APP_URL, as at a free workers.dev address, none of the terms or
 * privacy policy of Factwright's own server, and a list of the GitHub accounts that may sign in.
 */
let server: TestServer;

beforeAll(async () => {
  server = await startServer({
    APP_URL: '',
    TERMS_URL: '',
    PRIVACY_URL: '',
    GITHUB_CLIENT_ID: 'github-app-id',
    GITHUB_CLIENT_SECRET: 'shh',
    ALLOWED_GITHUB_USERS: 'octocat',
  });
});

afterAll(() => server?.close());

async function post(path: string, body: object, headers: Record<string, string> = {}) {
  const response = await fetch(new URL(path, server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('a server of your own', () => {
  it('runs with no address set, so it goes by the one each request came to', async () => {
    const env = (await server.worker.getEnv()) as { APP_URL?: string };
    expect(env.APP_URL).toBe('');
  });

  it('signs people in with GitHub at its own address', async () => {
    const started = await post('/api/auth/sign-in/social', {
      provider: 'github',
      callbackURL: '/',
    });
    const url = new URL(String(started.body.url));
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${server.url.origin}/api/auth/callback/github`,
    );
  });

  it('tells someone it turns away why, on sign-in’s own page', async () => {
    // Where sign-in sends someone its list doesn't name, once GitHub says who they are.
    const turnedAway = new URLSearchParams({ error: 'not_listed', error_description: NOT_LISTED });
    const page = await fetch(new URL(`/api/auth/error?${turnedAway}`, server.url));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('This Factwright server is private');
  });

  it('won’t send people anywhere but itself afterward', async () => {
    const started = await post('/api/auth/sign-in/social', {
      provider: 'github',
      callbackURL: 'https://elsewhere.example/steal',
    });
    expect(started.status).toBe(403);
  });

  it('has the app approve its code at its own address', async () => {
    const code = await post('/api/auth/device/code', { client_id: 'factwright-desktop' });
    expect(code.body.verification_uri).toBe(`${server.url.origin}/device`);
  });

  it('names no terms or privacy policy', async () => {
    const response = await fetch(new URL('/api/sign-in-options', server.url));
    expect(await response.json()).toEqual({ providers: ['github'], features: ['approve'] });
  });

  it('takes the web view’s changes only from its own pages', async () => {
    const sam = await server.signUp();
    const take = (origin: string) =>
      fetch(new URL(`/api/sync/links/${someId()}/take`, server.url), {
        method: 'POST',
        headers: { cookie: sessionCookie(sam.token), 'content-type': 'application/json', origin },
        body: '{}',
      });
    expect((await take('https://elsewhere.example')).status).toBe(403);
    // There's no such link, but the request got that far.
    expect((await take(server.url.origin)).status).toBe(404);
  });
});
