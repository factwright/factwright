import { CLIENTS } from '@factwright/sync';
import type { BetterAuthOptions } from 'better-auth';
import { bearer } from 'better-auth/plugins/bearer';
import { deviceAuthorization } from 'better-auth/plugins/device-authorization';

/** The apps that may sign in with a device code: the desktop app and the browser extension. */
const DEVICE_CLIENTS: ReadonlySet<string> = new Set(Object.values(CLIENTS));

/** What the account page calls the browser extension, before the browser it's in. */
const EXTENSION_NAME = 'Save to Factwright in';

const DAY_SECONDS = 24 * 60 * 60;

/** An OAuth app's ID and secret, at GitHub or Google. */
export type Provider = { clientId: string; clientSecret: string };

/** The token fields sign-in's providers hand over. Nothing uses them after sign-in, so none are kept. */
const PROVIDER_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
};

/**
 * What a session keeps about the device that signed in: the name the account page shows, such
 * as "Safari on iPhone", in place of the browser's whole description, and no IP address. Sign-in's
 * limits read the address from each request instead.
 */
function deviceOnly<T extends { userAgent?: string | null; ipAddress?: string | null }>(
  session: T,
) {
  return {
    ...session,
    ...('userAgent' in session && { userAgent: deviceName(session.userAgent) }),
    ...('ipAddress' in session && { ipAddress: null }),
  };
}

/** Where sign-in makes a session after GitHub or Google says who it is, in a browser. */
const WEB_SIGN_IN = /^\/callback\//;

/**
 * Whether a session is the browser extension's: made with a device code it asked for under its
 * own name. Its name then says so, such as "Save to Factwright in Chrome on Mac", so the account
 * page and the app's question about linking it tell it apart from a browser's own sign-in.
 */
const byExtension = (context: { path?: string; body?: unknown } | null | undefined) =>
  context?.path === '/device/token' &&
  (context.body as { client_id?: unknown } | undefined)?.client_id === CLIENTS.extension;

/**
 * How a session signed in: "web" after GitHub or Google, in a browser, or "device" with a code
 * the person approved. Only a web session can delete the account or approve a device's code, so
 * someone who tricks a person into approving their code gets a session that can sync, but can't
 * do either.
 */
export type SignedInVia = 'web' | 'device';

/**
 * What sign-in says about someone a server of your own turned away, in the address it sends them
 * back to. The web view says the same, in its own words. It names where the owner sets who may
 * sign in, never who's on the list.
 */
export const NOT_LISTED =
  'This Factwright server is private: only the GitHub accounts its owner lists can sign in. If it’s yours, add your GitHub user name to ALLOWED_GITHUB_USERS in its settings on Cloudflare.';

/** A GitHub user name, alone, after an @, or at the end of a link to its profile. */
const GITHUB_USER = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|@)?([a-z\d-]{1,39})\/?$/i;

/**
 * The GitHub accounts a server lets sign in, from its ALLOWED_GITHUB_USERS setting, by user name
 * in lowercase, as GitHub matches them. Unset or blank, there's no list, and anyone can sign in.
 * Anything in it that isn't a user name is left out, so a list with no names lets no one in,
 * rather than everyone.
 */
export function allowedGitHubUsers(setting: string | undefined): ReadonlySet<string> | undefined {
  if (!setting?.trim()) return undefined;
  return new Set(
    setting.split(/[\s,]+/).flatMap((each) => {
      const name = GITHUB_USER.exec(each)?.[1];
      return name ? [name.toLowerCase()] : [];
    }),
  );
}

/** What sign-in says about who's signing in, as it checks them: how, and GitHub's own profile. */
interface SigningIn {
  source: { oauth?: { providerId: string; profile?: Record<string, unknown> | undefined } };
}

/**
 * Lets in only the GitHub accounts on a list, by the user name GitHub gives each time: for a new
 * account, for signing in again and for adding GitHub to an account. Any other account, and any
 * other way to sign in, is turned away, before anything is kept.
 */
export function onlyListed(listed: ReadonlySet<string>) {
  return ({ source }: SigningIn) => {
    const login = source.oauth?.providerId === 'github' ? source.oauth.profile?.login : undefined;
    if (typeof login === 'string' && listed.has(login.toLowerCase())) return;
    return { error: 'not_listed', errorDescription: NOT_LISTED };
  };
}

/** What sign-in needs, apart from where it runs. */
export interface AuthSettings {
  /** Where the app is served, such as "https://app.factwright.com". */
  appUrl: string;
  secret: string;
  database: BetterAuthOptions['database'];
  github?: Provider | undefined;
  google?: Provider | undefined;
  /**
   * The only GitHub accounts that may sign in, by user name in lowercase, on a server of your own
   * that lists them. Without a list, as on Factwright's own server, anyone can.
   */
  allowedGitHubUsers?: ReadonlySet<string> | undefined;
  /** Deletes everything an account has, before the account itself goes. */
  beforeDeleteUser: (accountId: string, request?: Request) => Promise<void>;
  /** Sign-ins each IP address may start in a minute. */
  signInsPerMinute?: number;
}

/**
 * How people sign in: with GitHub or Google, through Better Auth. Accounts and sessions live in
 * D1. The desktop app signs in with a device code the user approves in their browser, then
 * sends its session as a bearer token. Nothing here ever touches the keys that lock data.
 */
