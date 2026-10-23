import { CLIENTS, readAsk, returnAddress, STORE_RETURNS } from '@factwright/sync';
import type { BetterAuthPlugin } from 'better-auth';
import { answerEndpoint, type CodeClient, tokenEndpoint } from './code-sign-in.ts';

/**
 * The extension's sign-in through the browser's own window for extensions, with no code to
 * compare (packages/sync/src/extension-sign-in.ts has how it goes). The web view's page asks the
 * person, signed in here in their browser, and its answer goes to the extension's return address,
 * which only the extension that opened the window gets. With a yes, that carries a code, which the
 * extension trades for a session of its own, with the verifier only it has. The device code stays,
 * for the desktop app's sign-in to Factwright's sync, the extension's older versions, and copies
 * this server doesn't know.
 */

/** Sign-in's own paths, under /api/auth. */
export const ANSWER_PATH = '/extension/authorize';
export const TOKEN_PATH = '/extension/token';

/**
 * The return addresses the window may go back to: the stores' copies of the extension, and
 * the extension IDs a server's EXTENSION_IDS setting adds, such as a copy you built yourself, or a
 * test's. Anything in it that isn't an extension's ID is left out, so the setting can add only an
 * address that a browser hands to that one extension.
 */
export async function extensionRedirects(setting: string | undefined): Promise<string[]> {
  const added = await Promise.all(
    (setting ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(returnAddress),
  );
  return [...new Set([...STORE_RETURNS, ...added.filter((each) => each !== null)])];
}

/**
 * The extension, as it signs in: to one of the return addresses `redirects` gives, with the
 * answer in the fragment, which the browser hands to the extension and never sends anywhere.
 */
const extension = (redirects: () => Promise<readonly string[]>): CodeClient => ({
  id: CLIENTS.extension,
  kind: 'extension',
  name: 'the Factwright extension',
  readAsk,
  returnsTo: async (redirect) => (await redirects()).includes(redirect),
  answerAt: (redirect, answer) => `${redirect}#${answer}`,
});

/**
 * The two steps, as sign-in's own routes (code-sign-in.ts). `issuer` is this server's own address,
 * which its answers name, and `redirects` gives the return addresses it knows.
 */
export function extensionSignIn(issuer: string, redirects: () => Promise<readonly string[]>) {
  const client = extension(redirects);
  return {
    id: 'extension-sign-in',
    endpoints: {
      extensionAnswer: answerEndpoint(client, ANSWER_PATH, issuer),
      extensionToken: tokenEndpoint(client, TOKEN_PATH),
    },
  } satisfies BetterAuthPlugin;
}
