import { Button, DialogActions, Field, Input } from '@factwright/ui';
import { ArrowUpRight } from 'lucide-react';
import { type FormEvent, useEffect, useRef } from 'react';
import type { ServerHelp } from '../../shared/sync.ts';
import styles from './SyncDialog.module.css';
import { OWN_SERVER_GUIDE } from './servers.ts';

/** What a server of your own's address looks like, as the guide's steps make one. */
const EXAMPLE = 'https://factwright-sync.yourname.workers.dev';

/**
 * The link that helps with a server that won't do, after what's wrong with it: the guide, or the
 * guide's part on keeping a server up to date.
 */
const HELP: Readonly<Record<ServerHelp, { words: string; href: string }>> = {
  'set-up': { words: 'How to set one up', href: OWN_SERVER_GUIDE },
  update: { words: 'How to update', href: `${OWN_SERVER_GUIDE}#updates` },
};

/**
 * Connecting a server of your own: its address, a word on trusting it, and the button that checks
 * it and signs in. What's typed, and what went wrong, are kept by the step around it, so they're
 * still here after a sign-in that didn't finish.
 */
export function ConnectStep({
  address,
  onAddress,
  checking,
  problem,
  onConnect,
  onBack,
}: {
  address: string;
  onAddress: (address: string) => void;
  /** Whether the server is being checked, before the browser opens. */
  checking: boolean;
  problem: { message: string; help?: ServerHelp } | null;
  onConnect: () => void;
  onBack: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  // The address takes focus as this step opens, in the dialog that's already open.
  useEffect(() => {
    field.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConnect();
  };

  return (
    <form onSubmit={submit}>
      <Field label="Your server’s address">
        {(control) => (
          <Input
            {...control}
            ref={field}
            type="text"
            inputMode="url"
            name="sync-server"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={2000}
            placeholder={EXAMPLE}
            value={address}
            onChange={(event) => onAddress(event.target.value)}
          />
        )}
      </Field>
      <p className={styles.hint}>
        Use only a server you run or trust. It holds your locked job hunt, and the phones and
        browsers you link sign in through it.
      </p>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem.message}
          {problem.help && (
            <>
              {' '}
              <a
                className={styles.outLink}
                href={HELP[problem.help].href}
                target="_blank"
                rel="noreferrer"
              >
                {HELP[problem.help].words}
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </>
          )}
        </p>
      )}
      <DialogActions>
        <Button onClick={onBack}>Back</Button>
        <Button type="submit" variant="primary" disabled={checking || !address.trim()}>
          {checking ? 'Checking…' : 'Connect'}
        </Button>
      </DialogActions>
    </form>
  );
}
