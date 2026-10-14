import {
  type AccountKeys,
  type AskStep,
  accountKeys,
  type Bytes,
  checkEmoji,
  LinkAsk,
  linkId,
  openLink,
  openWithRecoveryKey,
  readLinkCode,
  readRecoveryKey,
  SyncError,
} from '@factwright/sync';
import { Button, CheckCode, Field, Input } from '@factwright/ui';
import { Eye, EyeOff } from 'lucide-react';
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

/**
 * A field for a 32-character code, and the button that uses it. The recovery key's is a
 * password field, under the account's email, so a password manager can fill it in.
 */
function CodeForm({
  label,
  button,
  submit,
  username,
}: {
  label: string;
  button: string;
  submit: (text: string) => Promise<string | null>;
  /** For a secret, the account's email, which password managers file it under. */
  username?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const secret = username !== undefined;
  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(await submit(text));
    setBusy(false);
  };
  return (
    <form onSubmit={send}>
      {secret && (
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={username}
          readOnly
          hidden
        />
      )}
      <Field label={label} hint="Dashes and spaces don’t matter, and neither do capitals.">
        {(control) => (
          <div className={styles.codeRow}>
            <Input
              {...control}
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
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={busy || text.trim().length < 32}>
          {busy ? 'Checking…' : button}
        </Button>
      </div>
    </form>
  );
}

/** How often asking looks at the other device again, and how long after it couldn't. */
const STEP_MS = 1500;
const OFFLINE_MS = 5000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ENDED: Record<Exclude<AskStep['state'], 'waiting' | 'check'>, string> = {
  denied: 'Your computer turned this down, so nothing was linked.',
  gone: 'That request ran out before it was approved. Ask again, or use a code.',
  failed:
    'Something changed the request on its way between your devices, so nothing was linked. Ask again.',
};
const MISMATCH = 'Nothing was linked. If you didn’t start this, you can ignore it.';
const BROKEN = 'That didn’t work, so nothing was linked. Ask again.';

type Asking =
  | { step: 'waiting' }
  | { step: 'check'; approver: string; check: number[]; confirmed: boolean }
  | { step: 'ended'; message: string };

/** What to say when a request to the server fails. */
const reasonOf = (error: unknown) =>
  error instanceof SyncError && error.kind === 'offline'
    ? 'Can’t reach Factwright right now. Check your connection.'
    : error instanceof Error
      ? error.message
      : String(error);

/**
 * Asking a device that's set up to approve this browser: the person checks both screens show the
 * same emoji, and says so on each. Only then is the account key handed over, sealed for this
 * browser alone. Leaving the page calls the request off.
 */
function AskToLink({
  account,
  onLinked,
}: {
  account: string;
  onLinked: (keys: AccountKeys) => void;
}) {
  const [asking, setAsking] = useState<Asking>({ step: 'waiting' });
  const [round, setRound] = useState(0);
  // The request, while it can still be called off, and whether the person said they match.
  const current = useRef<{ ask: LinkAsk; confirmed: boolean } | null>(null);
  const linked = useRef(onLinked);
  linked.current = onLinked;

  useEffect(() => {
    let live = true;
    const end = (message: string) => {
      if (live) setAsking({ step: 'ended', message });
    };
    void (async () => {
      let ask: LinkAsk;
      try {
        ask = await LinkAsk.start(client);
      } catch (error) {
        end(reasonOf(error));
        return;
      }
      if (!live) {
        void ask.cancel().catch(() => {});
        return;
      }
      current.current = { ask, confirmed: false };
      while (live && current.current?.ask === ask) {
        let step: AskStep;
        try {
          step = await ask.step();
        } catch (error) {
          if (error instanceof SyncError && error.kind === 'offline') {
            await pause(OFFLINE_MS);
            continue;
          }
          end(reasonOf(error));
          return;
        }
        if (!live || current.current?.ask !== ask) return;
        if (step.state === 'waiting') {
          setAsking({ step: 'waiting' });
        } else if (step.state === 'check') {
          const { confirmed } = current.current;
          setAsking({ step: 'check', approver: step.approver, check: step.check, confirmed });
          if (confirmed && step.approved) {
            const accountKey = await ask.finish().catch(() => null);
            // Picked up, so it's never called off: the approving device sees it linked.
            current.current = null;
            if (!accountKey) {
              end(BROKEN);
              return;
            }
            const result = await keep(account, accountKey).catch(
              (error: unknown): Result => ({ ok: false, message: reasonOf(error) }),
            );
            if (!live) return;
            if (result.ok) linked.current(result.keys);
            else end(result.message);
            return;
          }
        } else {
          end(ENDED[step.state]);
          return;
        }
        await pause(STEP_MS);
      }
    })();
    return () => {
      live = false;
      const asked = current.current;
      current.current = null;
      void asked?.ask.cancel().catch(() => {});
    };
  }, [account, round]);

  const answer = (matched: boolean) => {
    const asked = current.current;
    if (!asked) return;
    if (!matched) {
      current.current = null;
      void asked.ask.cancel().catch(() => {});
      setAsking({ step: 'ended', message: MISMATCH });
      return;
    }
    asked.ask.confirm();
    asked.confirmed = true;
    setAsking((now) => (now.step === 'check' ? { ...now, confirmed: true } : now));
  };

  if (asking.step === 'ended') {
    return (
      <div className={styles.ask} aria-live="polite">
        <p className={styles.lead}>{asking.message}</p>
        <div className={styles.actions}>
          <Button
            onClick={() => {
              setAsking({ step: 'waiting' });
              setRound((now) => now + 1);
            }}
          >
            Ask again
          </Button>
        </div>
      </div>
    );
  }

  if (asking.step === 'check') {
    return (
      <div className={styles.ask} aria-live="polite">
        <p className={styles.lead}>
          {asking.confirmed ? (
            <>
              Now say they match on <strong>{asking.approver}</strong> too.
            </>
          ) : (
            <>
              <strong>{asking.approver}</strong> offered to approve this browser. Check it shows the
              same emoji, in the same order:
            </>
          )}
        </p>
        <CheckCode items={checkEmoji(asking.check)} quiet={asking.confirmed} />
        {asking.confirmed ? (
          <p className={styles.waiting}>
            <span className={styles.dot} aria-hidden="true" />
            Waiting for your other device…
          </p>
        ) : (
          <div className={styles.actions}>
            <Button onClick={() => answer(false)}>They don’t match</Button>
            <Button variant="primary" onClick={() => answer(true)}>
              They match
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.ask} aria-live="polite">
      <p className={styles.lead}>
        On your computer, open Factwright. It asks you to approve this browser.
      </p>
      <p className={styles.waiting}>
        <span className={styles.dot} aria-hidden="true" />
        Waiting for your computer…
      </p>
    </div>
  );
}

/**
 * Links this browser to the account's synced job hunt: approved from a computer that's set up,
 * from the QR code a computer shows, from the code typed in, or from the recovery key. The keys
 * stay in this browser, and can't be read back out.
 */
export function LinkBrowser({
  account,
  email,
  canApprove = false,
  code,
  onLinked,
}: {
  account: string;
  /** The account's email, which a password manager files the recovery key under. */
  email: string;
  /** Whether to ask a device that's set up to approve this browser, as the server can. */
  canApprove?: boolean;
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

  const codeHow = (
    <>
      On your computer, open <strong>Sync</strong> in Factwright and choose{' '}
      <strong>Link a phone or computer</strong>. Then scan its QR code with your phone’s camera, or
      type its code here.
    </>
  );

  return (
    <section className={styles.card} aria-labelledby="link-title">
      <h1 id="link-title" className={styles.title}>
        Link this browser
      </h1>
      <p className={styles.lead}>
        Your job hunt opens only where you’ve linked it.{' '}
        {canApprove ? 'Approve this browser from a computer where Factwright syncs.' : codeHow}
      </p>
      {canApprove && <AskToLink account={account} onLinked={onLinked} />}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <details>
        <summary className={styles.hint}>
          {canApprove ? 'Or use a code from your computer' : 'Or type the code it shows'}
        </summary>
        {canApprove && <p className={styles.hint}>{codeHow}</p>}
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
          username={email}
          submit={async (text) => finish(await linkWithRecoveryKey(account, text))}
        />
      </details>
    </section>
  );
}
