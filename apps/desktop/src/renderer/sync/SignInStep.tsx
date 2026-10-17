import { Button, DialogActions } from '@factwright/ui';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { ConnectResult, ServerHelp, ServerTerms, SyncStatus } from '../../shared/sync.ts';
import { ChooseStep } from './ChooseStep.tsx';
import { ConnectStep } from './ConnectStep.tsx';
import styles from './SyncDialog.module.css';
import { hostOf, ownServerOf, whose } from './servers.ts';
import { useServerTerms } from './useSync.ts';

/** What a sign-in says when it was called off, which needs no word here. */
const CANCELED = 'Signing in was canceled.';

/**
 * That signing in agrees to the server's terms of service and privacy policy, when it has them.
 * Beside a server of your own, on the first screen, it says it's Factwright's sync it's about.
 */
function SignInTerms({
  terms,
  own,
  choosing = false,
}: {
  terms: ServerTerms | null;
  own: string | null;
  choosing?: boolean;
}) {
  if (!terms?.legal) return null;
  const termsLink = (
    <a className={styles.link} href={terms.legal.terms} target="_blank" rel="noreferrer">
      terms of service
    </a>
  );
  return (
    <p className={styles.hint}>
      {choosing ? (
        <>Signing in to Factwright’s sync means you agree to its {termsLink}</>
      ) : (
        <>
          Signing in means you agree to {whose(own)} {termsLink}
        </>
      )}
      . Its{' '}
      <a className={styles.link} href={terms.legal.privacy} target="_blank" rel="noreferrer">
        privacy policy
      </a>{' '}
      says what sync keeps.
    </p>
  );
}

/**
 * Turning sync on: the choice of Factwright's own sync or a server of your own, connecting one,
 * the code to check in the browser, and signing in again. It stays open as sync moves through
 * signing in, so what went wrong, and an address typed, are still here when it comes back.
 */
export function SignInStep({
  api,
  status,
  connecting,
  onConnecting,
  close,
}: {
  api: FactwrightApi;
  status: SyncStatus;
  /** Whether a server of your own is being connected, from the first screen. */
  connecting: boolean;
  onConnecting: (connecting: boolean) => void;
  close: () => void;
}) {
  const [problem, setProblem] = useState<{ message: string; help?: ServerHelp } | null>(null);
  const [copied, setCopied] = useState(false);
  const [address, setAddress] = useState('');
  const [checking, setChecking] = useState(false);
  // Coming back from connecting a server, focus goes back to the button that opened it.
  const [back, setBack] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const own = ownServerOf(status);
  const terms = useServerTerms(api, own);

  // Once the browser opens, the server's been checked.
  useEffect(() => {
    if (status.state === 'signing-in') setChecking(false);
  }, [status.state]);

  const settle = (result: ConnectResult) => {
    if (result.ok || result.message === CANCELED) return;
    setProblem({ message: result.message, ...(result.help && { help: result.help }) });
  };

  const signIn = async () => {
    setProblem(null);
    setBack(false);
    settle(await api.signInToSync());
  };

  const connect = async () => {
    setProblem(null);
    setChecking(true);
    const result = await api.connectSyncServer(address);
    setChecking(false);
    settle(result);
  };

  const showProblem = problem && (
    <p className={styles.problem} role="alert">
      {problem.message}
    </p>
  );

  if (status.state === 'signing-in') {
    const copy = async () => {
      setCopied((await api.copyText(status.url)).ok);
    };
    return (
      <>
        <p className={styles.lead}>
          Your browser opened {whose(own)} sign-in page.{' '}
          {own ? 'Sign in there' : 'Sign in with GitHub or Google'}, then check the page shows this
          code before you allow it:
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

  if (status.state === 'no-server') {
    return (
      <>
        <p className={styles.lead}>
          This computer syncs through Factwright’s sync, which this copy of Factwright doesn’t have,
          so it leaves sync as it is. Your job hunt stays on this computer.
        </p>
        <DialogActions>
          <Button variant="primary" onClick={close}>
            OK
          </Button>
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

  if (status.state === 'signed-out') {
    const turnOff = async () => {
      const result = await api.signOutOfSync();
      if (!result.ok) setProblem({ message: result.message });
    };
    return (
      <>
        <p className={styles.lead}>
          This computer was signed out of sync{own && ` on ${hostOf(own)}`}, maybe from another
          device. Your job hunt here is safe. Sign in again to carry on syncing.
        </p>
        {showProblem}
        <SignInTerms terms={terms} own={own} />
        {confirmOff ? (
          <div className={styles.confirm}>
            <p>
              Turn off sync on this computer? Your job hunt stays here as it is, and on your other
              devices. To sync again, you choose a server and sign in.
            </p>
            <DialogActions>
              <Button onClick={() => setConfirmOff(false)}>Cancel</Button>
              <Button variant="primary" onClick={turnOff}>
                Turn off here
              </Button>
            </DialogActions>
          </div>
        ) : (
          <>
            <p className={styles.hint}>
              To use another server,{' '}
              <button type="button" className={styles.link} onClick={() => setConfirmOff(true)}>
                turn off sync on this computer
              </button>{' '}
              first.
            </p>
            <DialogActions>
              <Button onClick={close}>Not now</Button>
              <Button variant="primary" data-autofocus onClick={signIn}>
                Sign in with your browser
              </Button>
            </DialogActions>
          </>
        )}
      </>
    );
  }

  if (connecting) {
    return (
      <ConnectStep
        address={address}
        onAddress={setAddress}
        checking={checking}
        problem={problem}
        onConnect={connect}
        onBack={() => {
          // Going back while the server is checked calls it off.
          if (checking) api.cancelSyncSignIn();
          setChecking(false);
          setProblem(null);
          setBack(true);
          onConnecting(false);
        }}
      />
    );
  }

  return (
    <>
      <ChooseStep
        factwright={api.factwrightSync}
        terms={terms}
        onSignIn={signIn}
        onConnect={() => {
          setProblem(null);
          onConnecting(true);
        }}
        focusConnect={back}
      />
      {showProblem}
      {api.factwrightSync && <SignInTerms terms={terms} own={null} choosing />}
      <DialogActions>
        <Button onClick={close}>Not now</Button>
      </DialogActions>
    </>
  );
}
