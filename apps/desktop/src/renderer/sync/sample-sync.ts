import { type AccountInfo, readLinkCode, readRecoveryKey } from '@factwright/sync';
import type { FactwrightApi } from '../../shared/api.ts';
import type { ApprovalsView, RequestView, SyncStatus } from '../../shared/sync.ts';

type SyncApi = Pick<
  FactwrightApi,
  | 'syncStatus'
  | 'onSyncStatus'
  | 'signInToSync'
  | 'cancelSyncSignIn'
  | 'makeRecoveryKey'
  | 'turnOnSync'
  | 'linkWithCode'
  | 'useRecoveryKey'
  | 'makeLinkCode'
  | 'cancelLinkCode'
  | 'syncNow'
  | 'syncAccount'
  | 'removeSyncDevice'
  | 'signOutOfSync'
  | 'useDifferentSyncAccount'
  | 'openAccountPage'
  | 'linkApprovals'
  | 'onLinkApprovals'
  | 'askToLink'
  | 'confirmLinkCheck'
  | 'stopAskingToLink'
  | 'approveLinkRequest'
  | 'answerLinkRequest'
  | 'denyLinkRequest'
  | 'dismissLinkApproval'
>;

const EMAIL = 'sam.rivera@example.com';
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const ON: Extract<SyncStatus, { state: 'on' }> = {
  state: 'on',
  email: EMAIL,
  activity: 'idle',
  lastSynced: minutesAgo(2),
  message: null,
  skipped: 0,
};

/** Where sync starts for ?sync=, to see each state. Off, unless asked. */
const STARTS: Readonly<Record<string, SyncStatus>> = {
  off: { state: 'off' },
  unavailable: { state: 'unavailable' },
  'no-server': { state: 'no-server' },
  'signing-in': {
    state: 'signing-in',
    code: 'WDJB-MJHT',
    url: 'https://app.factwright.com/device?user_code=WDJBMJHT',
  },
  first: { state: 'setting-up', email: EMAIL, firstDevice: true },
  link: { state: 'setting-up', email: EMAIL, firstDevice: false },
  remade: { state: 'setting-up', email: EMAIL, firstDevice: true, again: 'remade' },
  changed: { state: 'setting-up', email: EMAIL, firstDevice: false, again: 'changed' },
  on: ON,
  syncing: { ...ON, activity: 'syncing' },
  offline: {
    ...ON,
    activity: 'offline',
    message: 'Can’t reach the sync server. Your changes are safe here, and sync once it’s back.',
  },
  problem: {
    ...ON,
    activity: 'problem',
    message: 'Your account is out of space. New changes stay on this computer.',
    skipped: 2,
  },
  'signed-out': { state: 'signed-out', email: EMAIL },
};

const ACCOUNT: AccountInfo = {
  user: { id: 'sample', email: EMAIL, name: 'Sam Rivera', since: minutesAgo(60 * 24 * 30) },
  devices: [
    {
      id: 'mac',
      name: 'Factwright on Sam’s MacBook Pro',
      current: true,
      lastActive: minutesAgo(0),
      since: minutesAgo(60 * 24 * 30),
    },
    {
      id: 'pc',
      name: 'Factwright on SAM-PC',
      current: false,
      lastActive: minutesAgo(60 * 5),
      since: minutesAgo(60 * 24 * 20),
    },
    {
      id: 'phone',
      name: 'Safari on iPhone',
      current: false,
      lastActive: minutesAgo(60 * 30),
      since: minutesAgo(60 * 24 * 10),
    },
  ],
  usage: { bytes: 3_600_000, limit: 1024 * 1024 * 1024, records: 380, files: 152 },
};

/** A check code for the preview: dog, key, rocket, pizza, guitar, anchor. */
const CHECK = [0, 47, 54, 27, 57, 60];

const REQUEST: RequestView = {
  id: 'sample-request',
  device: 'Chrome on Windows',
  asked: minutesAgo(1),
  elsewhere: false,
};

const APPROVER = 'Factwright on Sam’s MacBook Pro';

/**
 * Sync for the screens preview, made up. ?sync= picks where it starts. Turning it on plays
 * through signing in (?sync=link for a second computer), and the rest answers as the app would.
 * ?approve= picks how linking by approval starts: "request" for another device asking to link
 * once sync is on, "check" to start at the emoji (asking or approving, by ?sync=), or "old" for a
 * server that can't approve devices yet.
 */
