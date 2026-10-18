import { Button } from '@factwright/ui';
import { useId, useState } from 'react';
import { forgetKeys } from './keys.ts';
import { OtherAccount, SignedInAs } from './OtherAccount.tsx';
import styles from './page.module.css';
import { leaveFor } from './route.ts';
import { type AppAnswer, PROVIDER_NAMES, type Provider, signIn, signOut } from './server.ts';

type Step =
  | 'asking'
  /** Picking how to sign in with another account. Nothing has changed yet. */
  | 'switching'
  /** On the way back to the app. */
  | 'going'
  | 'sign-in'
  | { problem: string };

/** What the page says, for the app that asks. */
export interface SignInWords {
  title: string;
  /** Who asks, and what for. */
  lead: string;
  /** When to allow it. */
  only: string;
  /** Which account it signs in to, beside the account signed in here. */
  account: string;
  /** Picking another account. */
  switch: string;
  /** On the way back to the app. */
  going: string;
  /** Signed out here since the page opened. */
  again: string;
  /** A page whose address isn't an ask the app made, or one this server can answer. */
  notAsked: string;
}

/** This page, with what the app asked, for signing in to come back to. */
const here = () => location.pathname + location.search;

/**
 * The page an app opens to sign in through the browser, with nothing to compare: it names the
 * account the app signs in to, and lets it in, or doesn't. Either answer goes back to the app
 * through the browser, at its own return address, which only that app gets. Signed in to the
 * wrong account, the person can sign in with another and come back here. `ask` is null when the
 * page's address isn't one the app made, or one this server can answer.
 */
export function ApproveSignIn<Ask>({
  words,
  answer: answerAsk,
  ask,
  account,
  email,
  providers = [],
  signInProblem = null,
}: {
  words: SignInWords;
  /** Answers what the app asked, for the account the page names. */
  answer: (ask: Ask, allow: boolean, account: string) => Promise<AppAnswer>;
  ask: Ask | null;
  /**
   * The account signed in here, by its ID and email, which the app signs in to once it's allowed,
   * and no other.
   */
  account: string;
  email: string;
  providers?: Provider[];
  /** Why signing in again here didn't work, just now, to say until the person answers. */
  signInProblem?: string | null;
}) {
  const [step, setStep] = useState<Step>(ask ? 'asking' : { problem: words.notAsked });
  const [busy, setBusy] = useState(false);
  const [signInSaid, setSignInSaid] = useState(signInProblem);
  const titleId = useId();

  const answer = async (allow: boolean) => {
    if (!ask) return;
    setBusy(true);
    setSignInSaid(null);
    const result = await answerAsk(ask, allow, account);
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
    <section className={styles.card} aria-labelledby={titleId}>
      <h1 id={titleId} className={styles.title}>
        {words.title}
      </h1>
      {step === 'asking' && (
        <>
          <p className={styles.lead}>{words.lead}</p>
          <p className={styles.hint}>{words.only}</p>
          <SignedInAs
            email={email}
            about={words.account}
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
            lead={words.switch}
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
          {words.going}
        </p>
      )}
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
