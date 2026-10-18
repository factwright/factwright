import { type Feature, isLegal, knownFeatures, type Legal } from '@factwright/sync';
import type { ServerHelp, ServerTerms } from '../../shared/sync.ts';

/** A sync server: Factwright's own, built into this copy, or one of your own. */
export interface SyncServer {
  /** Its address, as an origin, such as "https://app.factwright.com". */
  url: string;
  /** Whether it's a server of your own, which the window names by its address. */
  own: boolean;
}

/** What a server of your own's address looks like, for the problems below. */
export const EXAMPLE = 'https://factwright-sync.yourname.workers.dev';

/** This computer's names, which a server running on it, for testing, may use over http. */
const THIS_COMPUTER = new Set(['localhost', '127.0.0.1']);

/** A server's address as typed: the server, as an origin, or what's wrong with it. */
export type ServerAddress = { ok: true; server: string } | { ok: false; message: string };

/**
 * Reads a server of your own's address, as it was typed. It's https, and the address alone: no
 * path, user name or password. One typed without https:// is taken as one. Only a server on this
 * computer, for testing, may use http.
 */
export function readServerAddress(typed: string): ServerAddress {
  const text = typed.trim();
  if (!text) return { ok: false, message: 'Type your server’s address.' };
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return { ok: false, message: `That isn’t an address. It looks like ${EXAMPLE}.` };
  }
  const here = url.protocol === 'http:' && THIS_COMPUTER.has(url.hostname);
  if (url.protocol !== 'https:' && !here) {
    return { ok: false, message: 'Use your server’s address that starts with https://.' };
  }
  if (url.username || url.password) {
    return { ok: false, message: 'Leave out the user name and password: type the address alone.' };
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return {
      ok: false,
      message: `Type the address alone, with nothing after it, like ${EXAMPLE}.`,
    };
  }
  return { ok: true, server: url.origin };
}

/** What a sync server says it offers, in its sign-in options. */
export interface SignInOptions {
  /** Its ways to sign in, such as "github". */
  providers: string[];
  features: Feature[];
  /** The terms and privacy policy signing in to it agrees to, when it has them. */
  legal: Legal | null;
}

/**
 * A server's sign-in options, or null when they aren't a Factwright sync server's. Those list its
 * ways to sign in, which is what Factwright's releases check their own server for.
 */
export function readSignInOptions(answer: unknown): SignInOptions | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { providers, features, legal } = answer as Record<string, unknown>;
  if (!Array.isArray(providers)) return null;
  return {
    providers: providers.filter((each): each is string => typeof each === 'string'),
    features: knownFeatures(features),
    legal: isLegal(legal) ? legal : null,
  };
}

/** What the window shows of a server's sign-in options. */
export const termsOf = (options: SignInOptions): ServerTerms => ({
  legal: options.legal,
  subscription: options.features.includes('subscription'),
});

/** How long a server has to answer, in milliseconds. */
const ANSWER_MS = 15_000;

/** Asks a server for its sign-in options. Only its own answer counts, never a redirect's. */
export async function askSignInOptions(
  server: string,
  fetcher: typeof fetch = fetch,
): Promise<SignInOptions | 'unreachable' | null> {
  let response: Response;
  try {
    response = await fetcher(new URL('/api/sign-in-options', server), {
      redirect: 'manual',
      signal: AbortSignal.timeout(ANSWER_MS),
    });
  } catch {
    return 'unreachable';
  }
  if (!response.ok) return null;
  return readSignInOptions(await response.json().catch(() => null));
}

/**
 * What this version of Factwright needs from a server of your own. Approving a new device from one
 * that's set up is how it links them, and every server copy from github.com/factwright/sync-server
 * has it. It signs in to one only through the browser with no code to compare, coming back to the
 * app on this computer (loopback.ts), which servers have had since this version.
 */
const NEEDS: readonly Feature[] = ['approve', 'loopback-sign-in'];

/** Whether a server of your own will do, or why not, with the page that helps. */
export type ServerCheck =
  | { ok: true; options: SignInOptions }
  | { ok: false; message: string; help?: ServerHelp };

/**
 * Checks a server of your own before signing in to it: it answers as a Factwright sync server,
 * with what this version needs and a way to sign in.
 */
export async function checkServer(
  server: string,
  fetcher: typeof fetch = fetch,
): Promise<ServerCheck> {
  const options = await askSignInOptions(server, fetcher);
  if (options === 'unreachable') {
    return {
      ok: false,
      message: 'Can’t reach that server. Check its address and your connection, then try again.',
    };
  }
  if (!options) {
    return {
      ok: false,
      message: 'That address doesn’t answer as a Factwright sync server. Check it’s your server’s.',
    };
  }
  if (!NEEDS.every((need) => options.features.includes(need))) {
    return {
      ok: false,
      message: 'Your server needs an update for this version of Factwright.',
      help: 'update',
    };
  }
  if (options.providers.length === 0) {
    return {
      ok: false,
      message: 'Your server has no way to sign in yet. Set up its GitHub sign-in, then try again.',
      help: 'set-up',
    };
  }
  return { ok: true, options };
}
