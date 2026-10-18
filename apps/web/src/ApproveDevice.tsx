import { Button } from '@factwright/ui';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { forgetKeys } from './keys.ts';
import styles from './page.module.css';
import {
  answerDeviceCode,
  openDeviceCode,
  PROVIDER_NAMES,
  type Provider,
  releaseDeviceCode,
  signIn,
  signOut,
  TAKEN,
} from './server.ts';

type Step =
  | 'opening'
  | 'asking'
  /** Picking how to sign in with another account. Nothing has changed yet. */
  | 'switching'
  | 'allowed'
  | 'declined'
  | 'sign-in'
  | { problem: string };

/** What the page says, for the desktop app or for the browser extension, Save to Factwright. */
const WORDS = {
  app: {
    title: 'Let your computer sign in?',
    check: 'Check that your computer shows this code:',
    only: 'Only allow it if you just started signing in from Factwright. It lets that computer sync your job hunt.',
    account: 'Your computer signs in to this account.',
    switch:
      'Sign in with the account you want your computer to use. Then you’ll see this code again.',
    allowed: 'Your computer is signed in.',
    next: 'You can close this tab and go back to Factwright.',
    declined: 'Turned away. The computer that showed this code won’t sign in with it.',
    again: 'To let a computer in, sign in again here first. Then you’ll see the code again.',
  },
  extension: {
    title: 'Let Save to Factwright sign in?',
    check: 'Check that the Set up Save to Factwright tab, the one you came from, shows this code:',
    only: 'Only allow it if you just started setting up Save to Factwright, the browser extension. It lets the extension save jobs to your job hunt from this browser.',
    account:
      'Save to Factwright signs in to this account, so it needs to be the one Factwright on your computer uses.',
    switch:
      'Sign in with the account Factwright on your computer uses. Then you’ll see this code again.',
    allowed: 'Save to Factwright is signed in.',
    next: 'Go back to the Set up Save to Factwright tab to link it with Factwright on your computer.',
    declined: 'Turned away. Save to Factwright won’t sign in with this code.',
    again: 'To let it in, sign in again here first. Then you’ll see the code again.',
  },
} as const;

/** "WDJBMJHT" as "WDJB-MJHT", easier to compare with what the app shows. */
const spaced = (code: string) =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/** This page, with its code, for signing in to come back to. */
const here = () => location.pathname + location.search;

/**
 * The page the desktop app, or the browser extension, opens to sign in: the person checks the code
 * matches the one it shows, and which account it signs in to, then lets it sign in, or turns it
 * away. Signed in to the wrong account, they can sign in with another and come back to the code.
 */
export function ApproveDevice({
  userCode,
  email,
  providers = [],
  signInProblem = null,
}: {
  userCode: string;
  /** The account signed in here, which the app or the extension signs in to once it's allowed. */
  email: string;
  providers?: Provider[];
  /**
   * Why signing in again here didn't work, just now. It's said with the code, still waiting, until
   * the person answers it.
   */
  signInProblem?: string | null;
}) {
  const [step, setStep] = useState<Step>('opening');
  const [asker, setAsker] = useState<'app' | 'extension'>('app');
  const [busy, setBusy] = useState(false);
  const [signInSaid, setSignInSaid] = useState(signInProblem);
  const words = WORDS[asker];

  useEffect(() => {
    let live = true;
    void openDeviceCode(userCode).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setStep({ problem: result.message });
        return;
      }
      setAsker(result.asker);
      if (result.status === 'pending') setStep('asking');
      else setStep(result.status === 'approved' ? 'allowed' : 'declined');
    });
    return () => {
      live = false;
    };
  }, [userCode]);

  const answer = async (allow: boolean) => {
    setBusy(true);
    setSignInSaid(null);
    const result = await answerDeviceCode(userCode, allow);
    setBusy(false);
    if (result === 'answered') setStep(allow ? 'allowed' : 'declined');
    else if (result === 'sign-in') setStep('sign-in');
    else if (result === 'taken') setStep({ problem: TAKEN });
    else setStep({ problem: 'That didn’t go through. In Factwright, start signing in again.' });
  };

  // Signing in here makes this browser's own session, then comes back to the code.
  const signInAgain = async (provider: Provider) => {
    setBusy(true);
    const failed = await signIn(provider, here());
    if (failed) {
      setBusy(false);
      setStep({ problem: failed });
    }
  };

  // Another account's sign-in starts first, so nothing here changes if it can't. Then, just before
  // the browser goes, this account lets go of the code, which only the account that opened it can
  // answer, and this browser signs out, forgetting its keys first, as signing out does. Signed in
  // again, it comes back to the code, which the new account opens.
  const switchTo = async (provider: Provider) => {
    setBusy(true);
    setSignInSaid(null);
    const failed = await signIn(provider, here(), async () => {
      await releaseDeviceCode(userCode).catch(() => {});
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
    <section className={styles.card} aria-labelledby="device-title">
      <h1 id="device-title" className={styles.title}>
        {words.title}
      </h1>
      {step === 'opening' && <p className={styles.hint}>Checking the code…</p>}
      {step === 'asking' && (
        <>
          <p className={styles.lead}>{words.check}</p>
          <p className={styles.code}>{spaced(userCode.toUpperCase())}</p>
          <p className={styles.hint}>{words.only}</p>
          <p className={styles.account}>
            Signed in as <strong>{email}</strong>. {words.account}
            {providers.length > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={busy}
                  onClick={() => {
                    setSignInSaid(null);
                    setStep('switching');
                  }}
                >
                  Use another account
                </button>
              </>
            )}
          </p>
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
          <p className={styles.lead}>{words.switch}</p>
          <p className={styles.hint}>
            This signs {email} out of this browser. To use another{' '}
            {providers.map((provider) => PROVIDER_NAMES[provider]).join(' or ')} account, switch to
            it there first.
          </p>
          <div className={styles.actions}>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setSignInSaid(null);
                setStep('asking');
              }}
            >
              Back
            </Button>
            {providers.map((provider) => (
              <Button
                key={provider}
                variant={provider === providers[0] ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => void switchTo(provider)}
              >
                Sign in with {PROVIDER_NAMES[provider]}
              </Button>
            ))}
          </div>
          {said}
        </>
      )}
      {step === 'allowed' && (
        <>
          <p className={styles.done}>
            <CircleCheck size={18} aria-hidden="true" />
            {words.allowed}
          </p>
          <p className={styles.lead}>{words.next}</p>
        </>
      )}
      {step === 'declined' && <p className={styles.lead}>{words.declined}</p>}
      {step === 'sign-in' && (
        <>
          <p className={styles.lead}>{words.again}</p>
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
