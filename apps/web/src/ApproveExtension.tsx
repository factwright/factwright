import type { ExtensionAsk } from '@factwright/sync';
import { ApproveSignIn, type SignInWords } from './ApproveSignIn.tsx';
import { answerExtension, type Provider } from './server.ts';

/** Why a sign-in the extension didn't ask for, or that can't come back to it, can't go on. */
export const NOT_ASKED =
  'This isn’t a sign-in the Factwright extension can finish here. Close this window, and sign in again from the extension’s setup.';

const WORDS: SignInWords = {
  title: 'Let the Factwright extension sign in?',
  lead: 'The Factwright extension asks to sign in to sync, so it can save jobs to your job hunt from this browser.',
  only: 'Only allow it if you just clicked Sign in to sync in the extension’s setup.',
  account:
    'The extension signs in to this account, so it needs to be the one Factwright on your computer uses.',
  switch:
    'Sign in with the account Factwright on your computer uses. Then you’ll come back here to allow it.',
  going: 'Going back to the extension…',
  again: 'To let it in, sign in again here first.',
  notAsked: NOT_ASKED,
};

/**
 * The page the browser's own window for extensions opens, for the extension to sign in: it
 * names the account the extension signs in to, and lets it in, or doesn't. Either answer goes back
 * to the extension through the browser, which closes the window. There's nothing to compare, since
 * the browser hands the answer only to the extension that opened the window (ApproveSignIn).
 */
export function ApproveExtension(props: {
  ask: ExtensionAsk | null;
  account: string;
  email: string;
  providers?: Provider[];
  signInProblem?: string | null;
}) {
  return <ApproveSignIn words={WORDS} answer={answerExtension} {...props} />;
}
