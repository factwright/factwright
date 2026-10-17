import { FREE_SYNC_EMAIL, OWN_SERVER_GUIDE, SYNC_PRICE } from '@factwright/core';
import { type AccountInfo, type Period, SyncError } from '@factwright/sync';
import { Button } from '@factwright/ui';
import { ArrowUpRight, CircleCheck } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { forgetKeys } from './keys.ts';
import page from './page.module.css';
import { navigate } from './route.ts';
import styles from './Subscribe.module.css';
import { signedOut, useStripePage } from './Subscription.tsx';
import { client, signOut } from './server.ts';

/** The account, as the page last asked about it. */
type Asked =
  | { state: 'loading' }
  | { state: 'failed'; offline: boolean }
  | { state: 'loaded'; info: AccountInfo };

/** How often /subscribe/done asks whether the subscription has come through, and for how long. */
const CHECK_MS = 2000;
const CHECK_FOR_MS = 60_000;

/** For tests: how the page waits between looks at the account. */
export const timing = { wait: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)) };

/** Says to go back to Factwright, which carries on by itself once the account has sync. */
function SyncReady({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={page.card} aria-labelledby="subscribe-title">
      <h1 id="subscribe-title" className={`${page.title} ${styles.ready}`}>
        <CircleCheck size={22} aria-hidden="true" />
        {title}
      </h1>
      {children}
      <p className={page.hint}>
        Your account page shows your subscription, and manages it.{' '}
        <a
          href="/account"
          onClick={(event) => {
            event.preventDefault();
            navigate('/account');
          }}
        >
          Your account
        </a>
      </p>
    </section>
  );
}

/** What the account has in place of a subscription, when it has sync already. */
function HasSync({ info }: { info: AccountInfo }) {
  const gift = info.access?.gift;
  if (!info.access) {
    return (
      <section className={page.card} aria-labelledby="subscribe-title">
        <h1 id="subscribe-title" className={page.title}>
          Sync is free here
        </h1>
        <p className={page.lead}>
          This server doesn’t charge for sync, so there’s nothing to pay. Go back to Factwright: it
          carries on by itself.
        </p>
      </section>
    );
  }
  return (
    <SyncReady title={gift ? 'You have free sync' : 'You’re subscribed'}>
      <p className={page.lead}>
        {gift === 'early'
          ? 'Your account has sync for good, as one of the first. '
          : gift === 'free'
            ? 'Steve turned on sync for you, for free. '
            : ''}
        Go back to Factwright: it carries on by itself.
      </p>
    </SyncReady>
  );
}

/**
 * The page the app opens to subscribe to sync, on a server that sells it: monthly or yearly, then
 * Stripe's checkout, which comes back to /subscribe/done, or here if the person leaves it. An
 * account with sync already, or a server that doesn't sell it, has nothing to pay. When the app
 * names the account it's signed in with, and this browser is signed in with another, it says so
 * before anyone pays for the wrong one.
 */
