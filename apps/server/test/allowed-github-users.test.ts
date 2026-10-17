import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedGitHubUsers, NOT_LISTED, onlyListed } from '../src/auth-options.ts';
import { APP, fakeGitHub, HUBOT, noAccounts, OCTOCAT, serverWith, signIn } from './github.ts';

describe('ALLOWED_GITHUB_USERS', () => {
  it('reads GitHub user names, however they’re written', () => {
    expect(allowedGitHubUsers('Octocat, @hubot  https://github.com/Mona-Lisa/')).toEqual(
      new Set(['octocat', 'hubot', 'mona-lisa']),
    );
  });

  it('is no list at all, unset or blank, so anyone can sign in', () => {
    for (const setting of [undefined, '', ' \n ']) {
      expect(allowedGitHubUsers(setting)).toBeUndefined();
    }
  });

  it('lets no one in when it names no one, rather than everyone', () => {
    expect(allowedGitHubUsers(', sam@example.com, github.com/')).toEqual(new Set());
  });
});

describe('who a list lets sign in', () => {
  const gate = onlyListed(new Set(['octocat']));
  const withGitHub = (login: unknown) => ({
    source: { oauth: { providerId: 'github', profile: { login, id: 583231 } } },
  });

  it('lets in the accounts on it, by the user name GitHub gives, in any case', () => {
    expect(gate(withGitHub('octocat'))).toBeUndefined();
    expect(gate(withGitHub('OctoCat'))).toBeUndefined();
  });

  it('turns away any other account, and says where its owner can let them in', () => {
    expect(gate(withGitHub('hubot'))).toEqual({
      error: 'not_listed',
      errorDescription: NOT_LISTED,
    });
    expect(NOT_LISTED).toContain('ALLOWED_GITHUB_USERS');
  });

  it('turns away any other way to sign in', () => {
    const google = { oauth: { providerId: 'google', profile: { login: 'octocat' } } };
    expect(gate({ source: google })).toMatchObject({ error: 'not_listed' });
    expect(gate({ source: {} })).toMatchObject({ error: 'not_listed' });
    expect(gate(withGitHub(undefined))).toMatchObject({ error: 'not_listed' });
  });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fakeGitHub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signing in with GitHub, on a server with a list', () => {
  it('makes an account for someone on it, and signs them in', async () => {
    const server = serverWith('@Octocat, someone-else');
    expect((await signIn(server, OCTOCAT)).pathname).toBe('/');
    expect(server.accounts.user).toMatchObject([{ email: OCTOCAT.email }]);
    expect(server.accounts.session).toHaveLength(1);
  });

  it('turns anyone else away, keeping nothing, and tells them why, back in the web view', async () => {
    const server = serverWith('octocat');
    const landed = await signIn(server, HUBOT);
    expect(`${landed.origin}${landed.pathname}`).toBe(`${APP}/`);
    expect(Object.fromEntries(landed.searchParams)).toEqual({
      error: 'not_listed',
      error_description: NOT_LISTED,
    });
    for (const kept of ['user', 'account', 'session'] as const) {
      expect(server.accounts[kept], kept).toEqual([]);
    }
  });

  it('won’t sign in an account it doesn’t list again, though it was made before the list', async () => {
    const accounts = noAccounts();
    expect((await signIn(serverWith(undefined, accounts), HUBOT)).pathname).toBe('/');
    const landed = await signIn(serverWith('octocat', accounts), HUBOT);
    expect(landed.searchParams.get('error')).toBe('not_listed');
    expect(accounts.session).toHaveLength(1);
  });
});

describe('signing in with GitHub, with no list, as on Factwright’s own server', () => {
  it('makes an account for anyone', async () => {
    for (const setting of [undefined, '']) {
      const server = serverWith(setting);
      for (const who of [OCTOCAT, HUBOT]) {
        expect((await signIn(server, who)).pathname).toBe('/');
      }
      expect(server.accounts.user).toHaveLength(2);
    }
  });
});
