import { SYNC_PRICE_WORDS } from '@factwright/core';
import type { SyncAccess } from '@factwright/sync';
import { Button, Notice } from '@factwright/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import page from './page.module.css';
import { navigate } from './route.ts';
import { client, payingProblem } from './server.ts';

/** A day such as "November 17", with its year when that isn't this year. */
export function dayOf(iso: string, now: Date = new Date()): string {
  const day = new Date(iso);
  return day.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    ...(day.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

/** Sends the browser to another site's page, such as Stripe's checkout. Tests watch it here. */
export const browser = { go: (url: string) => location.assign(url) };

/** Whether the server said this browser isn't signed in any more. */
export const signedOut = (error: unknown) =>
  error instanceof Error && 'kind' in error && error.kind === 'signed-out';

/**
 * Goes to a page of Stripe's: its checkout, or its portal for managing a subscription. Until the
 * browser leaves, the button that started it says so, and coming back with the Back button, from
 * the page the browser kept, lets it start again.
 */
export function useStripePage(onSignedOut: () => void) {
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const handler = useRef(onSignedOut);
  handler.current = onSignedOut;

  useEffect(() => {
    const back = (event: PageTransitionEvent) => {
      if (event.persisted) setOpening(false);
    };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  /** Opens the page the server gives, or says why it couldn't. Resolves with the error, if any. */
  const open = async (
    which: 'checkout' | 'portal',
    address: () => Promise<string>,
  ): Promise<unknown> => {
    setOpening(true);
    setProblem(null);
    try {
      browser.go(await address());
      return null;
    } catch (error) {
      setOpening(false);
      if (signedOut(error)) handler.current();
      else setProblem(payingProblem(error, which));
      return error;
    }
  };

  return { opening, problem, setProblem, open };
}

/**
 * How the account has sync, on a server that sells it, for the account page: free, with the
 * reason; subscribed, with when it renews or ends, or that a payment failed; or not, with a way to
 * subscribe. Stripe's portal manages a subscription: its card, its plan, canceling and receipts.
 */
export function SubscriptionSection({
  access,
  onSignedOut,
}: {
  access: SyncAccess;
  onSignedOut: () => void;
}) {
  const stripe = useStripePage(onSignedOut);
  const { gift, subscription } = access;
  // A subscription that still runs: renewing, canceled but paid up, or retrying a payment.
  const live = subscription && subscription.state !== 'ended' ? subscription : null;
  const when = live?.renewsAt ? dayOf(live.renewsAt) : null;
  const manage = (
    label = 'Manage subscription',
    variant: 'primary' | 'secondary' = 'secondary',
  ) => (
    <Button
      variant={variant}
      disabled={stripe.opening}
      onClick={() => void stripe.open('portal', () => client.portal())}
    >
      {stripe.opening ? 'Opening…' : label}
    </Button>
  );

  let body: ReactNode;
  if (gift) {
    body = (
      <>
        <p className={page.lead}>
          {gift === 'early'
            ? 'Free sync, for good. Thanks for being one of the first.'
            : 'Free sync, from Steve. Good luck with the search!'}
        </p>
        {live && (
          <>
            <p className={page.hint}>
              {live.state === 'ending'
                ? when
                  ? `Your subscription ends ${when}, and won’t renew.`
                  : 'Your subscription ends with the time paid for, and won’t renew.'
                : `You also have a subscription, which renews${when ? ` ${when}` : ''}. Sync is free for you, so you can cancel it.`}
            </p>
            <div className={page.actions}>{manage()}</div>
          </>
        )}
      </>
    );
  } else if (live?.state === 'retrying') {
    body = (
      <>
        <p className={page.lead}>Your card didn’t go through. Update it to keep sync going.</p>
        <p className={page.hint}>
          Stripe tries it again for up to two weeks, and sync keeps going meanwhile.
        </p>
        <div className={page.actions}>{manage('Update your card', 'primary')}</div>
      </>
    );
  } else if (live?.state === 'ending') {
    body = (
      <>
        <p className={page.lead}>
          {when
            ? `Canceled. Sync keeps going until ${when}, then pauses.`
            : 'Canceled. Sync keeps going to the end of the time paid for, then pauses.'}
        </p>
        <p className={page.hint}>Changed your mind? Renew it from Manage subscription.</p>
        <div className={page.actions}>{manage()}</div>
      </>
    );
  } else if (live) {
    body = (
      <>
        <p className={page.lead}>{when ? `Subscribed. Renews ${when}.` : 'Subscribed.'}</p>
        <p className={page.hint}>
          Cancel anytime, and sync keeps going to the end of what you paid for.
        </p>
        <div className={page.actions}>{manage()}</div>
      </>
    );
  } else if (subscription) {
    body = (
      <>
        <p className={page.lead}>
          Your subscription ended, so sync is paused. The job hunt on your computers is safe.
        </p>
        <div className={page.actions}>
          <Button variant="primary" onClick={() => navigate('/subscribe')}>
            Subscribe again
          </Button>
          {manage('Past payments')}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className={page.lead}>No subscription yet.</p>
        <p className={page.hint}>Sync on Factwright’s server is {SYNC_PRICE_WORDS}.</p>
        <div className={page.actions}>
          <Button variant="primary" onClick={() => navigate('/subscribe')}>
            Subscribe
          </Button>
        </div>
      </>
    );
  }

  return (
    <section className={page.section} aria-labelledby="subscription">
      <h2 id="subscription" className={page.heading}>
        Your subscription
      </h2>
      {body}
      {stripe.problem && (
        <p className={page.problem} role="alert">
          {stripe.problem}
        </p>
      )}
    </section>
  );
}

/**
 * A note at the top of the jobs page, on a server that sells sync, when the account needs to act:
 * sync is paused, so what's here is from when it last changed, or a payment didn't go through.
 */
export function SyncNote({
  access,
  updatedAt,
  onSignedOut,
}: {
  access: SyncAccess | null;
  /** When the job hunt here last changed, as an ISO time. */
  updatedAt: string | null;
  onSignedOut: () => void;
}) {
  const stripe = useStripePage(onSignedOut);
  if (!access) return null;
  if (!access.allowed) {
    // Once a subscription ended, or without one, as when free sync ended.
    const subscribe = access.subscription ? 'Subscribe again' : 'Subscribe';
    return (
      <div className={page.note}>
        <Notice title="Sync is paused">
          <p className={page.noteText}>
            {updatedAt
              ? `What’s here is from ${dayOf(updatedAt)}. ${subscribe}, and it catches up.`
              : `${subscribe}, and your job hunt syncs here.`}
          </p>
          <div className={page.noteActions}>
            <Button size="sm" variant="primary" onClick={() => navigate('/subscribe')}>
              {subscribe}
            </Button>
          </div>
        </Notice>
      </div>
    );
  }
  if (access.subscription?.state === 'retrying' && !access.gift) {
    return (
      <div className={page.note}>
        <Notice title="Your card didn’t go through">
          <p className={page.noteText}>Update it to keep sync going.</p>
          <div className={page.noteActions}>
            <Button
              size="sm"
              variant="primary"
              disabled={stripe.opening}
              onClick={() => void stripe.open('portal', () => client.portal())}
            >
              {stripe.opening ? 'Opening…' : 'Update your card'}
            </Button>
          </div>
          {stripe.problem && (
            <p className={page.problem} role="alert">
              {stripe.problem}
            </p>
          )}
        </Notice>
      </div>
    );
  }
  return null;
}