export function sampleSync(start: string | null, approve: string | null = null): SyncApi {
  const listeners = new Set<(status: SyncStatus) => void>();
  let status = STARTS[start ?? 'off'] ?? { state: 'off' };
  let devices = ACCOUNT.devices;
  const set = (next: SyncStatus) => {
    status = next;
    for (const listener of listeners) listener(next);
  };
  const viewers = new Set<(view: ApprovalsView) => void>();
  let approvals: ApprovalsView = {
    supported: approve !== 'old',
    asking: null,
    requests: approve === 'request' ? [REQUEST] : [],
    approving:
      approve === 'check' && status.state === 'on'
        ? { id: REQUEST.id, device: REQUEST.device, step: 'check', check: CHECK }
        : null,
  };
  const show = (next: Partial<ApprovalsView>) => {
    approvals = { ...approvals, ...next };
    for (const viewer of viewers) viewer(approvals);
  };
  const offered = { step: 'check', approver: APPROVER, check: CHECK, confirmed: false } as const;
  return {
    syncStatus: async () => status,
    onSyncStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signInToSync: () =>
      new Promise((resolve) => {
        const signingIn = STARTS['signing-in'];
        if (signingIn) set(signingIn);
        setTimeout(() => {
          if (status.state !== 'signing-in')
            return resolve({ ok: false, message: 'Signing in was canceled.' });
          set({ state: 'setting-up', email: EMAIL, firstDevice: start !== 'link' });
          resolve({ ok: true });
        }, 2500);
      }),
    cancelSyncSignIn: () => set({ state: 'off' }),
    makeRecoveryKey: async () => ({
      ok: true,
      recoveryKey: '7KQ2-M9XD-4RTB-HP0E-WN3C-8YVA-G5KS-21FJ',
    }),
    turnOnSync: async () => {
      set(ON);
      return { ok: true };
    },
    linkWithCode: async (code) => {
      if (!readLinkCode(code)) {
        return { ok: false, message: 'That isn’t a link code. It’s 32 letters and numbers.' };
      }
      set(ON);
      return { ok: true };
    },
    useRecoveryKey: async (key) => {
      if (!readRecoveryKey(key)) {
        return { ok: false, message: 'That isn’t a recovery key. It’s 32 letters and numbers.' };
      }
      set(ON);
      return { ok: true };
    },
    makeLinkCode: async () => ({
      ok: true,
      link: {
        id: 'sample-link',
        code: 'M4XP-2KQD-9TRB-HN0W-C3ZA-8YVG-5KSP-1FJ7',
        url: 'https://app.factwright.com/link#M4XP2KQD9TRBHN0WC3ZA8YVG5KSP1FJ7',
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    }),
    cancelLinkCode: () => {},
    syncNow: () => {
      if (status.state !== 'on') return;
      set({ ...status, activity: 'syncing' });
      setTimeout(() => set({ ...ON, lastSynced: new Date().toISOString() }), 1200);
    },
    syncAccount: async () => ({ ok: true, account: { ...ACCOUNT, devices } }),
    removeSyncDevice: async (id) => {
      devices = devices.filter((device) => device.id !== id);
      return { ok: true };
    },
    signOutOfSync: async () => {
      set({ state: 'off' });
      return { ok: true };
    },
    useDifferentSyncAccount: async () => {
      set({ state: 'off' });
      return { ok: true };
    },
    openAccountPage: async () => {},
    linkApprovals: async () => approvals,
    onLinkApprovals: (viewer) => {
      viewers.add(viewer);
      return () => viewers.delete(viewer);
    },
    askToLink: async () => {
      if (approvals.asking && approvals.asking.step !== 'ended') return { ok: true };
      if (approve === 'check') {
        show({ asking: offered });
        return { ok: true };
      }
      show({ asking: { step: 'waiting' } });
      setTimeout(() => {
        if (approvals.asking?.step === 'waiting') show({ asking: offered });
      }, 3000);
      return { ok: true };
    },
    confirmLinkCheck: (matched) => {
      if (approvals.asking?.step !== 'check') return;
      if (!matched) {
        show({
          asking: {
            step: 'ended',
            message: 'Nothing was linked. If you didn’t start this, you can ignore it.',
          },
        });
        return;
      }
      show({ asking: { ...approvals.asking, confirmed: true } });
      setTimeout(() => {
        show({ asking: null });
        set(ON);
      }, 2500);
    },
    stopAskingToLink: () => show({ asking: null }),
    approveLinkRequest: async (id) => {
      const request = approvals.requests.find((each) => each.id === id);
      if (!request) return { ok: false, message: 'That request to link is gone.' };
      show({ approving: { id, device: request.device, step: 'waiting' } });
      setTimeout(
        () => show({ approving: { id, device: request.device, step: 'check', check: CHECK } }),
        1500,
      );
      return { ok: true };
    },
    answerLinkRequest: async (matched) => {
      const approving = approvals.approving;
      if (approving?.step !== 'check') return { ok: false, message: 'Check the emoji first.' };
      const { id, device } = approving;
      if (!matched) {
        show({
          requests: [],
          approving: {
            id,
            device,
            step: 'ended',
            linked: false,
            message: 'Nothing was linked. If you didn’t start this, you can ignore it.',
          },
        });
        return { ok: true };
      }
      show({ approving: { id, device, step: 'sent' } });
      setTimeout(
        () =>
          show({
            requests: [],
            approving: { id, device, step: 'ended', linked: true, message: `${device} is linked.` },
          }),
        2500,
      );
      return { ok: true };
    },
    denyLinkRequest: async (id) => {
      show({ requests: approvals.requests.filter((request) => request.id !== id) });
      return { ok: true };
    },
    dismissLinkApproval: () => show({ approving: null }),
  };
}
