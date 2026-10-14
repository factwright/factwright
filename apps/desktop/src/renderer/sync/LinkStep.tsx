import { Button, DialogActions, Field, Input } from '@factwright/ui';
import { type FormEvent, useState } from 'react';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import type { SetUpAgain } from '../../shared/sync.ts';
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

/** A field for a 32-character code, and the button that uses it. */
function CodeForm({
  label,
  button,
  submit,
  autoFocus = false,
}: {
  label: string;
  button: string;
  submit: (text: string) => Promise<EditResult>;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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
          <Input
            {...control}
            {...(autoFocus && { 'data-autofocus': true })}
            className={styles.codeInput}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={60}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
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

/**
 * On any device after the first: links it with a code from a device that's set up, or, with
 * every other device lost, with the recovery key.
 */
export function LinkStep({ api, again }: { api: FactwrightApi; again?: SetUpAgain | undefined }) {
  return (
    <>
      <p className={styles.lead}>
        {lead(again)}
        <strong>Link a phone or computer</strong>, and type the code it shows.
      </p>
      <CodeForm
        label="Code from your other device"
        button="Link this computer"
        submit={(code) => api.linkWithCode(code)}
        autoFocus
      />
      <details className={styles.other}>
        <summary>Lost your other devices? Use your recovery key</summary>
        <CodeForm
          label="Recovery key"
          button="Unlock with recovery key"
          submit={(key) => api.useRecoveryKey(key)}
        />
      </details>
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
    </>
  );
}
