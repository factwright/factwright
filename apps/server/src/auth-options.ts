import type { BetterAuthOptions } from 'better-auth';
import { bearer } from 'better-auth/plugins/bearer';
import { deviceAuthorization } from 'better-auth/plugins/device-authorization';

/** The desktop app's name in sign-in, the only app that may sign in with a device code. */
export const DESKTOP_CLIENT = 'factwright-desktop';

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

/** What sign-in needs, apart from where it runs. */
export interface AuthSettings {
  /** Where the app is served, such as "https://app.factwright.com". */
  appUrl: string;
  secret: string;
  database: BetterAuthOptions['database'];
  github?: Provider | undefined;
  google?: Provider | undefined;
  /** Deletes everything an account has, before the account itself goes. */
  beforeDeleteUser: (accountId: string) => Promise<void>;
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
      // A session lasts 60 days, and renews at most once a day while it's used.
      expiresIn: 60 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      // Deleting the account needs a sign-in in the last 15 minutes.
      freshAge: 15 * 60,
    },
    // GitHub's and Google's tokens are never kept (see databaseHooks), and are encrypted while
    // sign-in still holds them.
    account: { encryptOAuthTokens: true },
    // Sign-in's ways to hand out or refresh a provider's token, or read its profile again. With no
    // tokens kept, there's nothing for them to do.
    disabledPaths: ['/get-access-token', '/refresh-token', '/account-info'],
    databaseHooks: {
      // The account page shows a name and an email. A link to the profile picture isn't kept.
      user: {
        create: { before: async (user) => ({ data: { ...user, image: null } }) },
        update: { before: async (user) => ({ data: { ...user, image: null } }) },
      },
      session: {
        create: { before: async (session) => ({ data: deviceOnly(session) }) },
        update: { before: async (session) => ({ data: deviceOnly(session) }) },
      },
      account: {
        create: { before: async (account) => ({ data: { ...account, ...PROVIDER_TOKENS } }) },
        update: { before: async (account) => ({ data: { ...account, ...PROVIDER_TOKENS } }) },
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user: { id: string }) => settings.beforeDeleteUser(user.id),
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
        validateClient: (clientId: string) => clientId === DESKTOP_CLIENT,
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

/** A name deviceName gives, which sessions keep in place of what the device sent. */
const DEVICE_NAME =
  /^(Factwright on .{1,100}|(Edge|Firefox|Chrome|Safari|A browser)( on (iPhone|iPad|Android|Mac|Windows|Linux))?)$/;

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
