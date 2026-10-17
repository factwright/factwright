import { EXTENSION_URL } from '@factwright/core';
import type { AccountInfo, SyncAccess } from '@factwright/sync';
import { Button, DialogActions } from '@factwright/ui';
import { ArrowUpRight, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { ApprovalsView, LinkCode, SyncStatus } from '../../shared/sync.ts';
import { RequestsPanel } from './Approve.tsx';
import { Groups } from './Groups.tsx';
import { QrCode } from './QrCode.tsx';
import styles from './SyncDialog.module.css';
import { extensionWorks, hostOf, whose } from './servers.ts';
import { timeAgo, useServerTerms } from './useSync.ts';

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

/** A day such as "November 17", with its year when that isn't this year. */
export function dayOf(iso: string, now: Date = new Date()): string {
  const day = new Date(iso);
  return day.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    ...(day.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

/**
 * How the account has sync, where it's sold: free, and why, or its subscription, with when it
 * renews or ends, or that a card didn't go through. Manage opens the account's page on the web,
 * where Stripe's portal changes the card or the plan, cancels, and has the receipts.
 */
function SubscriptionLine({ access, onManage }: { access: SyncAccess; onManage: () => void }) {
  const live =
    access.subscription && access.subscription.state !== 'ended' ? access.subscription : null;
  const when = live?.renewsAt ? dayOf(live.renewsAt) : null;
  let words: string;
  if (access.gift === 'early') words = 'Free sync, for good. Thanks for being one of the first.';
  else if (access.gift === 'free') {
    words = `Free sync, from Steve. Good luck with the search!${
      live && when ? ` Your subscription ends ${when}.` : ''
    }`;
  } else if (live?.state === 'retrying') {
    words = 'Subscription: your card didn’t go through, so Stripe is trying it again.';
  } else if (live?.state === 'ending') {
    words = when ? `Subscription: canceled, syncing until ${when}.` : 'Subscription: canceled.';
  } else if (live) words = when ? `Subscription: renews ${when}.` : 'Subscription: active.';
  else return null;
  return (
    <p className={styles.hint}>
      {words}
      {live && (
        <>
          {' '}
          <button
            type="button"
            className={`${styles.link} ${styles.outLink}`}
            aria-label={
              live.state === 'retrying'
                ? 'Update your card on the web'
                : 'Manage your subscription on the web'
            }
            onClick={onManage}
          >
            {live.state === 'retrying' ? 'Update card' : 'Manage'}
            <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </>
      )}
    </p>
  );
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

/**
 * Sync once it's on: how it stands, and with which server when it's one of your own, how the
 * account has sync where it's sold, the account's devices, adding one, the browser extension's
 * page, and turning it off here.
 */
export function ManageSync({
  api,
  status,
  approvals,
  close,
}: {
  api: FactwrightApi;
  status: On;
  approvals: ApprovalsView;
  close: () => void;
}) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const own = status.ownServer ?? null;
  const terms = useServerTerms(api, own);

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
      <RequestsPanel api={api} approvals={approvals} />
      <p className={styles.standing} aria-live="polite">
        <span className={`${styles.dot} ${DOTS[status.activity]}`} aria-hidden="true" />
        {standing(status)}
        {status.activity !== 'syncing' && (
          <button type="button" className={styles.link} onClick={() => api.syncNow()}>
            Sync now
          </button>
        )}
      </p>
      {own && (
        <p className={styles.hint}>
          Sync server: <strong className={styles.server}>{hostOf(own)}</strong>. To use another,
          turn off sync on this computer first.
        </p>
      )}
      {account?.access && (
        <SubscriptionLine access={account.access} onManage={() => void api.openAccountPage()} />
      )}
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

      {extensionWorks(status, api.factwrightSync) && (
        <section className={styles.section} aria-labelledby="sync-extension">
          <h3 id="sync-extension" className={styles.heading}>
            Saving jobs from your browser
          </h3>
          <p className={styles.hint}>
            Save to Factwright, an extension for Chrome and Firefox, saves the job you’re looking at
            to your job hunt, with its posting, through sync.{' '}
            <a className={styles.link} href={EXTENSION_URL} target="_blank" rel="noreferrer">
              About the extension
            </a>
          </p>
        </section>
      )}

      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      {terms?.legal && (
        <p className={styles.hint}>
          What sync keeps, and for how long, is in {whose(own)}{' '}
          <a className={styles.link} href={terms.legal.privacy} target="_blank" rel="noreferrer">
            privacy policy
          </a>
          . Using sync means you agree to {own ? 'its' : 'the'}{' '}
          <a className={styles.link} href={terms.legal.terms} target="_blank" rel="noreferrer">
            terms of service
          </a>
          .
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
          {/* While a device waits to be approved, approving it is the main thing to do. */}
          <Button
            variant={approvals.requests.length > 0 || approvals.approving ? 'secondary' : 'primary'}
            onClick={close}
          >
            Done
          </Button>
        </DialogActions>
      )}
    </>
  );
}
