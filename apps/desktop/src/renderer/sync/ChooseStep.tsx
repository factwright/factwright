import { FREE_SYNC_EMAIL, SYNC_PRICE_WORDS } from '@factwright/core';
import { Button } from '@factwright/ui';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ServerTerms } from '../../shared/sync.ts';
import styles from './SyncDialog.module.css';
import { OWN_SERVER_GUIDE } from './servers.ts';

/** Where sync is sold: that someone who can't pay can ask for it for free, no questions asked. */
export function MoneyTight() {
  return (
    <p className={styles.hint}>
      Money’s tight? Email{' '}
      <a
        className={styles.link}
        href={`mailto:${FREE_SYNC_EMAIL}`}
        target="_blank"
        rel="noreferrer"
      >
        {FREE_SYNC_EMAIL}
      </a>{' '}
      and I’ll turn on sync for free. No questions asked.
    </p>
  );
}

/**
 * The first screen of turning sync on: Factwright's own sync and a server of your own, side by
 * side. A copy without Factwright's sync offers only a server of your own. The price, and the way
 * to ask for sync for free, show only once Factwright's server says sync there is a subscription.
 */
export function ChooseStep({
  factwright,
  terms,
  onSignIn,
  onConnect,
  focusConnect,
}: {
  /** Whether this copy has Factwright's own sync. */
  factwright: boolean;
  /** Factwright's own server's terms and price, once they're known. */
  terms: ServerTerms | null;
  onSignIn: () => void;
  onConnect: () => void;
  /** Whether "Connect your server…" takes focus, as when coming back from connecting one. */
  focusConnect: boolean;
}) {
  const connect = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusConnect) connect.current?.focus();
  }, [focusConnect]);
  const priced = factwright && terms?.subscription === true;
  return (
    <>
      <p className={styles.lead}>Locked before it leaves. The same everywhere.</p>
      <div className={styles.choices}>
        {factwright && (
          <section className={styles.choice} aria-labelledby="sync-factwright">
            <div className={styles.choiceAbout}>
              <h3 id="sync-factwright" className={styles.choiceTitle}>
                Factwright’s sync
              </h3>
              <p className={styles.choiceLine}>{priced ? SYNC_PRICE_WORDS : 'Nothing to set up'}</p>
              <p className={styles.choiceText}>
                {priced
                  ? 'Nothing to set up. Cancel anytime.'
                  : 'Sign in with GitHub or Google, and you’re syncing.'}
              </p>
            </div>
            <div className={styles.choiceActions}>
              <Button variant="primary" data-autofocus onClick={onSignIn}>
                Sign in with your browser
              </Button>
              {priced && <p className={styles.choiceText}>Already subscribed? Same button.</p>}
            </div>
          </section>
        )}
        <section className={styles.choice} aria-labelledby="sync-own">
          <div className={styles.choiceAbout}>
            <h3 id="sync-own" className={styles.choiceTitle}>
              Your own server
            </h3>
            <p className={styles.choiceLine}>Free</p>
            <p className={styles.choiceText}>
              Run sync in your own free Cloudflare account. About 15 minutes.
            </p>
            <a className={styles.outLink} href={OWN_SERVER_GUIDE} target="_blank" rel="noreferrer">
              How to set one up
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </div>
          <div className={styles.choiceActions}>
            <Button
              ref={connect}
              variant={factwright ? 'secondary' : 'primary'}
              {...(!factwright && { 'data-autofocus': true })}
              onClick={onConnect}
            >
              Connect your server…
            </Button>
          </div>
        </section>
      </div>
      {priced && <MoneyTight />}
    </>
  );
}
