import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedGitHubUsers, authOptions, NOT_LISTED, onlyListed } from '../src/auth-options.ts';

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

const APP = 'http://localhost:8787';

/** Someone with a GitHub account, as GitHub's API describes them. */
interface GitHubUser {
  login: string;
  id: number;
  email: string;
}

const OCTOCAT: GitHubUser = { login: 'octocat', id: 583231, email: 'octocat@example.com' };
const HUBOT: GitHubUser = { login: 'hubot', id: 480938, email: 'hubot@example.com' };

/** Who GitHub says is signing in, in the fake below. */
let signingIn = OCTOCAT;

/** GitHub's side of signing in, faked: it trades the code for a token, and the token for who. */
async function fakeGitHub(input: string | URL | Request): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (url === 'https://github.com/login/oauth/access_token') {
    return Response.json({ access_token: 'gho_test', token_type: 'bearer', scope: 'read:user' });
  }
  if (url === 'https://api.github.com/user') {
    const { login, id } = signingIn;
    return Response.json({ login, id, name: null, email: null, avatar_url: null });
  }
  if (url === 'https://api.github.com/user/emails') {
    return Response.json([{ email: signingIn.email, primary: true, verified: true }]);
  }
  throw new Error(`Signing in went to ${url}`);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fakeGitHub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A server's accounts, kept in memory rather than D1. */
type Accounts = Record<string, Record<string, unknown>[]>;

const noAccounts = (): Accounts => ({
  user: [],
  account: [],
  session: [],
  verification: [],
  rateLimit: [],
  deviceCode: [],
});

/** A server's sign-in, as the Worker sets it up, with ALLOWED_GITHUB_USERS as given. */
function serverWith(setting: string | undefined, accounts = noAccounts()) {
  const auth = betterAuth(
    authOptions({
      appUrl: APP,
      secret: 'test-only-secret-for-signing-sessions-0123456789',
      database: memoryAdapter(accounts),
      github: { clientId: 'github-app-id', clientSecret: 'shh' },
      allowedGitHubUsers: allowedGitHubUsers(setting),
      beforeDeleteUser: async () => {},
      signInsPerMinute: 1000,
    }),
  );
  return { auth, accounts };
}

/**
 * Signs in with GitHub in a browser, as someone: Sign in with GitHub, then back from GitHub with
 * a code. Says where sign-in sends them then.
 */
async function signIn({ auth }: ReturnType<typeof serverWith>, who: GitHubUser): Promise<URL> {
  signingIn = who;
  const ip = { 'cf-connecting-ip': '203.0.113.7' };
  const started = await auth.handler(
    new Request(`${APP}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { ...ip, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
    }),
  );
  const { url } = (await started.json()) as { url: string };
  const back = new URL(`${APP}/api/auth/callback/github`);
  back.searchParams.set('code', 'from-github');
  back.searchParams.set('state', new URL(url).searchParams.get('state') ?? '');
  const cookie = started.headers
    .getSetCookie()
    .map((each) => each.split(';')[0])
    .join('; ');
  const done = await auth.handler(new Request(back, { headers: { ...ip, cookie } }));
  expect(done.status).toBe(302);
  return new URL(done.headers.get('location') ?? '', APP);
}

describe('signing in with GitHub, on a server with a list', () => {
  it('makes an account for someone on it, and signs them in', async () => {
    const server = serverWith('@Octocat, someone-else');
    expect((await signIn(server, OCTOCAT)).pathname).toBe('/');
    expect(server.accounts.user).toMatchObject([{ email: OCTOCAT.email }]);
    expect(server.accounts.session).toHaveLength(1);
  });

  it('turns anyone else away, keeping nothing, and tells them why', async () => {
    const server = serverWith('octocat');
    const landed = await signIn(server, HUBOT);
    expect(landed.pathname).toBe('/api/auth/error');
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
