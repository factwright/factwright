import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SyncClient } from '@factwright/sync';
import { createTestHarness } from 'wrangler';

/** The secret sessions and tickets are signed with, in tests only. */
export const SECRET = 'test-only-secret-for-signing-sessions-0123456789';

/** Where the app thinks it's served from, in tests. */
export const APP_URL = 'http://localhost';

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
  const server = createTestHarness({
    root: fileURLToPath(new URL('..', import.meta.url)),
    workers: [
      {
        configPath: './wrangler.jsonc',
        vars: { APP_URL, ...vars },
        secrets: { BETTER_AUTH_SECRET: SECRET, ADMIN_TOKEN: 'test-admin-token' },
      },
    ],
  });
  const { url } = await server.listen();
  const worker = server.getWorker();
  await worker.applyD1Migrations('DB');
  const env = (await worker.getEnv()) as unknown as Bindings;

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

  return { server, url, worker, env, clientFor, signUp, newSession, close: () => server.close() };
}

export type TestServer = Awaited<ReturnType<typeof startServer>>;

/** 43 characters of URL-safe base64, the shape of a record or file ID. */
export const someId = () => randomBytes(32).toString('base64url');
