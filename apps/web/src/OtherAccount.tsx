import { Button } from '@factwright/ui';
import styles from './page.module.css';
import { PROVIDER_NAMES, type Provider } from './server.ts';

/**
 * Who's signed in here, which a device signs in to once it's let in, and what that means for it.
 * Where there's a way to sign in, there's a way to use another account (OtherAccount).
 */
export function SignedInAs({
  email,
  about,
  providers,
  busy,
  onSwitch,
}: {
  email: string;
  about: string;
  providers: Provider[];
  busy: boolean;
  onSwitch: () => void;
}) {
  return (
    <p className={styles.account}>
      Signed in as <strong>{email}</strong>. {about}
      {providers.length > 0 && (
        <>
          {' '}
          <button type="button" className={styles.linkButton} disabled={busy} onClick={onSwitch}>
            Use another account
          </button>
        </>
      )}
    </p>
  );
}

/**
 * Picking another account to sign in with here, then coming back to the same page. Nothing changes
 * until one's picked, and Back leaves it all as it was.
 */
export function OtherAccount({
  lead,
  email,
  providers,
  busy,
  onBack,
  onPick,
}: {
  lead: string;
  email: string;
  providers: Provider[];
  busy: boolean;
  onBack: () => void;
  onPick: (provider: Provider) => void;
}) {
  return (
    <>
      <p className={styles.lead}>{lead}</p>
      <p className={styles.hint}>
        This signs {email} out of this browser. To use another{' '}
        {providers.map((provider) => PROVIDER_NAMES[provider]).join(' or ')} account, switch to it
        there first.
      </p>
      <div className={styles.actions}>
        <Button variant="quiet" disabled={busy} onClick={onBack}>
          Back
        </Button>
        {providers.map((provider) => (
          <Button
            key={provider}
            variant={provider === providers[0] ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => onPick(provider)}
          >
            Sign in with {PROVIDER_NAMES[provider]}
          </Button>
        ))}
      </div>
    </>
  );
}
