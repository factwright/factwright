import { Button } from '@factwright/ui';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import styles from './page.module.css';
import {
  answerDeviceCode,
  openDeviceCode,
  PROVIDER_NAMES,
  type Provider,
  signIn,
} from './server.ts';

type Step = 'opening' | 'asking' | 'allowed' | 'declined' | 'sign-in' | { problem: string };

/** What the page says, for the desktop app or for the browser extension, Save to Factwright. */
const WORDS = {
  app: {
    title: 'Let your computer sign in?',
    check: 'Check that your computer shows this code:',
    only: 'Only allow it if you just started signing in from Factwright. It lets that computer sync your job hunt.',
    allowed: 'Your computer is signed in.',
    next: 'You can close this tab and go back to Factwright.',
    declined: 'Turned away. The computer that showed this code won’t sign in with it.',
    again: 'To let a computer in, sign in again here first. Then you’ll see the code again.',
  },
  extension: {
    title: 'Let Save to Factwright sign in?',
    check: 'Check that Save to Factwright’s setup page shows this code:',
    only: 'Only allow it if you just started setting up Save to Factwright, the browser extension. It lets it save jobs to your job hunt from this browser.',
    allowed: 'Save to Factwright is signed in.',
    next: 'Go back to its setup page to link it with Factwright on your computer.',
    declined: 'Turned away. Save to Factwright won’t sign in with this code.',
    again: 'To let it in, sign in again here first. Then you’ll see the code again.',
  },
} as const;

/** "WDJBMJHT" as "WDJB-MJHT", easier to compare with what the app shows. */
const spaced = (code: string) =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/**
 * The page the desktop app, or the browser extension, opens to sign in: the person checks the code
 * matches the one it shows, then lets it sign in to their account, or turns it away.
 */
export function ApproveDevice({
  userCode,
  providers = [],
}: {
  userCode: string;
  providers?: Provider[];
}) {
  const [step, setStep] = useState<Step>('opening');
  const [asker, setAsker] = useState<'app' | 'extension'>('app');
  const [busy, setBusy] = useState(false);
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
    const result = await answerDeviceCode(userCode, allow);
    setBusy(false);
    if (result === 'answered') setStep(allow ? 'allowed' : 'declined');
    else if (result === 'sign-in') setStep('sign-in');
    else setStep({ problem: 'That didn’t go through. In Factwright, start signing in again.' });
  };

  // Signing in here makes this browser's own session, then comes back to the code.
  const signInAgain = async (provider: Provider) => {
    setBusy(true);
    const failed = await signIn(provider, location.pathname + location.search);
    if (failed) {
      setBusy(false);
      setStep({ problem: failed });
    }
  };

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
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => answer(false)}>
              Don’t allow
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => answer(true)}>
              Allow
            </Button>
          </div>
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
