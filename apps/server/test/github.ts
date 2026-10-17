import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { expect } from 'vitest';
import { allowedGitHubUsers, authOptions } from '../src/auth-options.ts';

/** Where the server signing people in is served. */
export const APP = 'http://localhost:8787';

/** Someone with a GitHub account, as GitHub's API describes them. */
export interface GitHubUser {
  login: string;
  id: number;
  email: string;
}

export const OCTOCAT: GitHubUser = { login: 'octocat', id: 583231, email: 'octocat@example.com' };
export const HUBOT: GitHubUser = { login: 'hubot', id: 480938, email: 'hubot@example.com' };

/** Who GitHub says is signing in, in the fake below. */
let signingIn = OCTOCAT;

/**
 * GitHub's side of signing in, faked, in place of fetch: it trades the code for a token, and the
 * token for who.
 */
export async function fakeGitHub(input: string | URL | Request): Promise<Response> {
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

/** A server's accounts, kept in memory rather than D1. */
export type Accounts = Record<string, Record<string, unknown>[]>;

export const noAccounts = (): Accounts => ({
  user: [],
  account: [],
  session: [],
  verification: [],
  rateLimit: [],
  deviceCode: [],
});

/** A server's sign-in, as the Worker sets it up, with ALLOWED_GITHUB_USERS as given. */
export function serverWith(setting: string | undefined, accounts = noAccounts()) {
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

export type Server = ReturnType<typeof serverWith>;

const IP = { 'cf-connecting-ip': '203.0.113.7' };

/** The address sign-in sends a request to, as a browser would go there. */
async function sentTo(response: Response): Promise<URL> {
  expect(response.status).toBe(302);
  return new URL(response.headers.get('location') ?? '', APP);
}

/** A browser coming back to sign-in from GitHub, with what GitHub put in the address. */
export async function backFromGitHub(
  { auth }: Server,
  query: Record<string, string>,
  cookie = '',
): Promise<URL> {
  const back = new URL(`${APP}/api/auth/callback/github`);
  for (const [name, value] of Object.entries(query)) back.searchParams.set(name, value);
  return sentTo(await auth.handler(new Request(back, { headers: { ...IP, cookie } })));
}

/**
 * Signs in with GitHub in a browser, as someone: Sign in with GitHub, as the web view asks with
 * `start`, then back from GitHub with a code, or with what `back` says instead. Says where
 * sign-in sends them then.
 */
export async function signIn(
  server: Server,
  who: GitHubUser,
  {
    start = {},
    back = { code: 'from-github' },
  }: { start?: object; back?: Record<string, string> } = {},
): Promise<URL> {
  signingIn = who;
  const started = await server.auth.handler(
    new Request(`${APP}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { ...IP, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: '/', ...start }),
    }),
  );
  const { url } = (await started.json()) as { url: string };
  const state = new URL(url).searchParams.get('state') ?? '';
  const cookie = started.headers
    .getSetCookie()
    .map((each) => each.split(';')[0])
    .join('; ');
  return backFromGitHub(server, { ...back, state }, cookie);
}
