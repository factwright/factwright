import type { ExtensionAsk } from '@factwright/sync';
import { Button } from '@factwright/ui';
import { useState } from 'react';
import { forgetKeys } from './keys.ts';
import { OtherAccount, SignedInAs } from './OtherAccount.tsx';
import styles from './page.module.css';
import { leaveFor } from './route.ts';
import { answerExtension, PROVIDER_NAMES, type Provider, signIn, signOut } from './server.ts';

type Step =
  | 'asking'
  /** Picking how to sign in with another account. Nothing has changed yet. */
  | 'switching'
  /** On the way back to the extension, which closes the window. */
  | 'going'
  | 'sign-in'
  | { problem: string };

/** This page, with what the extension asked, for signing in to come back to. */
const here = () => location.pathname + location.search;

/** Why a sign-in Save to Factwright didn't ask for, or that can't come back to it, can't go on. */
export const NOT_ASKED =
  'This isn’t a sign-in Save to Factwright can finish here. Close this window, and sign in again from Save to Factwright’s setup.';

/**
 * The page the browser's own window for extensions opens, for Save to Factwright to sign in: it
 * names the account the extension signs in to, and lets it in, or doesn't. Either answer goes back
 * to the extension through the browser, which closes the window. There's nothing to compare, since
 * the browser hands the answer only to the extension that opened the window. Signed in to the
 * wrong account, the person can sign in with another and come back here. `ask` is null when the
 * page's address isn't one the extension made, or one this server can answer.
 */
export function ApproveExtension({
  ask,
  email,
  providers = [],
  signInProblem = null,
}: {
  ask: ExtensionAsk | null;
  /** The account signed in here, which the extension signs in to once it's allowed. */
  email: string;
  providers?: Provider[];
  /** Why signing in again here didn't work, just now, to say until the person answers. */
  signInProblem?: string | null;
}) {
  const [step, setStep] = useState<Step>(ask ? 'asking' : { problem: NOT_ASKED });
  const [busy, setBusy] = useState(false);
  const [signInSaid, setSignInSaid] = useState(signInProblem);

  const answer = async (allow: boolean) => {
    if (!ask) return;
    setBusy(true);
    setSignInSaid(null);
    const result = await answerExtension(ask, allow);
    if (result.ok) {
      setStep('going');
      leaveFor(result.url);
      return;
    }
    setBusy(false);
    setStep(result.reason === 'sign-in' ? 'sign-in' : { problem: result.message });
  };

  // Signing in here makes this browser's own session, then comes back to this page.
  const signInAgain = async (provider: Provider) => {
    setBusy(true);
    const failed = await signIn(provider, here());
    if (failed) {
      setBusy(false);
      setStep({ problem: failed });
    }
  };

  // Another account's sign-in starts first, so nothing here changes if it can't. Then, just before
  // the browser goes, this browser signs out, forgetting its keys first, as signing out does.
  // Signed in again, it comes back to this page, as the new account.
  const switchTo = async (provider: Provider) => {
    setBusy(true);
    setSignInSaid(null);
    const failed = await signIn(provider, here(), async () => {
      await forgetKeys().catch(() => {});
      await signOut().catch(() => {});
    });
    if (failed) {
      setBusy(false);
      setSignInSaid(failed);
    }
  };

  const said = signInSaid && (
    <p className={styles.problem} role="alert">
      {signInSaid}
    </p>
  );

  return (
    <section className={styles.card} aria-labelledby="extension-title">
      <h1 id="extension-title" className={styles.title}>
        Let Save to Factwright sign in?
      </h1>
      {step === 'asking' && (
        <>
          <p className={styles.lead}>
            Save to Factwright, the browser extension, asks to sign in to sync, so it can save jobs
            to your job hunt from this browser.
          </p>
          <SignedInAs
            email={email}
            about="Save to Factwright signs in to this account, so it needs to be the one Factwright on your computer uses."
            providers={providers}
            busy={busy}
            onSwitch={() => {
              setSignInSaid(null);
              setStep('switching');
            }}
          />
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => answer(false)}>
              Don’t allow
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => answer(true)}>
              Allow
            </Button>
          </div>
          {said}
        </>
      )}
      {step === 'switching' && (
        <>
          <OtherAccount
            lead="Sign in with the account Factwright on your computer uses. Then you’ll come back here to allow it."
            email={email}
            providers={providers}
            busy={busy}
            onBack={() => {
              setSignInSaid(null);
              setStep('asking');
            }}
            onPick={(provider) => void switchTo(provider)}
          />
          {said}
        </>
      )}
      {step === 'going' && (
        <p className={styles.hint} role="status">
          Going back to Save to Factwright…
        </p>
      )}
      {step === 'sign-in' && (
        <>
          <p className={styles.lead}>To let it in, sign in again here first.</p>
          <div className={styles.actions}>
            {providers.map((provider) => (
              <Button
                key={provider}
                variant={provider === providers[0] ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => void signInAgain(provider)}
              >
                Sign in with {PROVIDER_NAMES[provider]}
              </Button>
            ))}
          </div>
        </>
      )}
      {typeof step === 'object' && (
        <p className={styles.problem} role="alert">
          {step.problem}
        </p>
      )}
    </section>
  );
}
