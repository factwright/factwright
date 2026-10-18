import { CLIENTS, isLoopbackReturn, readDesktopAsk } from '@factwright/sync';
import type { BetterAuthPlugin } from 'better-auth';
import { answerEndpoint, type CodeClient, tokenEndpoint } from './code-sign-in.ts';

/**
 * The desktop app's sign-in through the browser with no code to compare, as it signs in to a
 * server of your own (packages/sync/src/desktop-sign-in.ts has how it goes). The web view's page
 * asks the person, signed in here in their browser, and its answer sends the browser back to the
 * app, on the computer it runs on. With a yes, that carries a code, which the app trades for a
 * session of its own, with the verifier only it has. The app signs in to Factwright's sync with a
 * device code still, as its older versions do.
 */

/** Sign-in's own paths, under /api/auth. */
export const DESKTOP_ANSWER_PATH = '/desktop/authorize';
export const DESKTOP_TOKEN_PATH = '/desktop/token';

/**
 * The desktop app, as it signs in: back to its own address on the browser's computer, at any
 * port, with the answer in the query, where the app hears it.
 */
const desktop: CodeClient = {
  id: CLIENTS.desktop,
  kind: 'desktop',
  name: 'Factwright',
  readAsk: readDesktopAsk,
  returnsTo: async (redirect) => isLoopbackReturn(redirect),
  answerAt: (redirect, answer) => `${redirect}?${answer}`,
};

/**
 * The two steps, as sign-in's own routes (code-sign-in.ts). `issuer` is this server's own address,
 * which its answers name.
 */
export function desktopSignIn(issuer: string) {
  return {
    id: 'desktop-sign-in',
    endpoints: {
      desktopAnswer: answerEndpoint(desktop, DESKTOP_ANSWER_PATH, issuer),
      desktopToken: tokenEndpoint(desktop, DESKTOP_TOKEN_PATH),
    },
  } satisfies BetterAuthPlugin;
}
