import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SyncClient } from '@factwright/sync';
import { createTestHarness } from 'wrangler';

/** The secret sessions and tickets are signed with, in tests only. */
export const SECRET = 'test-only-secret-for-signing-sessions-0123456789';

/** Where the app thinks it's served from, until the test server knows its own address. */
const APP_URL = 'http://localhost';

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
    vars: { APP_URL: appUrl, SIGN_INS_PER_MINUTE: '1000', ...vars },
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

  /** Signs a new session in for an account, as signing in again would. */
  async function newSession(userId: string, userAgent = 'Factwright/0.0.0 (Test Mac)') {
    const token = randomBytes(24).toString('base64url');
    const sessionId = randomUUID();
    const now = new Date();
    await env.DB.prepare(
      `INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        sessionId,
        new Date(now.getTime() + 60 * 86_400_000).toISOString(),
        token,
        now.toISOString(),
        now.toISOString(),
        '127.0.0.1',
        userAgent,
        userId,
      )
      .run();
    return { token, sessionId, client: clientFor(token, userAgent) };
  }

  /** Makes an account with one signed-in session. */
  async function signUp(name = 'Sam Rivera'): Promise<Account> {
    const id = randomBytes(16).toString('hex');
    const email = `${id}@example.com`;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    )
      .bind(id, name, email, now, now)
      .run();
    return { id, email, ...(await newSession(id)) };
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
