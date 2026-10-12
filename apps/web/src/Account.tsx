import type { AccountInfo, AccountKeys } from '@factwright/sync';
import { Button } from '@factwright/ui';
import { strToU8, zipSync } from 'fflate';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import styles from './Account.module.css';
import { forgetKeys } from './keys.ts';
import page from './page.module.css';
import { client, deleteAccount, PROVIDER_NAMES, type Provider, signIn, signOut } from './server.ts';
import { fileContents, type Vault } from './vault.ts';

/** A size such as "48 KB", "3.6 MB" or "1 GB". */
function size(bytes: number): string {
  const [amount, unit] =
    bytes >= 1024 ** 3
      ? [bytes / 1024 ** 3, 'GB']
      : bytes >= 1024 ** 2
        ? [bytes / 1024 ** 2, 'MB']
        : [Math.max(1, Math.round(bytes / 1024)), 'KB'];
  return `${Number(amount.toFixed(1))} ${unit}`;
}

/** Everything in the job hunt, opened, as one ZIP: the workspace's files and the tracker. */
async function downloadCopy(vault: Vault, keys: AccountKeys): Promise<number> {
  const entries: Record<string, Uint8Array> = {};
  let missing = 0;
  for (const file of vault.files.values()) {
    const contents = await fileContents(client, keys, file.id);
    if (contents) entries[`workspace/${file.path}`] = contents;
    else missing += 1;
  }
  const day = new Date().toISOString().slice(0, 10);
  entries['tracker.json'] = strToU8(JSON.stringify(vault.rows, null, 2));
  entries['README.txt'] = strToU8(
    [
      `Your Factwright job hunt, as of ${day}.`,
      '',
      'workspace/ holds your files: your facts, guides, and each job’s folder.',
      'tracker.json holds what you tracked: your jobs, their history, and your calls.',
      '',
    ].join('\n'),
  );
  const url = URL.createObjectURL(
    new Blob([zipSync(entries, { level: 6 })], { type: 'application/zip' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `Factwright ${day}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return missing;
}

/**
 * The account: who's signed in, the devices that are, how much is stored, a copy of everything
 * to download, signing out here, and deleting the account.
 */
export function Account({
  email,
  vault,
  keys,
  providers,
}: {
  email: string;
  vault: Vault | null;
  keys: AccountKeys | null;
  providers: Provider[];
}) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [freshSignIn, setFreshSignIn] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await client.account());
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    try {
      await client.removeDevice(id);
      await load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const download = async () => {
    if (!vault || !keys) return;
    setDownloading(true);
    const missing = await downloadCopy(vault, keys);
    setDownloading(false);
    setProblem(
      missing === 0
        ? null
        : missing === 1
          ? 'One file couldn’t be opened, so it’s not in the copy.'
          : `${missing} files couldn’t be opened, so they’re not in the copy.`,
    );
  };

  const leave = async () => {
    await signOut();
    await forgetKeys();
    location.assign('/');
  };

  const deleteIt = async () => {
    const result = await deleteAccount();
    if (result === 'deleted') {
      await forgetKeys();
      location.assign('/');
    } else if (result === 'sign-in') setFreshSignIn(true);
    else setProblem('Your account couldn’t be deleted. Try again in a moment.');
  };

  return (
    <div className={styles.account}>
      <h1 className={page.title}>Your account</h1>
      <p className={page.lead}>Signed in as {email}.</p>

      <section className={page.section} aria-labelledby="devices">
        <h2 id="devices" className={page.heading}>
          Signed-in devices
        </h2>
        {info ? (
          <ul className={styles.devices}>
            {info.devices.map((device) => (
              <li key={device.id} className={styles.device}>
                <span className={styles.deviceName}>{device.name}</span>
                <span className={styles.deviceWhen}>
                  {device.current
                    ? 'This browser'
                    : `Since ${new Date(device.since).toLocaleDateString()}`}
                </span>
                {!device.current && (
                  <Button size="sm" variant="quiet" onClick={() => remove(device.id)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={page.hint}>Loading…</p>
        )}
        {info && (
          <p className={page.hint}>
            {size(info.usage.bytes)} of {size(info.usage.limit)} used, across {info.usage.files}{' '}
            files.
          </p>
        )}
      </section>

      <section className={page.section} aria-labelledby="copy">
        <h2 id="copy" className={page.heading}>
          A copy of your job hunt
        </h2>
        <p className={page.hint}>
          Everything, opened, as one ZIP: your workspace’s files, and what you tracked.
        </p>
        <div className={page.actions}>
          <Button
            icon={<Download size={16} aria-hidden="true" />}
            disabled={!vault || !keys || downloading}
            onClick={download}
          >
            {downloading ? 'Making your copy…' : 'Download a copy'}
          </Button>
        </div>
      </section>

      <section className={page.section} aria-labelledby="leave">
        <h2 id="leave" className={page.heading}>
          Signing out and deleting
        </h2>
        <p className={page.hint}>
          Signing out forgets this browser’s keys. Your job hunt stays on your computers.
        </p>
        <div className={page.actions}>
          <Button onClick={leave}>Sign out of this browser</Button>
        </div>
        {confirming ? (
          <div className={styles.danger}>
            <p className={page.lead}>
              Delete your account? Your synced job hunt, its backups and your sign-in go for good.
              The job hunt on your computers stays there.
            </p>
            {freshSignIn ? (
              <>
                <p className={page.hint}>To delete your account, sign in again first.</p>
                <div className={page.actions}>
                  {providers.map((provider) => (
                    <Button
                      key={provider}
                      onClick={async () => setProblem(await signIn(provider, '/account'))}
                    >
                      Sign in with {PROVIDER_NAMES[provider]}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <div className={page.actions}>
                <Button onClick={() => setConfirming(false)}>Keep my account</Button>
                <Button className={styles.deleteButton} onClick={deleteIt}>
                  Delete my account
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className={page.actions}>
            <Button
              variant="quiet"
              className={styles.deleteLink}
              onClick={() => setConfirming(true)}
            >
              Delete my account…
            </Button>
          </div>
        )}
      </section>

      {problem && (
        <p className={page.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
