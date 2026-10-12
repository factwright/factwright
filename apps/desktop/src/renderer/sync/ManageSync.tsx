import type { AccountInfo } from '@factwright/sync';
import { Button, DialogActions } from '@factwright/ui';
import { Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { LinkCode, SyncStatus } from '../../shared/sync.ts';
import { Groups } from './Groups.tsx';
import { QrCode } from './QrCode.tsx';
import styles from './SyncDialog.module.css';
import { timeAgo } from './useSync.ts';

type On = Extract<SyncStatus, { state: 'on' }>;

const DOTS: Record<On['activity'], string | undefined> = {
  idle: styles.dotIdle,
  syncing: styles.dotSyncing,
  offline: styles.dotOffline,
  problem: styles.dotProblem,
};

/** How sync stands, in a line. */
function standing(status: On): string {
  switch (status.activity) {
    case 'syncing':
      return 'Syncing…';
    case 'idle':
      return status.lastSynced
        ? `Up to date. Synced ${timeAgo(status.lastSynced)}.`
        : 'Up to date.';
    default:
      return status.message ?? 'Not syncing right now.';
  }
}

/** Adding a phone or computer: a QR code to scan, and a code to type. */
function LinkPanel({ api }: { api: FactwrightApi }) {
  const [link, setLink] = useState<LinkCode | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // A code nobody used is called off when the panel closes.
  useEffect(
    () => () => {
      if (link) api.cancelLinkCode(link.id);
    },
    [api, link],
  );

  const make = async () => {
    setProblem(null);
    const result = await api.makeLinkCode();
    if (result.ok) setLink(result.link);
    else setProblem(result.message);
  };

  if (!link) {
    return (
      <>
        <p className={styles.hint}>
          Your phone opens your job hunt on the web. Another computer runs Factwright.
        </p>
        <Button
          className={styles.linkButton}
          icon={<Smartphone size={16} aria-hidden="true" />}
          onClick={make}
        >
          Link a phone or computer
        </Button>
        {problem && (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        )}
      </>
    );
  }
  return (
    <div className={styles.linkPanel}>
      <QrCode value={link.url} label="QR code to link a phone" />
      <div className={styles.linkWords}>
        <p>
          <strong>On a phone,</strong> scan this with the camera, and sign in with the same account.
        </p>
        <p>
          <strong>On a computer,</strong> open Sync in Factwright, sign in, and type:
        </p>
        <Groups code={link.code} className={styles.linkCode} />
        <p className={styles.hint}>It works once, for the next 10 minutes.</p>
      </div>
    </div>
  );
}

/** Sync once it's on: how it stands, the account's devices, adding one, and turning it off here. */
export function ManageSync({
  api,
  status,
  close,
}: {
  api: FactwrightApi;
  status: On;
  close: () => void;
}) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    const result = await api.syncAccount();
    if (result.ok) setAccount(result.account);
    else setProblem(result.message);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    const result = await api.removeSyncDevice(id);
    if (result.ok) await load();
    else setProblem(result.message);
  };

  const turnOff = async () => {
    const result = await api.signOutOfSync();
    if (!result.ok) setProblem(result.message);
  };

  return (
    <>
      <p className={styles.standing} aria-live="polite">
        <span className={`${styles.dot} ${DOTS[status.activity]}`} aria-hidden="true" />
        {standing(status)}
        {status.activity !== 'syncing' && (
          <button type="button" className={styles.link} onClick={() => api.syncNow()}>
            Sync now
          </button>
        )}
      </p>
      {status.skipped > 0 && (
        <p className={styles.hint}>
          {status.skipped === 1 ? 'One file stays' : `${status.skipped} files stay`} on this
          computer: over 25 MB, or named with characters another computer can’t use.
        </p>
      )}

      <section className={styles.section} aria-labelledby="sync-devices">
        <h3 id="sync-devices" className={styles.heading}>
          Signed-in devices
        </h3>
        {account ? (
          <ul className={styles.devices}>
            {account.devices.map((device) => (
              <li key={device.id} className={styles.device}>
                <span className={styles.deviceName}>{device.name}</span>
                <span className={styles.deviceWhen}>
                  {device.current ? 'This computer' : `Used ${timeAgo(device.lastActive)}`}
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
          <p className={styles.hint}>{problem ? '' : 'Loading…'}</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="sync-add">
        <h3 id="sync-add" className={styles.heading}>
          Add a phone or computer
        </h3>
        <LinkPanel api={api} />
      </section>

      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      {confirmOff ? (
        <div className={styles.confirm}>
          <p>
            Turn off sync on this computer? Your job hunt stays here as it is, and on your other
            devices.
          </p>
          <DialogActions>
            <Button onClick={() => setConfirmOff(false)}>Keep it on</Button>
            <Button variant="primary" onClick={turnOff}>
              Turn off here
            </Button>
          </DialogActions>
        </div>
      ) : (
        <DialogActions>
          <Button variant="quiet" onClick={() => setConfirmOff(true)}>
            Turn off on this computer
          </Button>
          <Button onClick={() => api.openAccountPage()}>Your account on the web</Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </DialogActions>
      )}
    </>
  );
}
