import { Button } from '@factwright/ui';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import styles from './page.module.css';
import { answerDeviceCode, openDeviceCode } from './server.ts';

type Step = 'opening' | 'asking' | 'allowed' | 'declined' | { problem: string };

/** "WDJBMJHT" as "WDJB-MJHT", easier to compare with what the app shows. */
const spaced = (code: string) =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/**
 * The page the desktop app opens to sign in: the person checks the code matches the one the
 * app shows, then lets it sign in to their account, or turns it away.
 */
export function ApproveDevice({ userCode }: { userCode: string }) {
  const [step, setStep] = useState<Step>('opening');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void openDeviceCode(userCode).then((result) => {
      if (!live) return;
      if (!result.ok) setStep({ problem: result.message });
      else if (result.status === 'pending') setStep('asking');
      else setStep(result.status === 'approved' ? 'allowed' : 'declined');
    });
    return () => {
      live = false;
    };
  }, [userCode]);

  const answer = async (allow: boolean) => {
    setBusy(true);
    const ok = await answerDeviceCode(userCode, allow);
    setBusy(false);
    if (ok) setStep(allow ? 'allowed' : 'declined');
    else setStep({ problem: 'That didn’t go through. In Factwright, start signing in again.' });
  };

  return (
    <section className={styles.card} aria-labelledby="device-title">
      <h1 id="device-title" className={styles.title}>
        Let your computer sign in?
      </h1>
      {step === 'opening' && <p className={styles.hint}>Checking the code…</p>}
      {step === 'asking' && (
        <>
          <p className={styles.lead}>Check that your computer shows this code:</p>
          <p className={styles.code}>{spaced(userCode.toUpperCase())}</p>
          <p className={styles.hint}>
            Only allow it if you just started signing in from Factwright. It lets that computer sync
            your job hunt.
          </p>
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
            Your computer is signed in.
          </p>
          <p className={styles.lead}>You can close this tab and go back to Factwright.</p>
        </>
      )}
      {step === 'declined' && (
        <p className={styles.lead}>
          Turned away. The computer that showed this code won’t sign in with it.
        </p>
      )}
      {typeof step === 'object' && (
        <p className={styles.problem} role="alert">
          {step.problem}
        </p>
      )}
    </section>
  );
}
