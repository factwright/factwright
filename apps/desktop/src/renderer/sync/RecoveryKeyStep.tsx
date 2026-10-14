import { Button, Checkbox, DialogActions } from '@factwright/ui';
import { Check, Copy, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { SetUpAgain } from '../../shared/sync.ts';
import { Groups } from './Groups.tsx';
import styles from './SyncDialog.module.css';

/** What a saved recovery key file says, so it still makes sense when found years later. */
function keyFile(recoveryKey: string, email: string): string {
  const made = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return [
    'Factwright recovery key',
    '',
    `Account: ${email}`,
    `Made: ${made}`,
    '',
    recoveryKey,
    '',
    'This key unlocks your synced job hunt on a new device, if you ever lose the ones you have.',
    'Keep it private, in a password manager or somewhere safe. Nobody else has a copy.',
    '',
  ].join('\n');
}

/**
 * On the account's first device: shows the recovery key, once, to save before sync turns on.
 * It's the only way back in if every device is lost.
 */
export function RecoveryKeyStep({
  api,
  email,
  again,
}: {
  api: FactwrightApi;
  email: string;
  /** Why this computer, which synced before, makes a recovery key again. */
  again?: SetUpAgain;
}) {
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.makeRecoveryKey().then(
      (result) => {
        if (!live) return;
        if (result.ok) setRecoveryKey(result.recoveryKey);
        else setProblem(result.message);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api]);

  const copy = async () => {
    if (recoveryKey) setCopied((await api.copyText(recoveryKey)).ok);
  };

  const saveFile = async () => {
    if (!recoveryKey) return;
    const result = await api.saveFile('Factwright recovery key.txt', keyFile(recoveryKey, email));
    if (!result.ok) setProblem(result.message);
  };

  const turnOn = async () => {
    setBusy(true);
    setProblem(null);
    const result = await api.turnOnSync();
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  };

  return (
    <>
      {again === 'remade' && (
        <p className={styles.lead}>
          This account has no recovery key yet, such as after it was deleted and made again, so a
          key you saved before won’t open it. This computer makes a new one, and your other devices
          link again once it’s on.
        </p>
      )}
      <p className={styles.lead}>
        If you ever lose all your devices, this key is the only way back into your synced job hunt.
        Nobody else has a copy, us included.
      </p>
      <div className={styles.key}>
        {recoveryKey ? (
          <Groups code={recoveryKey} className={styles.keyText} />
        ) : (
          <code className={styles.keyText}>…</code>
        )}
        <div className={styles.keyActions}>
          <Button
            size="sm"
            icon={
              copied ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )
            }
            disabled={!recoveryKey}
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            icon={<Download size={14} aria-hidden="true" />}
            disabled={!recoveryKey}
            onClick={saveFile}
          >
            Save as a file…
          </Button>
        </div>
      </div>
      <p className={styles.hint}>Keep it in your password manager, or print it and keep it safe.</p>
      <Checkbox
        label="I’ve saved my recovery key somewhere safe"
        checked={saved}
        onChange={(event) => setSaved(event.target.checked)}
      />
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <DialogActions>
        <DifferentAccount api={api} />
        <Button variant="primary" disabled={!recoveryKey || !saved || busy} onClick={turnOn}>
          {busy ? 'Turning on…' : 'Turn on sync'}
        </Button>
      </DialogActions>
    </>
  );
}

/** Signed in with the wrong account, such as a work GitHub: ends that sign-in, and nothing else. */
export function DifferentAccount({ api }: { api: FactwrightApi }) {
  return (
    <Button variant="quiet" onClick={() => void api.useDifferentSyncAccount()}>
      Use a different account
    </Button>
  );
}
