import type { Legal } from '@factwright/sync';
import { Button } from '@factwright/ui';
import { useState } from 'react';
import styles from './page.module.css';
import { PROVIDER_NAMES, type Provider, signIn } from './server.ts';

/** Signing in, with GitHub or Google, then back to where the person was going. */
export function SignIn({
  providers,
  legal,
  title = 'Your job hunt, anywhere',
  lead = 'Sign in to see the job hunt Factwright syncs from your computer. It opens here, in this browser, and stays locked everywhere else.',
  returnTo,
  signInProblem = null,
}: {
  providers: Provider[];
  /** The terms and privacy policy signing in agrees to, when the server has them. */
  legal: Legal | null;
  title?: string;
  lead?: string;
  returnTo: string;
  /** Why signing in from here didn't work, just now, to say until the person tries again. */
  signInProblem?: string | null;
}) {
  const [going, setGoing] = useState<Provider | null>(null);
  const [problem, setProblem] = useState(signInProblem);
  const start = async (provider: Provider) => {
    setGoing(provider);
    setProblem(null);
    const failed = await signIn(provider, returnTo);
    if (failed) {
      setProblem(failed);
      setGoing(null);
    }
  };
  return (
    <section className={styles.card} aria-labelledby="sign-in-title">
      <h1 id="sign-in-title" className={styles.title}>
        {title}
      </h1>
      <p className={styles.lead}>{lead}</p>
      {providers.length === 0 ? (
        <p className={styles.problem} role="alert">
          Signing in isn’t set up on this server yet.
        </p>
      ) : (
        <div className={styles.actions}>
          {providers.map((provider) => (
            <Button
              key={provider}
              variant={provider === providers[0] ? 'primary' : 'secondary'}
              disabled={going !== null}
              onClick={() => void start(provider)}
            >
              {going === provider ? 'Opening…' : `Continue with ${PROVIDER_NAMES[provider]}`}
            </Button>
          ))}
        </div>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <p className={styles.hint}>
        Signing in proves who you are. Your job hunt stays locked with a key only your devices hold.
      </p>
      {legal && (
        <p className={styles.hint}>
          By continuing, you agree to Factwright’s{' '}
          <a href={legal.terms} target="_blank" rel="noreferrer">
            terms of service
          </a>
          . Its{' '}
          <a href={legal.privacy} target="_blank" rel="noreferrer">
            privacy policy
          </a>{' '}
          says what sync keeps.
        </p>
      )}
    </section>
  );
}
