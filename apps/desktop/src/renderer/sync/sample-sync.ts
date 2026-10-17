import { type AccountInfo, readLinkCode, readRecoveryKey, type SyncAccess } from '@factwright/sync';
import type { FactwrightApi } from '../../shared/api.ts';
import type { ApprovalsView, RequestView, ServerTerms, SyncStatus } from '../../shared/sync.ts';

type SyncApi = Pick<
  FactwrightApi,
  | 'factwrightSync'
  | 'syncStatus'
  | 'onSyncStatus'
  | 'signInToSync'
  | 'connectSyncServer'
  | 'syncServerTerms'
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
  | 'subscribeToSync'
  | 'openAccountPage'
  | 'linkApprovals'
  | 'onLinkApprovals'
  | 'askToLink'
  | 'confirmLinkCheck'
  | 'approveLinkRequest'
  | 'answerLinkRequest'
  | 'denyLinkRequest'
  | 'signOutTurnedDown'
  | 'dismissLinkApproval'
>;

const EMAIL = 'sam.rivera@example.com';

/** A server of Sam's own, at a free workers.dev address. */
const OWN_SERVER = 'https://factwright-sync.sam.workers.dev';

/** Factwright's own server's terms, and a server of your own's, which has none. */
const FACTWRIGHT_TERMS: ServerTerms = {
  legal: { terms: 'https://factwright.com/terms', privacy: 'https://factwright.com/privacy' },
  subscription: false,
};
const OWN_TERMS: ServerTerms = { legal: null, subscription: false };
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const ON: Extract<SyncStatus, { state: 'on' }> = {
  state: 'on',
  email: EMAIL,
  activity: 'idle',
  lastSynced: minutesAgo(2),
  message: null,
  skipped: 0,
};

const SIGNING_IN: Extract<SyncStatus, { state: 'signing-in' }> = {
  state: 'signing-in',
  code: 'WDJB-MJHT',
  url: 'https://app.factwright.com/device?user_code=WDJBMJHT',
};

/** Where sync starts for ?sync=, to see each state. Off, unless asked. */
const STARTS: Readonly<Record<string, SyncStatus>> = {
  off: { state: 'off' },
  unavailable: { state: 'unavailable' },
  'no-server': { state: 'no-server' },
  'signing-in': SIGNING_IN,
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
  subscribe: { state: 'subscribe', email: EMAIL, again: false, waiting: false },
  'subscribe-again': { state: 'subscribe', email: EMAIL, again: true, waiting: false },
  'subscribe-waiting': { state: 'subscribe', email: EMAIL, again: false, waiting: true },
  paused: { state: 'paused', email: EMAIL, waiting: false },
  'paused-waiting': { state: 'paused', email: EMAIL, waiting: true },
  'payment-failed': { ...ON, paymentFailed: true },
};

/** How the account has sync, for ?plan=, where Factwright's server sells it. */
const PLANS: Readonly<Record<string, SyncAccess>> = {
  active: {
    allowed: true,
    gift: null,
    subscription: { state: 'active', renewsAt: daysFromNow(30) },
  },
  ending: {
    allowed: true,
    gift: null,
    subscription: { state: 'ending', renewsAt: daysFromNow(12) },
  },
  retrying: {
    allowed: true,
    gift: null,
    subscription: { state: 'retrying', renewsAt: daysFromNow(-2) },
  },
  free: { allowed: true, gift: 'free', subscription: null },
  early: { allowed: true, gift: 'early', subscription: null },
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
  signedIn: minutesAgo(2),
  elsewhere: false,
};

/** Another device asking at the same time, as someone else's might. */
const ANOTHER: RequestView = {
  id: 'another-request',
  device: 'Factwright on Sam’s MacBook',
  asked: minutesAgo(0),
  signedIn: minutesAgo(4),
  elsewhere: false,
};

const APPROVER = 'Factwright on Sam’s MacBook Pro';

/** Whether a status is with a server of your own, as the app names it. */
const ownServerOf = (status: SyncStatus) => ('ownServer' in status ? status.ownServer : undefined);

/** A status with a server of your own, for the steps that name one. */
function onOwn(status: SyncStatus, own: string): SyncStatus {
  return status.state === 'off' || status.state === 'unavailable' || status.state === 'no-server'
    ? status
    : { ...status, ownServer: own };
}

