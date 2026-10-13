import { PRIVACY_URL, TERMS_URL } from '@factwright/core';
import { Button, DialogActions } from '@factwright/ui';
import { Laptop, Lock, LogIn } from 'lucide-react';
import { useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { SyncStatus } from '../../shared/sync.ts';
import styles from './SyncDialog.module.css';

/** What sync does, and the button that starts signing in. */
export function SignInStep({
  api,
  status,
  close,
}: {
  api: FactwrightApi;
  status: SyncStatus;
  close: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const signIn = async () => {
    setProblem(null);
    const result = await api.signInToSync();
    if (!result.ok && result.message !== 'Signing in was canceled.') setProblem(result.message);
  };

  if (status.state === 'signing-in') {
    const copy = async () => {
      setCopied((await api.copyText(status.url)).ok);
    };
    return (
      <>
        <p className={styles.lead}>
          Your browser opened Factwright’s sign-in page. Sign in with GitHub or Google, then check
          the page shows this code before you allow it:
        </p>
        <p className={styles.code}>{status.code}</p>
        <p className={styles.hint} aria-live="polite">
          Waiting for your browser…{' '}
          <button type="button" className={styles.link} onClick={copy}>
            {copied ? 'Link copied' : 'Copy the link'}
          </button>{' '}
          to open it somewhere else.
        </p>
        <DialogActions>
          <Button onClick={() => api.cancelSyncSignIn()}>Cancel</Button>
        </DialogActions>
      </>
    );
  }

  if (status.state === 'unavailable') {
    return (
      <>
        <p className={styles.lead}>
          Sync keeps its keys in this computer’s keychain, and the keychain isn’t available right
          now. Your job hunt stays on this computer.
        </p>
        <DialogActions>
          <Button variant="primary" onClick={close}>
            OK
          </Button>
        </DialogActions>
      </>
    );
  }

  return (
    <>
      {status.state === 'signed-out' ? (
        <p className={styles.lead}>
          This computer was signed out of sync, maybe from another device. Your job hunt here is
          safe. Sign in again to carry on syncing.
        </p>
      ) : (
        <ul className={styles.points}>
          <li>
            <Lock size={16} aria-hidden="true" />
            <span>
              <strong>Locked before it leaves.</strong> Your job hunt is locked on this computer
              with a key only your devices hold, before it goes to the cloud.
            </span>
          </li>
          <li>
            <Laptop size={16} aria-hidden="true" />
            <span>
              <strong>The same everywhere.</strong> Your Mac, your Windows PC and your phone show
              the same jobs, files and notes.
            </span>
          </li>
          <li>
            <LogIn size={16} aria-hidden="true" />
            <span>
              <strong>Sign in with GitHub or Google,</strong> in your browser.
            </span>
          </li>
        </ul>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <p className={styles.hint}>
        Signing in means you agree to Factwright’s{' '}
        <a className={styles.link} href={TERMS_URL} target="_blank" rel="noreferrer">
          terms of service
        </a>
        . Its{' '}
        <a className={styles.link} href={PRIVACY_URL} target="_blank" rel="noreferrer">
          privacy policy
        </a>{' '}
        says what sync keeps.
      </p>
      <DialogActions>
        <Button onClick={close}>Not now</Button>
        <Button variant="primary" data-autofocus onClick={signIn}>
          Sign in with your browser
        </Button>
      </DialogActions>
    </>
  );
}
