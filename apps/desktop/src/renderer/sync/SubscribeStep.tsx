import { SYNC_PRICE_WORDS } from '@factwright/core';
import { Button, DialogActions } from '@factwright/ui';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { SyncStatus } from '../../shared/sync.ts';
import { MoneyTight } from './ChooseStep.tsx';
import { DifferentAccount } from './RecoveryKeyStep.tsx';
import styles from './SyncDialog.module.css';
import { hostOf, OWN_SERVER_GUIDE } from './servers.ts';

/** The steps that wait for the account to have sync. */
type Waiting = Extract<SyncStatus, { state: 'subscribe' | 'paused' }>;

/** What a step says when another sign-in, or closing the app, overtook it. */
const CANCELED = 'Signing in was canceled.';

/** Why the account subscribes, and what it costs on Factwright's own server. */
function lead(status: Waiting, own: string | null): string {
  const price = own ? '' : ` It’s ${SYNC_PRICE_WORDS}.`;
  if (status.state === 'paused') {
    return 'Your subscription ended, so this computer stopped syncing. Your job hunt here is safe, and what you change stays here. Subscribe again, and sync picks up where it left off.';
  }
  if (status.again) {
    return `Your subscription ended, so sync is paused for your account. Subscribe again to sync this computer.${price}`;
  }
  return own
    ? `Sync on ${hostOf(own)} needs a subscription.`
    : `Sync on Factwright’s server is ${SYNC_PRICE_WORDS}. You can cancel anytime, and sync keeps going to the end of what you paid for.`;
}

/**
 * Where sync is sold, for an account without it: subscribing in the browser, before this computer
 * sets up, or once sync paused here because the subscription ended. While the browser's open the
 * app asks every few seconds, and carries on by itself once the account has sync. Running a server
 * of your own instead, and asking for sync for free, are a click away.
 */
export function SubscribeStep({
  api,
  status,
  onConnecting,
  close,
}: {
  api: FactwrightApi;
  status: Waiting;
  /** Leaves Factwright's sync for connecting a server of your own, from the first screen's step. */
  onConnecting: (connecting: boolean) => void;
  close: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const own = status.ownServer ?? null;
  const paused = status.state === 'paused';
  const again = paused || status.again;

  // Asks how the account stands as the step opens, so one that has sync by now, such as after
  // subscribing from the phone, carries on without the browser.
  useEffect(() => {
    void api.syncAccount();
  }, [api]);

  const subscribe = async () => {
    setProblem(null);
    setOpening(true);
    const result = await api.subscribeToSync();
    setOpening(false);
    if (!result.ok && result.message !== CANCELED) setProblem(result.message);
  };

  const connectOwn = async () => {
    const result = await api.useDifferentSyncAccount();
    if (result.ok) onConnecting(true);
    else setProblem(result.message);
  };

  const turnOff = async () => {
    const result = await api.signOutOfSync();
    if (!result.ok) setProblem(result.message);
  };

  return (
    <>
      <p className={styles.lead}>{lead(status, own)}</p>
      {status.waiting ? (
        <p className={styles.waiting} aria-live="polite">
          <span className={`${styles.dot} ${styles.dotSyncing}`} aria-hidden="true" />
          <span>
            Waiting for your browser… Once you’ve subscribed, this carries on by itself.{' '}
            <button type="button" className={styles.link} onClick={subscribe}>
              Open the page again
            </button>
          </span>
        </p>
      ) : (
        <div className={styles.subscribe}>
          <Button variant="primary" data-autofocus disabled={opening} onClick={subscribe}>
            {again ? 'Subscribe again in your browser' : 'Subscribe in your browser'}
          </Button>
        </div>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      {!own && (
        <>
          <p className={styles.hint}>
            Rather run your own server? It’s free.{' '}
            <a className={styles.outLink} href={OWN_SERVER_GUIDE} target="_blank" rel="noreferrer">
              How to set one up
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            {!paused && (
              <>
                {' '}
                <button type="button" className={styles.link} onClick={connectOwn}>
                  Connect your server…
                </button>
              </>
            )}
          </p>
          <MoneyTight />
        </>
      )}
      {paused &&
        (confirmOff ? (
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
          <p className={styles.hint}>
            To use another server,{' '}
            <button type="button" className={styles.link} onClick={() => setConfirmOff(true)}>
              turn off sync on this computer
            </button>{' '}
            first.
          </p>
        ))}
      {!confirmOff && (
        <DialogActions>
          {!paused && <DifferentAccount api={api} />}
          <Button onClick={close}>Not now</Button>
        </DialogActions>
      )}
    </>
  );
}