/** What a server of your own's address in the preview says, as the app would check it. */
function readSample(typed: string): { server: string } | { message: string; help?: 'update' } {
  const text = typed.trim();
  if (!text) return { message: 'Type your server’s address.' };
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return {
      message: 'That isn’t an address. It looks like https://factwright-sync.yourname.workers.dev.',
    };
  }
  if (url.protocol !== 'https:')
    return { message: 'Use your server’s address that starts with https://.' };
  // Any address starting "old." is a server from before approving devices.
  if (url.hostname.startsWith('old.')) {
    return {
      message: 'Your server needs an update for this version of Factwright.',
      help: 'update',
    };
  }
  return { server: url.origin };
}

/**
 * Sync for the screens preview, made up. ?sync= picks where it starts. Turning it on plays
 * through signing in (?sync=link for a second computer), and the rest answers as the app would.
 * ?approve= picks how linking by approval starts: "request" for another device asking to link
 * once sync is on, "two" for two at once, "check" to start at the emoji (asking or approving, by
 * ?sync=), "quiet" for asking with no device ever offering, "stale" for a computer that signed in
 * too long ago to ask, or "old" for a server that can't approve devices yet. ?server= picks the
 * server: "own" for sync with a server of your own, "own-only" for a copy without Factwright's
 * sync, or "priced" for Factwright's once it says sync there is a subscription: signing in then
 * goes on to subscribing (?sync=subscribe, "subscribe-again" or "subscribe-waiting"), and sync can
 * pause (?sync=paused or "paused-waiting") or have a card that didn't go through
 * (?sync=payment-failed). ?plan= picks how the account has sync, for the Sync screen: "active",
 * "ending", "retrying", "free" or "early".
 */
