import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_LISTED } from '../src/auth-options.ts';
import { APP, backFromGitHub, fakeGitHub, HUBOT, OCTOCAT, serverWith, signIn } from './github.ts';

beforeEach(() => {
  vi.stubGlobal('fetch', fakeGitHub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The page of the web view an address opens, and what's in its address. */
const page = (url: URL) => ({
  page: `${url.origin}${url.pathname}`,
  query: Object.fromEntries(url.searchParams),
});

/** What the web view sends to sign in from a page, which sign-in comes back to either way. */
const from = (path: string) => ({ callbackURL: path, errorCallbackURL: path });

describe('a sign-in that doesn’t work', () => {
  it('comes back to the web view’s page that started it, with why, and keeps its code', async () => {
    const landed = await signIn(serverWith('octocat'), HUBOT, {
      start: from('/device?user_code=WDJBMJHT&for=extension'),
    });
    expect(page(landed)).toEqual({
      page: `${APP}/device`,
      query: {
        user_code: 'WDJBMJHT',
        for: 'extension',
        error: 'not_listed',
        error_description: NOT_LISTED,
      },
    });
  });

  it('comes back when someone cancels at GitHub, as GitHub says why', async () => {
    const server = serverWith(undefined);
    const landed = await signIn(server, OCTOCAT, {
      start: from('/account'),
      back: {
        error: 'access_denied',
        error_description: 'The user has denied your application access.',
        error_uri: 'https://docs.github.com/apps/troubleshooting-authorization-request-errors',
      },
    });
    expect(page(landed)).toEqual({
      page: `${APP}/account`,
      query: {
        error: 'access_denied',
        error_description: 'The user has denied your application access.',
      },
    });
    expect(server.accounts.user).toEqual([]);
  });

  it('comes back to the first page when it can’t tell where it started', async () => {
    // GitHub came back with no sign-in step, or one sign-in never made, or one that finished
    // already, as from the browser's Back button.
    const server = serverWith(undefined);
    expect(page(await backFromGitHub(server, { code: 'from-github' }))).toEqual({
      page: `${APP}/`,
      query: { error: 'state_not_found' },
    });
    expect(page(await backFromGitHub(server, { code: 'from-github', state: 'made-up' }))).toEqual({
      page: `${APP}/`,
      query: { error: 'state_mismatch' },
    });
  });

  it('never shows sign-in’s own error page, which sends people to the web view instead', async () => {
    const { auth } = serverWith(undefined);
    const turnedAway = new URLSearchParams({ error: 'not_listed', error_description: NOT_LISTED });
    const response = await auth.handler(new Request(`${APP}/api/auth/error?${turnedAway}`));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${APP}/?${turnedAway}`);
  });
});
