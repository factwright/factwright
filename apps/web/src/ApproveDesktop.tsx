import type { DesktopAsk } from '@factwright/sync';
import { ApproveSignIn, type SignInWords } from './ApproveSignIn.tsx';
import { answerDesktop, type Provider } from './server.ts';

/** Why a sign-in the desktop app didn't ask for can't go on. */
export const NOT_ASKED =
  'This isn’t a sign-in Factwright on your computer can finish here. In Factwright, start signing in again.';

/** What the page says, on this server, `host`, such as sync.sam.workers.dev. */
const wordsFor = (host: string): SignInWords => ({
  title: 'Let Factwright on your computer sign in?',
  lead: `Factwright on your computer asks to sign in to ${host}, so it can sync your job hunt.`,
  only: 'Only allow it if you just started signing in from Factwright on this computer.',
  account: 'Your computer signs in to this account.',
  switch:
    'Sign in with the account you want your computer to use. Then you’ll come back here to allow it.',
  going: 'Going back to Factwright…',
  again: 'To let it in, sign in again here first.',
  notAsked: NOT_ASKED,
});

/**
 * The page the desktop app opens in the browser to sign in to a server of your own, with nothing
 * to compare: it names the account the app signs in to, and lets it in, or doesn't. Either answer
 * sends the browser back to the app, at its own address on the computer, where it listens, and
 * the app takes it only if it names the server it asked (ApproveSignIn, and desktop-sign-in.ts in
 * @factwright/sync).
 */
export function ApproveDesktop(props: {
  ask: DesktopAsk | null;
  account: string;
  email: string;
  providers?: Provider[];
  signInProblem?: string | null;
}) {
  return <ApproveSignIn words={wordsFor(location.host)} answer={answerDesktop} {...props} />;
}