export function sampleSync(
  start: string | null,
  approve: string | null = null,
  server: string | null = null,
  plan: string | null = null,
): SyncApi {
  const listeners = new Set<(status: SyncStatus) => void>();
  const begun = STARTS[start ?? 'off'] ?? { state: 'off' };
  let status = server === 'own' ? onOwn(begun, OWN_SERVER) : begun;
  const factwrightTerms = { ...FACTWRIGHT_TERMS, subscription: server === 'priced' };
  let devices = ACCOUNT.devices;
  const set = (next: SyncStatus) => {
    status = next;
    for (const listener of listeners) listener(next);
  };
  const viewers = new Set<(view: ApprovalsView) => void>();
  let approvals: ApprovalsView = {
    supported: approve !== 'old',
    asking: null,
    requests: approve === 'request' ? [REQUEST] : approve === 'two' ? [REQUEST, ANOTHER] : [],
    approving:
      approve === 'check' && status.state === 'on'
        ? { id: REQUEST.id, device: REQUEST.device, step: 'check', check: CHECK }
        : null,
    turnedDown: null,
  };
  const show = (next: Partial<ApprovalsView>) => {
    approvals = { ...approvals, ...next };
    for (const viewer of viewers) viewer(approvals);
  };
  const offered = { step: 'check', approver: APPROVER, check: CHECK, confirmed: false } as const;
  /** Signs in through the made-up browser, to Factwright's own or a server of your own. */
  const signIn = (
    own: string | undefined,
  ): Promise<{ ok: true } | { ok: false; message: string }> =>
    new Promise((resolve) => {
      set(
        own ? onOwn({ ...SIGNING_IN, url: `${own}/device?user_code=WDJBMJHT` }, own) : SIGNING_IN,
      );
      setTimeout(() => {
        if (status.state !== 'signing-in')
          return resolve({ ok: false, message: 'Signing in was canceled.' });
        // Where Factwright's server sells sync, the account subscribes first.
        const next: SyncStatus =
          server === 'priced' && !own
            ? { state: 'subscribe', email: EMAIL, again: false, waiting: false }
            : { state: 'setting-up', email: EMAIL, firstDevice: start !== 'link' };
        set(own ? onOwn(next, own) : next);
        resolve({ ok: true });
      }, 2500);
    });
  // Counts tries at connecting, as the app does, so going back calls one off.
  let attempts = 0;
  /** Where the made-up sync goes on, keeping the server it's with. */
  const keep = (next: SyncStatus) => {
    const own = ownServerOf(status);
    set(own ? onOwn(next, own) : next);
  };
  return {
    factwrightSync: server !== 'own-only',
    syncStatus: async () => status,
    onSyncStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signInToSync: () => {
      attempts++;
      return signIn(ownServerOf(status));
    },
    connectSyncServer: async (address) => {
      const read = readSample(address);
      if ('message' in read) return { ok: false, ...read };
      // Checking the server takes a moment.
      const attempt = ++attempts;
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (attempt !== attempts) return { ok: false, message: 'Signing in was canceled.' };
      return signIn(read.server);
    },
    syncServerTerms: async () => {
      if (ownServerOf(status)) return OWN_TERMS;
      return server === 'own-only' ? null : factwrightTerms;
    },
    cancelSyncSignIn: () => {
      attempts++;
      set({ state: 'off' });
    },
    makeRecoveryKey: async () => ({
      ok: true,
      recoveryKey: '7KQ2-M9XD-4RTB-HP0E-WN3C-8YVA-G5KS-21FJ',
    }),
    turnOnSync: async () => {
      keep(ON);
      return { ok: true };
    },
    linkWithCode: async (code) => {
      if (!readLinkCode(code)) {
        return { ok: false, message: 'That isn’t a link code. It’s 32 letters and numbers.' };
      }
      keep(ON);
      return { ok: true };
    },
    useRecoveryKey: async (key) => {
      if (!readRecoveryKey(key)) {
        return { ok: false, message: 'That isn’t a recovery key. It’s 32 letters and numbers.' };
      }
      keep(ON);
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
      setTimeout(() => keep({ ...ON, lastSynced: new Date().toISOString() }), 1200);
    },
    syncAccount: async () => {
      const access =
        PLANS[plan ?? ''] ??
        (start === 'payment-failed'
          ? PLANS.retrying
          : server === 'priced' && !ownServerOf(status)
            ? PLANS.active
            : undefined);
      return { ok: true, account: { ...ACCOUNT, devices, ...(access && { access }) } };
    },
    removeSyncDevice: async (id) => {
      devices = devices.filter((device) => device.id !== id);
      return { ok: true };
    },
    signOutOfSync: async () => {
      set({ state: 'off' });
      return { ok: true };
    },
    // A server of your own stays the one to sign in to again.
    useDifferentSyncAccount: async () => {
      const own = ownServerOf(status);
      set(own ? onOwn({ state: 'signed-out', email: EMAIL }, own) : { state: 'off' });
      return { ok: true };
    },
    openAccountPage: async () => {},
    // The made-up browser takes a moment to subscribe, then sync carries on.
    subscribeToSync: async () => {
      if (status.state !== 'subscribe' && status.state !== 'paused') {
        return { ok: false, message: 'Sign in first.' };
      }
      set({ ...status, waiting: true });
      setTimeout(() => {
        if (status.state === 'subscribe' && status.waiting) {
          keep({ state: 'setting-up', email: EMAIL, firstDevice: start !== 'link' });
        } else if (status.state === 'paused' && status.waiting) keep(ON);
      }, 2500);
      return { ok: true };
    },
    linkApprovals: async () => approvals,
    onLinkApprovals: (viewer) => {
      viewers.add(viewer);
      return () => viewers.delete(viewer);
    },
    askToLink: async () => {
      if (approve === 'stale') {
        show({ asking: { step: 'stale' } });
        return { ok: false, message: 'This device signed in a while ago.' };
      }
      if (approvals.asking && approvals.asking.step !== 'ended') return { ok: true };
      if (approve === 'check') {
        show({ asking: offered });
        return { ok: true };
      }
      show({ asking: { step: 'waiting' } });
      if (approve !== 'quiet') {
        setTimeout(() => {
          if (approvals.asking?.step === 'waiting') show({ asking: offered });
        }, 3000);
      }
      return { ok: true };
    },
    confirmLinkCheck: (matched) => {
      if (approvals.asking?.step !== 'check') return;
      if (!matched) {
        show({
          asking: {
            step: 'ended',
            message: 'Nothing was linked. If you didn’t start this, you can ignore it.',
            check: CHECK,
          },
        });
        return;
      }
      show({ asking: { ...approvals.asking, confirmed: true } });
      setTimeout(() => {
        show({ asking: null });
        keep(ON);
      }, 2500);
    },
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
      const request = approvals.requests.find((each) => each.id === id);
      show({
        requests: approvals.requests.filter((each) => each.id !== id),
        turnedDown: request ? { id, device: request.device } : null,
      });
      return { ok: true };
    },
    signOutTurnedDown: async () => {
      show({ turnedDown: null });
      return { ok: true };
    },
    dismissLinkApproval: () =>
      show({
        approving: approvals.approving?.step === 'ended' ? null : approvals.approving,
        turnedDown: null,
      }),
  };
}
