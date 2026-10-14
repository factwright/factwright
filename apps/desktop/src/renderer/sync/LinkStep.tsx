import { Button, DialogActions, Field, Input } from '@factwright/ui';
import { Eye, EyeOff } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import type { AskingView, SetUpAgain } from '../../shared/sync.ts';
import { AskPanel } from './Approve.tsx';
import styles from './SyncDialog.module.css';

const TYPED = 'Dashes and spaces don’t matter, and neither do capitals.';

/** Why this computer links, up to where it says what to do on the other device. */
function lead(again: SetUpAgain | undefined): string {
  if (again === 'changed') {
    return 'Another device set up a new key for your account, so syncing stopped here. On that device, open Sync, choose ';
  }
  if (again === 'taken') {
    return 'Another device turned on sync for your account first, so the recovery key shown here won’t open it: keep that device’s recovery key instead. There, open Sync, choose ';
  }
  return 'Sync is already on for your account on another device. There, open Sync, choose ';
}

/** Why this computer links, when a device that's set up can approve it. */
function approveLead(again: SetUpAgain | undefined): string {
  if (again === 'changed') {
    return 'Another device set up a new key for your account, so syncing stopped here. Approve this computer from that device.';
  }
  if (again === 'taken') {
    return 'Another device turned on sync for your account first, so the recovery key shown here won’t open it: keep that device’s recovery key instead. Approve this computer from that device.';
  }
  return 'Sync is already on for your account on another device. Approve this computer from there.';
}

/**
 * A field for a 32-character code, and the button that uses it. A secret one, such as the
 * recovery key, is a password field a password manager can fill, with a button to show it.
 */
function CodeForm({
  label,
  button,
  submit,
  autoFocus = false,
  secret = false,
}: {
  label: string;
  button: string;
  submit: (text: string) => Promise<EditResult>;
  autoFocus?: boolean;
  secret?: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const result = await submit(text);
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  };

  return (
    <form className={styles.codeForm} onSubmit={send}>
      <Field label={label} hint={TYPED}>
        {(control) => (
          <div className={styles.codeRow}>
            <Input
              {...control}
              {...(autoFocus && { 'data-autofocus': true })}
              className={styles.codeInput}
              type={secret && !shown ? 'password' : 'text'}
              name={secret ? 'recovery-key' : 'link-code'}
              autoComplete={secret ? 'current-password' : 'off'}
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={100}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            {secret && (
              <Button
                variant="quiet"
                size="sm"
                icon={
                  shown ? (
                    <EyeOff size={14} aria-hidden="true" />
                  ) : (
                    <Eye size={14} aria-hidden="true" />
                  )
                }
                aria-pressed={shown}
                onClick={() => setShown((now) => !now)}
              >
                {shown ? 'Hide' : 'Show'}
              </Button>
            )}
          </div>
        )}
      </Field>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <DialogActions>
        <Button type="submit" variant="primary" disabled={busy || text.trim().length < 32}>
          {busy ? 'Checking…' : button}
        </Button>
      </DialogActions>
    </form>
  );
}

function RecoveryKey({ api }: { api: FactwrightApi }) {
  return (
    <details className={styles.other}>
      <summary>Lost your other devices? Use your recovery key</summary>
      <CodeForm
        label="Recovery key"
        button="Unlock with recovery key"
        submit={(key) => api.useRecoveryKey(key)}
        secret
      />
    </details>
  );
}

function DifferentAccountHint({ api }: { api: FactwrightApi }) {
  return (
    <p className={styles.hint}>
      Linking adds this computer’s job hunt to the account. Not the account you meant?{' '}
      <button
        type="button"
        className={styles.link}
        onClick={() => void api.useDifferentSyncAccount()}
      >
        Use a different account
      </button>
    </p>
  );
}

/**
 * On any device after the first: links it from a device that's set up, which approves it once
 * the person checks both screens show the same emoji. A code from that device, or with every
 * other device lost, the recovery key, work too. A sync server that can't approve devices yet
 * gets the code alone.
 */
export function LinkStep({
  api,
  again,
  canApprove,
  asking,
}: {
  api: FactwrightApi;
  again?: SetUpAgain | undefined;
  /** Whether the sync server can approve devices. */
  canApprove: boolean;
  asking: AskingView | null;
}) {
  // Asks as soon as the step shows, so the other device is ready by the time the person gets
  // there. Closing the dialog leaves it asking: the person may be off to the other computer.
  useEffect(() => {
    if (canApprove) void api.askToLink();
  }, [api, canApprove]);

  if (!canApprove || asking?.step === 'stale') {
    return (
      <>
        <p className={styles.lead}>
          {lead(again)}
          <strong>Link a phone or computer</strong>, and type the code it shows.
        </p>
        {asking?.step === 'stale' && (
          <p className={styles.hint}>
            This computer signed in a while ago, so it can’t ask another to approve it.{' '}
            <button
              type="button"
              className={styles.link}
              onClick={() => void api.useDifferentSyncAccount()}
            >
              Sign in again
            </button>{' '}
            to ask.
          </p>
        )}
        <CodeForm
          label="Code from your other device"
          button="Link this computer"
          submit={(code) => api.linkWithCode(code)}
          autoFocus
        />
        <RecoveryKey api={api} />
        <DifferentAccountHint api={api} />
      </>
    );
  }

  return (
    <>
      <p className={styles.lead}>{approveLead(again)}</p>
      <AskPanel api={api} asking={asking} />
      <details className={styles.other}>
        <summary>Or type a code from your other device</summary>
        <p className={styles.hint}>
          There, open Sync and choose <strong>Link a phone or computer</strong>.
        </p>
        <CodeForm
          label="Code from your other device"
          button="Link this computer"
          submit={(code) => api.linkWithCode(code)}
        />
      </details>
      <RecoveryKey api={api} />
      <DifferentAccountHint api={api} />
    </>
  );
}