export function Subscribe({
  account,
  email,
  onSignedOut,
}: {
  /** The account this browser is signed in with, by its ID. */
  account: string;
  email: string;
  onSignedOut: () => void;
}) {
  const [asked, setAsked] = useState<Asked>({ state: 'loading' });
  const [period, setPeriod] = useState<Period>('month');
  const stripe = useStripePage(onSignedOut);
  // The account Factwright on the person's computer is signed in with, which it names here.
  const [appAccount] = useState(() => new URLSearchParams(location.search).get('account'));

  const load = useCallback(async () => {
    setAsked({ state: 'loading' });
    try {
      setAsked({ state: 'loaded', info: await client.account() });
    } catch (error) {
      if (signedOut(error)) onSignedOut();
      else {
        setAsked({
          state: 'failed',
          offline: error instanceof SyncError && error.kind === 'offline',
        });
      }
    }
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  if (appAccount && appAccount !== account) {
    const leave = async () => {
      await forgetKeys().catch(() => {});
      await signOut().catch(() => {});
      location.assign(location.pathname + location.search);
    };
    return (
      <section className={page.card} aria-labelledby="subscribe-title">
        <h1 id="subscribe-title" className={page.title}>
          This browser uses another account
        </h1>
        <p className={page.lead}>
          It’s signed in as {email}, and Factwright on your computer is signed in with a different
          account. Subscribe with the account Factwright uses, so sync turns on there.
        </p>
        <p className={page.hint}>
          Signing out forgets this browser’s keys. Your job hunt stays on your computers.
        </p>
        <div className={page.actions}>
          <Button variant="primary" onClick={() => void leave()}>
            Sign out, then sign in again
          </Button>
        </div>
      </section>
    );
  }

  if (asked.state === 'loading') return <p className={page.hint}>Checking your account…</p>;

  if (asked.state === 'failed') {
    return (
      <section className={page.card} aria-labelledby="subscribe-title">
        <h1 id="subscribe-title" className={page.title}>
          Your account couldn’t be checked
        </h1>
        <p className={page.lead}>
          {asked.offline
            ? 'Can’t reach Factwright right now. Check your connection, then try again.'
            : 'Something went wrong on Factwright’s side. Try again in a moment.'}
        </p>
        <div className={page.actions}>
          <Button variant="primary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </section>
    );
  }

  const { info } = asked;
  if (!info.access || info.access.allowed) return <HasSync info={info} />;

  const again = info.access.subscription !== null;
  const pay = async () => {
    const error = await stripe.open('checkout', () => client.checkout(period));
    // Sync came through since the page asked, or the server stopped selling it: it says so.
    if (error instanceof SyncError && (error.kind === 'conflict' || error.kind === 'not-found')) {
      stripe.setProblem(null);
      await load();
    }
  };

  return (
    <section className={page.card} aria-labelledby="subscribe-title">
      <h1 id="subscribe-title" className={page.title}>
        {again ? 'Subscribe to sync again' : 'Subscribe to sync'}
      </h1>
      <p className={page.lead}>
        {again
          ? 'Your subscription ended, so sync is paused. Subscribe again, and it picks up where it left off.'
          : 'Sync keeps your job hunt the same on your computers and your phone, locked before it leaves.'}
      </p>
      <p className={page.hint}>Signed in as {email}.</p>
      <fieldset className={styles.plans}>
        <legend className={styles.legend}>How often to pay</legend>
        <label className={styles.plan}>
          <input
            type="radio"
            name="period"
            value="month"
            checked={period === 'month'}
            onChange={() => setPeriod('month')}
          />
          <span className={styles.price}>${SYNC_PRICE.month} a month</span>
        </label>
        <label className={styles.plan}>
          <input
            type="radio"
            name="period"
            value="year"
            checked={period === 'year'}
            onChange={() => setPeriod('year')}
          />
          <span className={styles.price}>${SYNC_PRICE.year} a year</span>
          <span className={styles.saving}>
            Saves ${SYNC_PRICE.month * 12 - SYNC_PRICE.year} a year
          </span>
        </label>
      </fieldset>
      <p className={page.hint}>
        Cancel anytime, and sync keeps going to the end of what you paid for. Stripe takes the
        payment, and adds tax where it applies.
      </p>
      <div className={page.actions}>
        <Button variant="primary" disabled={stripe.opening} onClick={() => void pay()}>
          {stripe.opening ? 'Opening checkout…' : 'Continue to payment'}
        </Button>
      </div>
      {stripe.problem && (
        <p className={page.problem} role="alert">
          {stripe.problem}
        </p>
      )}
      <p className={page.hint}>
        Money’s tight? Email <a href={`mailto:${FREE_SYNC_EMAIL}`}>{FREE_SYNC_EMAIL}</a> and I’ll
        turn on sync for free. No questions asked.
      </p>
      <p className={page.hint}>
        Rather run your own server? It’s free.{' '}
        <a className={styles.out} href={OWN_SERVER_GUIDE} target="_blank" rel="noreferrer">
          How to set one up
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </p>
    </section>
  );
}

/**
 * Where Stripe's checkout comes back to once it's paid: it checks the subscription came through,
 * as Stripe tells the server a moment later, then says to go back to Factwright, which carries on
 * by itself. If Stripe takes longer, it says so, with a way to check again.
 */
export function Subscribed({ onSignedOut }: { onSignedOut: () => void }) {
  const [step, setStep] = useState<'checking' | 'late' | AccountInfo>('checking');
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    setStep('checking');
    void (async () => {
      const started = Date.now();
      for (;;) {
        try {
          const info = await client.account();
          if (!live) return;
          if (!info.access || info.access.allowed) {
            setStep(info);
            return;
          }
        } catch (error) {
          if (!live) return;
          if (signedOut(error)) {
            onSignedOut();
            return;
          }
        }
        if (Date.now() - started >= CHECK_FOR_MS) {
          setStep('late');
          return;
        }
        await timing.wait(CHECK_MS);
        if (!live) return;
      }
    })();
    return () => {
      live = false;
    };
  }, [round, onSignedOut]);

  if (step === 'checking') {
    return (
      <section className={page.card} aria-labelledby="subscribe-title">
        <h1 id="subscribe-title" className={page.title}>
          Finishing up…
        </h1>
        <p className={page.waiting} aria-live="polite">
          <span className={page.dot} aria-hidden="true" />
          Checking your subscription came through.
        </p>
      </section>
    );
  }

  if (step === 'late') {
    return (
      <section className={page.card} aria-labelledby="subscribe-title">
        <h1 id="subscribe-title" className={page.title}>
          Almost there
        </h1>
        <p className={page.lead}>
          Stripe hasn’t told Factwright about your payment yet. It can take a few minutes. Once it
          has, Factwright on your computer carries on by itself.
        </p>
        <div className={page.actions}>
          <Button variant="primary" onClick={() => setRound((now) => now + 1)}>
            Check again
          </Button>
        </div>
      </section>
    );
  }

  if (!step.access || step.access.gift) return <HasSync info={step} />;

  return (
    <SyncReady title="You’re subscribed">
      <p className={page.lead}>Go back to Factwright: it’s finishing setting up sync.</p>
    </SyncReady>
  );
}
