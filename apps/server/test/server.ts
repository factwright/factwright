import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SyncClient } from '@factwright/sync';
import { createTestHarness } from 'wrangler';

/** The secret sessions and tickets are signed with, in tests only. */
export const SECRET = 'test-only-secret-for-signing-sessions-0123456789';

/** Where the app thinks it's served from, until the test server knows its own address. */
const APP_URL = 'http://localhost';

/**
 * Sync isn't sold in the tests unless one sells it with settings of its own, whatever
 * apps/server/.dev.vars has for `pnpm dev`, such as Stripe's test keys, as Wrangler reads that
 * file here too.
 */
const NOT_SELLING = {
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  STRIPE_PRICE_MONTHLY: '',
  STRIPE_PRICE_YEARLY: '',
  STRIPE_API_URL: '',
  STRIPE_MANAGED_PAYMENTS: 'false',
  EARLY_BEFORE: '',
};

/** The bindings the tests reach into, typed as loosely as the harness hands them over. */
interface Bindings {
  DB: {
    prepare(query: string): {
      bind(...values: unknown[]): {
        run(): Promise<unknown>;
        all<T>(): Promise<{ results: T[] }>;
        first<T>(): Promise<T | null>;
      };
    };
  };
  FILES: {
    list(options: { prefix: string }): Promise<{ objects: { key: string }[] }>;
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    put(key: string, value: string | ArrayBuffer | Uint8Array): Promise<unknown>;
  };
}

export interface Account {
  id: string;
  email: string;
  /** The session token, as the desktop app sends it. */
  token: string;
  sessionId: string;
  /** A client signed in as this account. */
  client: SyncClient;
}

/**
 * Runs the real Worker locally, in workerd, with its own empty database, files and stores.
 * Accounts are made straight in the database, as GitHub sign-in would make them.
 */
export async function startServer(vars: Record<string, string> = {}) {
  // The web view's files are served from here once it's built; the API doesn't need them.
  mkdirSync(fileURLToPath(new URL('../../web/dist', import.meta.url)), { recursive: true });
  const worker = (appUrl: string) => ({
    configPath: './wrangler.jsonc',
    // Tests sign in far more often than a person would.
    vars: { APP_URL: appUrl, SIGN_INS_PER_MINUTE: '1000', ...NOT_SELLING, ...vars },
    secrets: { BETTER_AUTH_SECRET: SECRET, ADMIN_TOKEN: 'test-admin-token' },
  });
  const server = createTestHarness({
    root: fileURLToPath(new URL('..', import.meta.url)),
    workers: [worker(APP_URL)],
  });
  // The server knows its own address, as it does once deployed, so the pages it names are real.
  const { url: first } = await server.listen();
  await server.update((current) => ({ ...current, workers: [worker(first.origin)] }));
  const { url } = await server.listen();
  const handle = server.getWorker();
  await handle.applyD1Migrations('DB');
  const env = (await handle.getEnv()) as unknown as Bindings;

  /** A client for a session token, against this server. */
  const clientFor = (token: string | null, userAgent = 'Factwright/0.0.0 (Test Mac)') =>
    new SyncClient({
      server: url.toString(),
      token: () => token,
      headers: { 'user-agent': userAgent },
    });

  /**
   * Signs a new session in for an account, as signing in again would: in a browser with GitHub
   * ("web"), unless it's a device's, from a code ("device").
   */
  async function newSession(
    userId: string,
    userAgent = 'Factwright/0.0.0 (Test Mac)',
    via: 'web' | 'device' = 'web',
  ) {
    const token = randomBytes(24).toString('base64url');
    const sessionId = randomUUID();
    const now = new Date();
    await env.DB.prepare(
      `INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId, via)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        sessionId,
        new Date(now.getTime() + 60 * 86_400_000).toISOString(),
        token,
        now.toISOString(),
        now.toISOString(),
        null,
        userAgent,
        userId,
        via,
      )
      .run();
    return { token, sessionId, client: clientFor(token, userAgent) };
  }

  /**
   * Makes an account with one signed-in session, now: with a made-up email, verified, unless
   * given one, as GitHub or Google would say it.
   */
  async function signUp(
    name = 'Sam Rivera',
    {
      email,
      verified = true,
      since = new Date(),
    }: { email?: string; verified?: boolean; since?: Date } = {},
  ): Promise<Account> {
    const id = randomBytes(16).toString('hex');
    const address = email ?? `${id}@example.com`;
    const now = since.toISOString();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    )
      .bind(id, name, address, verified ? 1 : 0, now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO "account" (id, accountId, providerId, userId, createdAt, updatedAt)
       VALUES (?, ?, 'github', ?, ?, ?)`,
    )
      .bind(randomUUID(), randomBytes(4).readUInt32BE().toString(), id, now, now)
      .run();
    return { id, email: address, ...(await newSession(id)) };
  }

  return {
    server,
    url,
    worker: handle,
    env,
    clientFor,
    signUp,
    newSession,
    close: () => server.close(),
  };
}

export type TestServer = Awaited<ReturnType<typeof startServer>>;

/** 43 characters of URL-safe base64, the shape of a record or file ID. */
export const someId = () => randomBytes(32).toString('base64url');

/** The cookie a browser keeps for a session, signed the way sign-in signs it. */
export function sessionCookie(token: string): string {
  const signature = createHmac('sha256', SECRET).update(token).digest('base64');
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}
