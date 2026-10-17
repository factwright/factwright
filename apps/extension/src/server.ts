import { FACTWRIGHT_SYNC } from './manifest.ts';

/**
 * Which sync server the extension uses: Factwright's, or a server of your own, which you choose in
 * setup. Setup offers Factwright's first, unless the extension was built for another with
 * VITE_FACTWRIGHT_SYNC_SERVER, such as one running locally, as the desktop app's builds can be.
 * The extension's sign-in keeps the server it's for (src/account.ts), so its token only ever goes
 * there.
 */
export const DEFAULT_SERVER: string = new URL(
  import.meta.env.VITE_FACTWRIGHT_SYNC_SERVER || FACTWRIGHT_SYNC,
).origin;

/** Whether this is the stores' build, made for Factwright's own sync. */
export const FOR_STORES = DEFAULT_SERVER === FACTWRIGHT_SYNC;

/** What a server of your own's address looks like, for the field's hint and the problems below. */
export const EXAMPLE = 'https://factwright-sync.yourname.workers.dev';

/** The names this computer goes by, where a build for testing may reach a server over http. */
const THIS_COMPUTER = ['localhost', '127.0.0.1'];

/** A host name as browsers' permissions take one: a name or an IP address, never a pattern. */
const HOST = /^(?:[a-z0-9_-]+\.)*[a-z0-9_-]+$|^\[[0-9a-f:.]+\]$/i;

/** A server's address as typed: the server, as an origin, or what's wrong with it. */
export type ServerAddress = { ok: true; server: string } | { ok: false; problem: string };

/**
 * Reads a sync server's address as you typed it. It must be https, and the address alone: no path,
 * no user name or password. An address typed without https:// is taken as one. A build that isn't
 * for the stores also takes this computer's over http, for a server running locally, as Factwright
 * on the computer can for testing.
 */
export function readServer(typed: string, local: boolean = !FOR_STORES): ServerAddress {
  const text = typed.trim();
  if (!text) return { ok: false, problem: 'Type your server’s address.' };
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return { ok: false, problem: `That isn’t an address. It looks like ${EXAMPLE}.` };
  }
  const here = url.protocol === 'http:' && local && THIS_COMPUTER.includes(url.hostname);
  if (url.protocol !== 'https:' && !here) {
    return { ok: false, problem: 'Your server’s address must start with https://.' };
  }
  if (url.username || url.password) {
    return { ok: false, problem: 'Leave out the user name and password: type the address alone.' };
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return {
      ok: false,
      problem: `Type the address alone, with nothing after it, like ${EXAMPLE}.`,
    };
  }
  if (!HOST.test(url.hostname)) {
    return { ok: false, problem: `That isn’t an address. It looks like ${EXAMPLE}.` };
  }
  return { ok: true, server: url.origin };
}

/**
 * Whether a server's sign-in options are a Factwright sync server's: it lists its ways to sign in,
 * as Factwright's releases check their own server.
 */
export function isSyncServer(answer: unknown): boolean {
  return (
    typeof answer === 'object' &&
    answer !== null &&
    Array.isArray((answer as { providers?: unknown }).providers)
  );
}

/** How long a server has to answer, when setup checks it. */
const CHECK_MS = 15_000;

/**
 * What checking a server found: it's a Factwright sync server; it didn't answer, or not for now;
 * or it answered as something else.
 */
export type ServerCheck = 'ok' | 'unreachable' | 'not-sync';

/**
 * Checks that a server of your own answers as a Factwright sync server, before setup signs in to
 * it. The answer must be its own: a redirect anywhere doesn't count. A server that's busy or
 * failing for now, as one can be while it's deployed, didn't answer, so trying again may work.
 */
export async function checkServer(
  server: string,
  fetcher: typeof fetch = fetch,
): Promise<ServerCheck> {
  let text: string;
  try {
    const response = await fetcher(new URL('/api/sign-in-options', server), {
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(CHECK_MS),
    });
    if (response.status === 429 || response.status >= 500) return 'unreachable';
    if (!response.ok) return 'not-sync';
    text = await response.text();
  } catch {
    return 'unreachable';
  }
  try {
    return isSyncServer(JSON.parse(text)) ? 'ok' : 'not-sync';
  } catch {
    return 'not-sync';
  }
}

/** Whether a server is one of your own, not the one the extension was built for. */
export const isOwn = (server: string): boolean => server !== DEFAULT_SERVER;

/** A server's address as people know it, such as app.factwright.com. */
export const hostOf = (server: string): string => new URL(server).host;

/** A sync server as the extension's pages name it: Factwright's, or yours by its address. */
export const serverName = (server: string): string =>
  isOwn(server) ? `your sync server, ${hostOf(server)}` : 'Factwright’s sync';