export function authOptions(settings: AuthSettings) {
  return {
    appName: 'Factwright',
    baseURL: settings.appUrl,
    basePath: '/api/auth',
    secret: settings.secret,
    database: settings.database,
    trustedOrigins: [settings.appUrl],
    socialProviders: {
      ...(settings.github && { github: settings.github }),
      ...(settings.google && { google: settings.google }),
    },
    session: {
      additionalFields: {
        via: { type: 'string', required: false, input: false },
      },
      // A session lasts 60 days, and renews at most once a day while it's used.
      expiresIn: 60 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      // Deleting the account needs a sign-in in the last 15 minutes.
      freshAge: 15 * 60,
    },
    // GitHub's and Google's tokens are never kept (see databaseHooks), and are encrypted while
    // sign-in still holds them.
    account: { encryptOAuthTokens: true },
    disabledPaths: [
      // Sign-in's ways to hand out or refresh a provider's token, or read its profile again. With
      // no tokens kept, there's nothing for them to do.
      '/get-access-token',
      '/refresh-token',
      '/account-info',
      // Listing sessions hands out every session's token, so a device's session could take a
      // browser's and do what only a browser's may. The account page lists devices without them.
      '/list-sessions',
      // Signing out other sessions goes through the account page, which names each device.
      '/revoke-session',
      '/revoke-sessions',
      '/revoke-other-sessions',
    ],
    databaseHooks: {
      // The account page shows a name and an email. A link to the profile picture isn't kept.
      user: {
        create: { before: async (user) => ({ data: { ...user, image: null } }) },
        update: { before: async (user) => ({ data: { ...user, image: null } }) },
      },
      session: {
        create: {
          before: async (session, context) => {
            const via: SignedInVia = WEB_SIGN_IN.test(context?.path ?? '') ? 'web' : 'device';
            const kept = deviceOnly(session);
            if (byExtension(context) && 'userAgent' in kept) {
              kept.userAgent = `${EXTENSION_NAME} ${kept.userAgent}`;
            }
            return { data: { ...kept, via } };
          },
        },
        update: { before: async (session) => ({ data: deviceOnly(session) }) },
      },
      account: {
        create: { before: async (account) => ({ data: { ...account, ...PROVIDER_TOKENS } }) },
        update: { before: async (account) => ({ data: { ...account, ...PROVIDER_TOKENS } }) },
      },
    },
    user: {
      ...(settings.allowedGitHubUsers && {
        validateUserInfo: onlyListed(settings.allowedGitHubUsers),
      }),
      deleteUser: {
        enabled: true,
        beforeDelete: async (user: { id: string }, request?: Request) =>
          settings.beforeDeleteUser(user.id, request),
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        // Signing in, on the web or for the app, and approving the app's code in the browser.
        ...Object.fromEntries(
          ['/sign-in/*', '/device/code', '/device', '/device/approve', '/device/deny'].map(
            (path) => [path, { window: 60, max: settings.signInsPerMinute ?? 10 }],
          ),
        ),
        // The app asks every 5 seconds while the user signs in, for up to the code's 10 minutes.
        // Better Auth only starts counting again after a quiet minute, so this covers all of it.
        '/device/token': { window: 60, max: 150 },
      },
    },
    // A sign-in that doesn't work, such as when someone cancels at GitHub, or a server of your
    // own turns them away, goes back to the web view, with why in the address, for it to say in
    // its own words. One the web view started comes back to the page it was on, which it names
    // as it starts. The rest, such as one that ran out, come back to the first page, as does
    // anyone who opens sign-in's own error page.
    onAPIError: { errorURL: `${settings.appUrl}/` },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      useSecureCookies: settings.appUrl.startsWith('https://'),
    },
    telemetry: { enabled: false },
    plugins: [
      bearer(),
      deviceAuthorization({
        expiresIn: '10m',
        interval: '5s',
        verificationUri: '/device',
        validateClient: (clientId: string) => DEVICE_CLIENTS.has(clientId),
      }),
    ],
  } satisfies BetterAuthOptions;
}

/** Undoes the app's percent-encoding of its name, which headers can't carry otherwise. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * A name deviceName gives, which sessions keep in place of what the device sent, or the browser
 * extension's, which is a browser's with its own name in front.
 */
const DEVICE_NAME =
  /^(Factwright on .{1,100}|(Save to Factwright in )?(Edge|Firefox|Chrome|Safari|A browser)( on (iPhone|iPad|Android|Mac|Windows|Linux))?)$/;

/**
 * A device's name, from what it sent when it signed in, such as "Safari on iPhone". The app
 * sends its computer's name percent-encoded, as "Factwright/1.0 (Sam%E2%80%99s Mac)". A name it
 * already gave comes back as it is.
 */
export function deviceName(userAgent: string | null | undefined): string {
  const agent = userAgent ?? '';
  if (DEVICE_NAME.test(agent)) return agent;
  const app = /^Factwright\/\S+ \((.{1,300})\)$/.exec(agent);
  if (app?.[1]) return `Factwright on ${decoded(app[1]).slice(0, 100)}`;
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\/|FxiOS\//.test(agent)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'A browser';
  const system = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(agent)
          ? 'Mac'
          : /Windows/.test(agent)
            ? 'Windows'
            : /Linux/.test(agent)
              ? 'Linux'
              : null;
  return system ? `${browser} on ${system}` : browser;
}
