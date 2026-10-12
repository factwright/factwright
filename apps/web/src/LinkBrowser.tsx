import {
  type AccountKeys,
  accountKeys,
  type Bytes,
  linkId,
  openLink,
  openWithRecoveryKey,
  readLinkCode,
  readRecoveryKey,
} from '@factwright/sync';
import { Button, Field, Input } from '@factwright/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { saveKeys } from './keys.ts';
import styles from './page.module.css';
import { client } from './server.ts';

type Result = { ok: true; keys: AccountKeys } | { ok: false; message: string };

/** Keeps the account's keys in this browser, once they match the account's. */
async function keep(account: string, accountKey: Bytes): Promise<Result> {
  const keys = await accountKeys(accountKey);
  const saved = await client.keys();
  if (saved && saved.keyId !== keys.id) {
    return { ok: false, message: 'That key belongs to a different account.' };
  }
  await saveKeys(account, keys);
  return { ok: true, keys };
}

async function linkWithCode(account: string, text: string): Promise<Result> {
  const code = readLinkCode(text);
  if (!code) return { ok: false, message: 'That isn’t a link code. It’s 32 letters and numbers.' };
  const data = await client.takeLink(await linkId(code));
  const accountKey = data && (await openLink(data, code));
  if (!accountKey) {
    return {
      ok: false,
      message: 'That code didn’t work. It lasts 10 minutes: make a new one on your computer.',
    };
  }
  return keep(account, accountKey);
}

async function linkWithRecoveryKey(account: string, text: string): Promise<Result> {
  const recovery = readRecoveryKey(text);
  if (!recovery) {
    return { ok: false, message: 'That isn’t a recovery key. It’s 32 letters and numbers.' };
  }
  const saved = await client.keys();
  if (!saved) return { ok: false, message: 'No device has turned on sync for this account yet.' };
  const accountKey = await openWithRecoveryKey(saved.recovery, recovery);
  if (!accountKey) {
    return {
      ok: false,
      message: 'That recovery key doesn’t open this account. Check it, and try again.',
    };
  }
  return keep(account, accountKey);
}

/** A field for a 32-character code, and the button that uses it. */
function CodeForm({
  label,
  button,
  submit,
}: {
  label: string;
  button: string;
  submit: (text: string) => Promise<string | null>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(await submit(text));
    setBusy(false);
  };
  return (
    <form onSubmit={send}>
      <Field label={label} hint="Dashes and spaces don’t matter, and neither do capitals.">
        {(control) => (
          <Input
            {...control}
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
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={busy || text.trim().length < 32}>
          {busy ? 'Checking…' : button}
        </Button>
      </div>
    </form>
  );
}

/**
 * Links this browser to the account's synced job hunt: from the QR code a computer shows, from
 * the code typed in, or from the recovery key. The keys stay in this browser, and can't be
 * read back out.
 */
export function LinkBrowser({
  account,
  code,
  onLinked,
}: {
  account: string;
  /** A link code from the QR code's address, to use straight away. */
  code: string | null;
  onLinked: (keys: AccountKeys) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [linking, setLinking] = useState(code !== null);
  const started = useRef(false);

  const finish = (result: Result) => {
    if (result.ok) onLinked(result.keys);
    return result.ok ? null : result.message;
  };

  useEffect(() => {
    if (!code || started.current) return;
    started.current = true;
    void linkWithCode(account, code).then((result) => {
      setProblem(finish(result));
      setLinking(false);
    });
  });

  if (linking) {
    return (
      <section className={styles.card} aria-labelledby="link-title">
        <h1 id="link-title" className={styles.title}>
          Linking this phone…
        </h1>
        <p className={styles.hint}>Unlocking your job hunt in this browser.</p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="link-title">
      <h1 id="link-title" className={styles.title}>
        Link this browser
      </h1>
      <p className={styles.lead}>
        Your job hunt opens only where you’ve linked it. On your computer, open{' '}
        <strong>Sync</strong> in Factwright and choose <strong>Link a phone or computer</strong>.
        Then scan its QR code with your phone’s camera, or type its code here.
      </p>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <details>
        <summary className={styles.hint}>Or type the code it shows</summary>
        <CodeForm
          label="Code from your computer"
          button="Link"
          submit={async (text) => finish(await linkWithCode(account, text))}
        />
      </details>
      <details>
        <summary className={styles.hint}>Lost your computers? Use your recovery key</summary>
        <CodeForm
          label="Recovery key"
          button="Unlock"
          submit={async (text) => finish(await linkWithRecoveryKey(account, text))}
        />
      </details>
    </section>
  );
}
