import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AccountInfo,
  type AccountKeys,
  accountKeys,
  type Bytes,
  CLIENTS,
  DeviceSignIn,
  fromBase64Url,
  linkId,
  lockForLink,
  lockWithRecoveryKey,
  newAccountKey,
  newLinkCode,
  newRecoveryKey,
  openLink,
  openWithRecoveryKey,
  readLinkCode,
  readRecoveryKey,
  type SyncAccess,
  SyncClient,
  SyncError,
  toBase64Url,
} from '@factwright/sync';
import type { EditResult } from '../../shared/api.ts';
import type {
  AccountResult,
  ApprovalsView,
  ConnectResult,
  LinkCodeResult,
  RecoveryKeyResult,
  ServerTerms,
  SyncActivity,
  SyncStatus,
} from '../../shared/sync.ts';
import type { Tracker } from '../jobs/tracker.ts';
import { Approvals } from './approvals.ts';
import { type ClaimsSync, claimNotes } from './claims.ts';
import { computerName, userAgent } from './device.ts';
import { SyncEngine } from './engine.ts';
import { LoopbackFlow } from './loopback.ts';
import { adoptGainedColumns, adoptGainedTables } from './rows.ts';
import { SyncRunner } from './runner.ts';
import { type Keychain, NO_KEYCHAIN_MESSAGE, Secrets } from './secrets.ts';
import {
  askSignInOptions,
  checkServer,
  readServerAddress,
  type SyncServer,
  termsOf,
} from './server.ts';
import { SyncState } from './state.ts';

export interface SyncAccountDeps {
  /** The app's data folder. Sync keeps its notes and secrets in a folder there. */
  dataDir: string;
  /**
   * Factwright's own sync server, built into this copy, such as "https://app.factwright.com", or
   * null in a copy built without it, as copies built anywhere but Factwright's own releases are.
   * Either can sync with a server of your own instead, connected in the sync dialog.
   */
  server: string | null;
  /** The app's version, which it tells the server. */
  version: string;
  keychain: Keychain;
  tracker: Tracker;
  workspace: string;
  /** Opens a page in the user's browser. */
  openUrl: (url: string) => void | Promise<void>;
  onStatus: (status: SyncStatus) => void;
  /** Whenever linking by approval changes: this computer asking, or other devices' requests. */
  onApprovals?: (view: ApprovalsView) => void;
  /**
   * The sync accounts other profiles on this computer use, by email and server (a server of your
   * own's address, or null for Factwright's), with each one's name. Signing in to one of them is
   * turned away, so two people's job hunts never mix.
   */
  otherProfiles?: () => { name: string; email: string; server: string | null }[];
  /** After changes from other devices land, so the window shows them. */
  onApplied: () => void;
  computerName?: () => Promise<string>;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests: how sign-in waits between asking whether the user approved. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** For tests: how linking by approval waits between looks at the other device. */
  approvalWait?: (ms: number) => Promise<void>;
  /** For tests: how subscribing waits between looks at the account. */
  subscriptionWait?: (ms: number) => Promise<void>;
}

const failed = (message: string) => ({ ok: false as const, message });

/** What a step says when another sign-in, or closing the app, overtook it: it does nothing more. */
const OVERTAKEN = failed('Signing in was canceled.');

/** What signing in to Factwright's sync says in a copy built without it. */
const NO_SERVER = 'This copy of Factwright doesn’t have Factwright’s sync.';

/** What connecting a server of your own says while sync is set up with another. */
const SWITCH_FIRST = 'Turn off sync on this computer first, then connect your server.';

/** Notes a sign-in that hasn't been checked against the account's key on the server yet. */
const UNCHECKED = 'unchecked';

/**
 * Notes the server of your own that what sync knows of the account's history came from. Missing
 * for Factwright's own, as it was before there were others.
 */
const SERVER = 'server';

/**
 * Notes that sync stopped here because the account doesn't have sync, where it's sold, so it stays
 * stopped after a restart until it has: "again" once its subscription ended, or "first" for one
 * that never had a subscription, such as when free sync was taken back.
 */
const PAUSED = 'paused';

/** How often a paused computer asks whether the account has sync again, besides on coming back. */
const PAUSED_EVERY_MS = 30 * 60_000;
/** How soon coming back to the app may ask again. */
const PAUSED_AGAIN_MS = 60_000;

/** How often, at most, a round of sync also looks for other devices' requests to link. */
const REQUESTS_EVERY_MS = 60_000;

/**
 * How often, at most, a round of sync also asks how the account has sync, where it's sold, for a
 * payment that didn't go through. Running out shows sooner, as the server turns sync down.
 */
const ACCESS_EVERY_MS = 60 * 60_000;

/**
 * Once the browser opens to subscribe: how often the app asks whether the account has sync, every
 * few seconds at first, then less often, until checkout would have closed.
 */
const SUBSCRIBE_QUICK_MS = 3000;
const SUBSCRIBE_QUICKLY_FOR_MS = 2 * 60_000;
const SUBSCRIBE_SLOW_MS = 10_000;
const SUBSCRIBE_FOR_MS = 40 * 60_000;

/** How many times, and how far apart, linking with an approved key is tried while offline. */
const KEY_TRIES = 12;
const KEY_RETRY_MS = 5000;

/** A sign-in kept here: the server it's with, and its token until it ends. */
interface Kept {
  server: SyncServer;
  token: string | null;
}

/**
 * A sign-in to a server of your own, as kept: the server's address, locked in with its token, so
 * the token only ever goes there. Once it ends, the address stays, to sign in to again.
 */
function readOwnSession(text: string | null): Kept | null {
  if (text === null) return null;
  let kept: { server?: unknown; token?: unknown };
  try {
    kept = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof kept?.server !== 'string') return null;
  const address = readServerAddress(kept.server);
  if (!address.ok || address.server !== kept.server) return null;
  return {
    server: { url: address.server, own: true },
    token: typeof kept.token === 'string' && kept.token ? kept.token : null,
  };
}

/** What to tell the user when a request to the server fails. */
function reason(error: unknown): string {
  if (error instanceof SyncError) {
    if (error.kind === 'offline')
      return 'Can’t reach the sync server. Check your connection, then try again.';
    if (error.kind === 'signed-out') return 'Your sign-in ended. Sign in again.';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sync on this computer, from start to finish: signing in through the browser, setting up the
 * account key (with a recovery key on the first device, or from another device or the recovery
 * key on the rest), running sync in the background, adding devices, and turning it off.
 */
export class SyncAccount {
  private readonly deps: SyncAccountDeps;
  private readonly secrets: Secrets;
  private readonly state: SyncState;
  private current: SyncStatus = { state: 'off' };
  /** Whether where sync stands is known yet, once it has picked up where it left off. */
  private known = false;
  private client: SyncClient | null = null;
  private keys: AccountKeys | null = null;
  private accountKey: Bytes | null = null;
  private runner: SyncRunner | null = null;
  /**
   * A sign-in waiting for the browser: with a device code to Factwright's sync, or back on this
   * computer, with no code, to a server of your own.
   */
  private signIn: DeviceSignIn | LoopbackFlow | null = null;
  /** The account key made for a first device, kept until its recovery key is saved. */
  private pending: { accountKey: Bytes; recovery: Bytes } | null = null;
  private device = 'This computer';
  /** Once the app is closing, nothing more happens. */
  private closed = false;
  /** Linking devices by approval: this computer asking, and approving others. */
  private readonly approvals: Approvals;
  /** When a round of sync last looked for requests to link. */
  private requestsLooked = 0;
  /**
   * The server sync is with here: the one whose sign-in or account key this computer keeps. Null
   * once sync is turned off here, and before it's ever on.
   */
  private kept: SyncServer | null = null;
  /** The server a sign-in that's waiting for the browser is with. */
  private signingInTo: SyncServer | null = null;
  /** Each server's terms and price, as its sign-in options say, asked once while the app runs. */
  private readonly terms = new Map<string, Promise<ServerTerms | null>>();
  /**
   * Counts sign-ins started and called off, so connecting a server whose check took a while does
   * nothing more once another sign-in, or going back, overtook it.
   */
  private attempts = 0;
  /** Counts waits for the account to have sync, so only the latest one carries on. */
  private waits = 0;
  /** Whether sync is carrying on now that the account has sync, so it carries on once. */
  private carrying = false;
  /** The account that subscribes, by its ID, which the page for subscribing checks it's signed in as. */
  private subscriber: string | null = null;
  /** When a round of sync last asked how the account has sync. */
  private accessLooked = 0;
  /** Where sync is sold: whether a renewal's payment didn't go through, as the server last said. */
  private paymentFailed = false;
  /**
   * Counts each time sync pauses or carries on, so an answer about the account asked for before
   * then says nothing: it may be from before the account had sync, or lost it.
   */
  private accessEpoch = 0;
  /** The round a pause stopped, which sync waits out before it runs again. */
  private stopping: Promise<void> | null = null;
  /** Asks a paused computer's account again now and then, and when it last asked. */
  private pausedTimer: ReturnType<typeof setInterval> | undefined;
  private pausedLooked = 0;

  constructor(deps: SyncAccountDeps) {
    this.deps = deps;
    this.approvals = new Approvals({
      onChange: (view) => {
        if (!this.closed) this.deps.onApprovals?.(view);
      },
      accountKey: () => (this.runner ? this.accountKey : null),
      keyId: () => (this.runner ? (this.keys?.id ?? null) : null),
      linkWith: (accountKey) => this.linkWithKey(accountKey),
      signedOut: () => this.signedOutElsewhere(),
      reason: (error) => {
        this.subscriptionNeeded(error);
        return reason(error);
      },
      ...(deps.approvalWait && { wait: deps.approvalWait }),
    });
    const folder = join(deps.dataDir, 'sync');
    mkdirSync(folder, { recursive: true });
    this.secrets = new Secrets(join(folder, 'secrets.json'), deps.keychain);
    this.state = new SyncState(join(folder, 'sync.db'));
    // Before anything changes the tracker: columns an update added take what was synced, and
    // tables it added get what other devices sent before.
    adoptGainedColumns(deps.tracker, this.state);
    adoptGainedTables(deps.tracker, this.state);
  }

  status(): SyncStatus {
    return this.current;
  }

  private set(status: SyncStatus): void {
    if (this.closed) return;
    this.known = true;
    this.current = this.named(status);
    this.deps.onStatus(this.current);
  }

  /**
   * A status as the window shows it, naming the server of your own it's with, if it's one: the
   * one a sign-in is waiting on, or else the one kept here.
   */
  private named(status: SyncStatus): SyncStatus {
    if (status.state === 'off' || status.state === 'unavailable' || status.state === 'no-server') {
      return status;
    }
    const { ownServer: _, ...rest } = status;
    const server = status.state === 'signing-in' ? this.signingInTo : this.kept;
    return server?.own ? { ...rest, ownServer: server.url } : rest;
  }

  private email(): string {
    return this.state.meta('email') ?? '';
  }

  /** Factwright's own sync server, when this copy has it. */
  private factwright(): SyncServer | null {
    return this.deps.server ? { url: new URL(this.deps.server).origin, own: false } : null;
  }

  /**
   * The sync server, for the steps past signing in. Only a sign-in that's kept gets that far, so
   * there's always one.
   */
  private server(): string {
    if (!this.kept) throw new Error('Sign in first.');
    return this.kept.url;
  }

  /**
   * The sign-in kept here, or null when there's none, or it can't be read. What's kept for
   * Factwright's own server is kept as it was before there were others, and a server of your own's
   * apart from it. If both are kept, Factwright's is the newer: only a version from before then,
   * which knows nothing of the other, writes it while the other is kept.
   */
  private keptSignIn(): Kept | null {
    if (this.keptForFactwright()) {
      const factwright = this.factwright();
      return factwright && { server: factwright, token: this.secrets.get('session') };
    }
    return readOwnSession(this.secrets.get('ownSession'));
  }

  /**
   * Whether what's kept here is for Factwright's own server, told without asking the keychain:
   * its sign-in, or its account key.
   */
  private keptForFactwright(): boolean {
    return this.secrets.has('session') || this.secrets.has('accountKey');
  }

  /** The secret a server's account key is kept as. */
  private keyFor(server: SyncServer): 'accountKey' | 'ownAccountKey' {
    return server.own ? 'ownAccountKey' : 'accountKey';
  }

  /** Whether what's kept here is for Factwright's own server, in a copy without it. */
  private keptForAnotherCopy(): boolean {
    return !this.deps.server && this.keptForFactwright();
  }

  /**
   * Keeps a new sign-in, in place of whatever was kept for another server: one to Factwright's
   * own server as its token alone, as before there were others, and one to a server of your own
   * with its address.
   */
  private keepSession(server: SyncServer, token: string): void {
    if (server.own) {
      this.secrets.delete('session');
      this.secrets.delete('accountKey');
      this.secrets.set('ownSession', JSON.stringify({ server: server.url, token }));
    } else {
      this.secrets.delete('ownSession');
      this.secrets.delete('ownAccountKey');
      this.secrets.set('session', token);
    }
    this.kept = server;
  }

  /** Ends the sign-in kept here. A server of your own's address stays, to sign in to again. */
  private endSession(): void {
    if (this.kept?.own) this.secrets.set('ownSession', JSON.stringify({ server: this.kept.url }));
    else this.secrets.delete('session');
  }

  /** The kept sign-in's token, while it lasts. */
  private token(): string | null {
    return this.kept?.own
      ? (readOwnSession(this.secrets.get('ownSession'))?.token ?? null)
      : this.secrets.get('session');
  }

  /**
   * Ties what sync knows of the account's history to the server it's with. Notes from another
   * server, such as ones a version from before there were others left, start over, and an account
   * key kept with them is checked against this server's account before anything syncs.
   */
  private tieState(server: SyncServer): void {
    const own = server.own ? server.url : null;
    if (this.state.meta(SERVER) === own) return;
    this.state.clear();
    if (own) this.state.setMeta(SERVER, own);
    this.state.setMeta(UNCHECKED, '1');
  }

  /** Takes up a sign-in, or none. Linking by approval follows it. */
  private useClient(client: SyncClient | null): void {
    this.client = client;
    this.approvals.use(client);
  }

  private clientFor(server: SyncServer, token: string): SyncClient {
    return new SyncClient({
      server: server.url,
      token: () => token,
      headers: { 'user-agent': userAgent(this.deps.version, this.device) },
      ...(this.deps.fetch && { fetch: this.deps.fetch }),
    });
  }

  /** Picks up where sync left off when the app last closed. */
  async start(): Promise<void> {
    this.device = await (this.deps.computerName ?? computerName)();
    // With sync never turned on here, the keychain isn't asked anything.
    if (!this.secrets.exists()) {
      this.set({ state: 'off' });
      return;
    }
    // Sync with Factwright's own server, in a copy without it, such as one built from the code on
    // the data folder of one from factwright.com, stays as that copy left it, unasked.
    if (this.keptForAnotherCopy()) {
      this.set({ state: 'no-server' });
      return;
    }
    if (!this.secrets.available()) {
      this.set({ state: 'unavailable' });
      return;
    }
    const kept = this.keptSignIn();
    if (!kept) {
      this.set({ state: 'off' });
      return;
    }
    this.kept = kept.server;
    // What's kept for a server of your own alongside Factwright's is the older, so it goes.
    if (!kept.server.own && (this.secrets.has('ownSession') || this.secrets.has('ownAccountKey'))) {
      this.secrets.delete('ownSession');
      this.secrets.delete('ownAccountKey');
    }
    this.tieState(kept.server);
    const { token } = kept;
    if (!token) {
      // A server of your own stays the one to sign in to again, until sync is turned off here.
      this.set(kept.server.own ? { state: 'signed-out', email: this.email() } : { state: 'off' });
      return;
    }
    const client = this.clientFor(kept.server, token);
    this.useClient(client);
    const saved = this.secrets.get(this.keyFor(kept.server));
    const accountKey = saved ? fromBase64Url(saved) : null;
    if (accountKey) {
      // Signed in again, or stopped by a check, and not yet checked against the account, such as
      // when the app quit while asking for a new recovery key: it's checked before anything syncs.
      const paused = this.state.meta(PAUSED);
      if (this.state.meta(UNCHECKED) === '1') await this.resume(accountKey);
      else if (paused === 'again' || paused === 'first')
        this.openPaused(client, paused === 'again');
      else await this.turnOnWith(client, accountKey);
      return;
    }
    await this.checkSetup();
  }

  /**
   * Opens paused, as sync was when the app closed, then asks whether the account has sync again,
   * such as after subscribing on the web, to carry on by itself.
   */
  private openPaused(client: SyncClient, again: boolean): void {
    this.subscriber = this.state.meta('account');
    this.set({ state: 'paused', email: this.email(), again, waiting: false });
    this.watchPaused(client);
    this.lookAtAccess(client);
  }

  /**
   * Asks how the account has sync, and notes it, unless sync paused or carried on meanwhile. A
   * sign-in that's ended is noted too, as nothing else asks the server while sync is paused.
   */
  private lookAtAccess(client: SyncClient): void {
    const epoch = this.accessEpoch;
    client.account().then(
      (account) => this.noteAccess(client, account.access, epoch),
      (error: unknown) => {
        if (error instanceof SyncError && error.kind === 'signed-out' && !this.overtaken(client)) {
          this.signedOutElsewhere();
        }
      },
    );
  }

  /**
   * While sync is paused here, asks the account now and then whether it has sync again, such as
   * after subscribing from another device, so sync carries on by itself.
   */
  private watchPaused(client: SyncClient): void {
    clearInterval(this.pausedTimer);
    this.pausedTimer = setInterval(() => {
      if (this.closed || this.overtaken(client) || this.current.state !== 'paused') {
        clearInterval(this.pausedTimer);
        return;
      }
      this.lookWithoutSync(true);
    }, PAUSED_EVERY_MS);
  }

  /**
   * On coming back to the app, or the computer waking: a computer that's paused, or waiting to
   * subscribe, asks the account whether it has sync now, at most once a minute, as it may have
   * subscribed from another device meanwhile.
   */
  lookAgain(): void {
    this.lookWithoutSync(false);
  }

  private lookWithoutSync(now: boolean): void {
    const client = this.client;
    const status = this.current;
    if (!client || (status.state !== 'paused' && status.state !== 'subscribe')) return;
    // While it waits for the browser, it's asking every few seconds anyway.
    if (status.waiting) return;
    if (!now && Date.now() - this.pausedLooked < PAUSED_AGAIN_MS) return;
    this.pausedLooked = Date.now();
    this.lookAtAccess(client);
  }

  /**
   * Signed in without the account key: is this the first device, or does it link to others? Where
   * sync is sold, an account without it subscribes first. When the server can't say, it links, or
   * with `staying`, as when carrying on once the account has sync, stays where it is, to ask again.
   */
  private async checkSetup(staying = false): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const account = await client.account();
      if (this.overtaken(client)) return;
      this.state.setMeta('account', account.user.id);
      this.state.setMeta('email', account.user.email);
      if (account.access && !account.access.allowed) {
        this.toSubscribe(account, account.access);
        return;
      }
      const keys = await client.keys();
      if (this.overtaken(client)) return;
      this.set({ state: 'setting-up', email: account.user.email, firstDevice: keys === null });
    } catch (error) {
      if (this.overtaken(client)) return;
      if (error instanceof SyncError && error.kind === 'signed-out') await this.forget();
      else if (!staying) this.set({ state: 'setting-up', email: this.email(), firstDevice: false });
    }
  }

  /**
   * Whether what began with this sign-in was overtaken, by closing the app or by another sign-in,
   * so it changes nothing more: a late answer never lands on the sign-in that came after.
   */
  private overtaken(client: SyncClient): boolean {
    return this.closed || this.client !== client;
  }

  /**
   * Signs in through the browser: to the server sync is with here, to sign in again, or else to
   * Factwright's own. A server of your own is checked first, as connecting it was, as it may
   * need an update for this version to sign in to it.
   */
  async signInWithBrowser(): Promise<ConnectResult> {
    const server = this.kept ?? this.factwright();
    if (!server) return failed(NO_SERVER);
    const attempt = ++this.attempts;
    if (server.own && this.secrets.available()) {
      const checked = await checkServer(server.url, this.deps.fetch ?? fetch);
      // Going back, another sign-in, or turning sync off here while it was checked calls it off.
      if (this.closed || attempt !== this.attempts || this.kept !== server) return OVERTAKEN;
      if (!checked.ok) return checked;
    }
    return this.signInTo(server);
  }

  /**
   * Connects a server of your own, by the address typed in the sync dialog: checks it, then signs
   * in to it as signInWithBrowser does. Only while sync is off here: switching servers means
   * turning it off on this computer first. Factwright's own address is Factwright's sync.
   */
  async connect(typed: string): Promise<ConnectResult> {
    const address = readServerAddress(typed);
    if (!address.ok) return failed(address.message);
    if (this.current.state !== 'off') return failed(SWITCH_FIRST);
    if (this.factwright()?.url === address.server) return this.signInWithBrowser();
    if (!this.secrets.available()) {
      this.set({ state: 'unavailable' });
      return failed(NO_KEYCHAIN_MESSAGE);
    }
    const attempt = ++this.attempts;
    const checked = await checkServer(address.server, this.deps.fetch ?? fetch);
    // Going back, or another sign-in, while it was checked calls it off.
    if (this.closed || attempt !== this.attempts || this.current.state !== 'off') return OVERTAKEN;
    if (!checked.ok) return checked;
    this.terms.set(address.server, Promise.resolve(termsOf(checked.options)));
    return this.signInTo({ url: address.server, own: true });
  }

  /**
   * Signs in to a server through the browser: opens the page, and waits for the user. To
   * Factwright's sync, it shows a code to check there. A server of your own sends the browser back
   * to the app, on this computer, with no code: a code it showed could be one it got from
   * Factwright's sync and passed along, for the person to allow there, while the answer that comes
   * back names the server that gave it (LoopbackFlow).
   */
  private async signInTo(server: SyncServer): Promise<EditResult> {
    if (!this.secrets.available()) {
      this.set({ state: 'unavailable' });
      return failed(NO_KEYCHAIN_MESSAGE);
    }
    this.signIn?.cancel();
    const before: SyncStatus =
      this.current.state === 'signing-in' ? { state: 'off' } : this.current;
    const named = userAgent(this.deps.version, this.device);
    const flow = server.own
      ? new LoopbackFlow({
          server: server.url,
          userAgent: named,
          ...(this.deps.fetch && { fetch: this.deps.fetch }),
        })
      : new DeviceSignIn({
          server: server.url,
          clientId: CLIENTS.desktop,
          userAgent: named,
          ...(this.deps.fetch && { fetch: this.deps.fetch }),
          ...(this.deps.sleep && { sleep: this.deps.sleep }),
        });
    this.signIn = flow;
    // Another sign-in, or closing the app, took over: that says how things stand.
    const overtaken = () => this.closed || this.signIn !== flow;
    // A sign-in this one took over from is over too, so its code isn't left showing.
    const stop = (message: string) => {
      this.signIn = null;
      if (this.current.state === 'signing-in') this.set(before);
      return failed(message);
    };
    let pending: { code: string | null; url: string };
    try {
      pending = await flow.start();
    } catch (error) {
      if (overtaken()) return OVERTAKEN;
      return stop(reason(error));
    }
    if (overtaken()) return OVERTAKEN;
    if (flow.canceled) return stop(OVERTAKEN.message);
    // Only the sync server's own pages open: never another site, or a file on this computer.
    if (new URL(pending.url).origin !== server.url) {
      flow.cancel();
      return stop('The sync server sent a sign-in page somewhere else. Try again later.');
    }
    this.signingInTo = server;
    this.set({ state: 'signing-in', code: pending.code, url: pending.url });
    try {
      await this.deps.openUrl(pending.url);
    } catch {
      // A browser that didn't open leaves the link to copy, so signing in waits all the same.
    }
    if (overtaken()) return OVERTAKEN;
    const result = await flow.finish();
    if (overtaken()) {
      // A sign-in that's dropped is ended, so it isn't left signed in on the server.
      if (result.ok) void this.signOutOnServer(server, result.token);
      return result.ok ? OVERTAKEN : failed(result.message);
    }
    if (!result.ok) {
      this.signIn = null;
      this.set(before);
      return failed(result.message);
    }
    // Before anything is kept: an account another profile here uses stays that profile's.
    const taken = await this.usedByAnotherProfile(server, result.token);
    if (overtaken()) {
      void this.signOutOnServer(server, result.token);
      return OVERTAKEN;
    }
    this.signIn = null;
    if (taken || flow.canceled) {
      this.set(before);
      await this.signOutOnServer(server, result.token);
      return failed(taken ?? 'Signing in was canceled.');
    }
    // What's kept for another server goes first: its account key and its notes are no use here.
    if (this.kept && this.kept.url !== server.url) await this.forgetAll();
    this.tieState(server);
    const saved = this.secrets.get(this.keyFor(server));
    const accountKey = saved ? fromBase64Url(saved) : null;
    // Noted before the new sign-in is kept, so it's never kept unchecked.
    if (accountKey) this.state.setMeta(UNCHECKED, '1');
    this.keepSession(server, result.token);
    this.useClient(this.clientFor(server, result.token));
    if (!accountKey) {
      await this.checkSetup();
      return { ok: true };
    }
    return this.resume(accountKey);
  }

  /**
   * Why a new sign-in can't be kept, when another profile on this computer syncs with the same
   * account, or null when it can. A browser that's signed in as one person approves another's
   * code without asking who's there, so this is where two job hunts would otherwise mix. When
   * the account can't be asked, it isn't kept either.
   */
  private async usedByAnotherProfile(server: SyncServer, token: string): Promise<string | null> {
    const own = server.own ? server.url : null;
    const others = (this.deps.otherProfiles?.() ?? []).filter((each) => each.server === own);
    if (others.length === 0) return null;
    let email: string;
    try {
      email = (await this.clientFor(server, token).account()).user.email;
    } catch (error) {
      return reason(error);
    }
    const other = others.find((each) => each.email.toLowerCase() === email.toLowerCase());
    return other
      ? `The profile “${other.name}” on this computer syncs with that account, and each profile needs its own. If your browser signed in as someone else, sign out of Factwright there first.`
      : null;
  }

  /**
   * After signing in again with the account key this computer kept: nothing syncs until the
   * account's key on the server says what to do. Until then the sign-in stays unchecked, so a
   * restart asks again.
   * - The same key: sync carries on.
   * - No key: the account is new, or was deleted and made again. This computer makes a new
   *   account key and recovery key, as a first device does, so the old ones, which a lost or
   *   stolen device may still hold, open nothing of it.
   * - Another key: the account isn't this computer's to sync with until it links, and linking
   *   adds this computer's job hunt to it. Nothing goes up before that.
   * Where sync is sold, an account without it pauses with the same key, and subscribes first
   * otherwise. When the server can't be asked, sign-in says why, and nothing syncs. With
   * `staying`, as when carrying on once the account has sync, a request that didn't get through
   * leaves things as they are, to ask again: only a sign-in that's ended says to sign in.
   */
  private async resume(accountKey: Bytes, staying = false): Promise<EditResult> {
    const client = this.client;
    if (!client) return failed('Sign in first.');
    let account: Awaited<ReturnType<SyncClient['account']>>;
    let saved: Awaited<ReturnType<SyncClient['keys']>>;
    try {
      [account, saved] = await Promise.all([client.account(), client.keys()]);
    } catch (error) {
      if (this.overtaken(client)) return OVERTAKEN;
      const ended = error instanceof SyncError && error.kind === 'signed-out';
      if (ended) {
        this.endSession();
        this.useClient(null);
      }
      if (ended || !staying) this.set({ state: 'signed-out', email: this.email() });
      return failed(reason(error));
    }
    const keyId = (await accountKeys(accountKey)).id;
    if (this.overtaken(client)) return OVERTAKEN;
    this.pending = null;
    const email = account.user.email;
    // Where sync is sold, an account without it subscribes before this computer sets up again. One
    // that's set up here with the account's key pauses, as below.
    const { access } = account;
    const paused = access !== undefined && !access.allowed;
    if (paused && saved?.keyId !== keyId) {
      this.toSubscribe(account, access);
      return { ok: true };
    }
    if (saved === null) {
      this.set({ state: 'setting-up', email, firstDevice: true, again: 'remade' });
      return { ok: true };
    }
    if (saved.keyId !== keyId) {
      // Linking again, to the account this computer was syncing, or to another one.
      const synced = this.state.meta('account') === account.user.id;
      this.set({
        state: 'setting-up',
        email,
        firstDevice: false,
        ...(synced && { again: 'changed' as const }),
      });
      return { ok: true };
    }
    // The same key. A key belongs to the one account it was made for, so this is the account
    // sync knows, unless it noted another, which starts over. One that never noted its account
    // just notes it, so edits made while signed out sync as edits, not as conflicts.
    const before = this.state.meta('account');
    if (before !== null && before !== account.user.id) this.startOver();
    this.state.setMeta('account', account.user.id);
    this.state.setMeta('email', account.user.email);
    await this.turnOnWith(client, accountKey, paused ? access : undefined);
    return { ok: true };
  }

  /** Forgets what sync knew of the account's history, keeping who's signed in, and where. */
  private startOver(): void {
    const email = this.email();
    const account = this.state.meta('account');
    const unchecked = this.state.meta(UNCHECKED);
    const server = this.state.meta(SERVER);
    this.state.clear();
    this.state.setMeta('email', email);
    if (account !== null) this.state.setMeta('account', account);
    if (unchecked !== null) this.state.setMeta(UNCHECKED, unchecked);
    if (server !== null) this.state.setMeta(SERVER, server);
  }

  /**
   * Signed in with an account this computer shouldn't sync with: ends that sign-in only. The
   * account key this computer has, and what sync knows, stay for the right account.
   */
  async useDifferentAccount(): Promise<EditResult> {
    // A copy without Factwright's sync leaves what that sync kept here as it is: that's a copy
    // with it's, such as one installed that shares this data folder.
    if (this.keptForAnotherCopy()) return failed(NO_SERVER);
    // Nor does a copy without the keychain change secrets it can't open.
    if (!this.secrets.available()) return failed(NO_KEYCHAIN_MESSAGE);
    const server = this.kept;
    const token = this.token();
    // First, so a step still waiting on the server for this sign-in does nothing more.
    this.useClient(null);
    this.pending = null;
    await this.runner?.stop();
    this.runner = null;
    this.endSession();
    if (server && token) await this.signOutOnServer(server, token);
    // A server of your own stays the one to sign in to again, as does Factwright's while this
    // computer has its account key. With neither, nothing here is for a server any more.
    if (server && (server.own || this.secrets.get(this.keyFor(server)))) {
      this.set({ state: 'signed-out', email: this.email() });
    } else {
      this.kept = null;
      this.secrets.clear();
      this.set({ state: 'off' });
    }
    return { ok: true };
  }

  /**
   * Stops waiting for the browser, or for a server of your own's check. Sync goes back to where
   * it stood.
   */
  cancelSignIn(): void {
    this.attempts++;
    this.signIn?.cancel();
  }

  /** On the first device: makes the account key and its recovery key, to save before going on. */
  async newRecoveryKey(): Promise<RecoveryKeyResult> {
    if (this.current.state !== 'setting-up') return failed('Sign in first.');
    const recovery = newRecoveryKey();
    this.pending = {
      accountKey: this.pending?.accountKey ?? newAccountKey(),
      recovery: recovery.bytes,
    };
    return { ok: true, recoveryKey: recovery.text };
  }

  /** On the first device, once the recovery key is saved: turns sync on. */
  async turnOn(): Promise<EditResult> {
    const client = this.client;
    if (!client || !this.pending) return failed('Make your recovery key first.');
    const { accountKey, recovery } = this.pending;
    try {
      const keys = await accountKeys(accountKey);
      const locked = await lockWithRecoveryKey(accountKey, recovery);
      if (this.overtaken(client)) return OVERTAKEN;
      const saved = await client.saveKeys(keys.id, locked);
      if (this.overtaken(client)) return OVERTAKEN;
      if (saved === 'taken') {
        this.pending = null;
        this.set({ state: 'setting-up', email: this.email(), firstDevice: false, again: 'taken' });
        return failed(
          'Another device turned on sync for this account first. Link this computer to it instead.',
        );
      }
    } catch (error) {
      this.subscriptionNeeded(error);
      return failed(reason(error));
    }
    this.pending = null;
    await this.turnOnWith(client, accountKey);
    return { ok: true };
  }

  /** On another device: takes the account key from a link code shown on a device that's set up. */
  async linkWithCode(text: string): Promise<EditResult> {
    const code = readLinkCode(text);
    if (!code) return failed('That isn’t a link code. It’s 32 letters and numbers.');
    const client = this.client;
    if (!client) return failed('Sign in first.');
    try {
      const data = await client.takeLink(await linkId(code));
      const accountKey = data && (await openLink(data, code));
      if (this.overtaken(client)) return OVERTAKEN;
      if (!accountKey) {
        return failed(
          'That code didn’t work. It lasts 10 minutes: make a new one on your other device.',
        );
      }
      return await this.checkAndTurnOn(client, accountKey);
    } catch (error) {
      this.subscriptionNeeded(error);
      return failed(reason(error));
    }
  }

  /**
   * A request the server turned down because the account can't sync now, where sync is sold: a
   * computer that's set up pauses, and one setting up subscribes first.
   */
  private subscriptionNeeded(error: unknown): void {
    if (!(error instanceof SyncError && error.kind === 'subscription-needed')) return;
    if (this.current.state === 'on') this.pause();
    else if (this.current.state === 'setting-up') void this.checkSetup();
  }

  /** On another device, or after losing every device: unlocks the account key with the recovery key. */
  async useRecoveryKey(text: string): Promise<EditResult> {
    const recovery = readRecoveryKey(text);
    if (!recovery) return failed('That isn’t a recovery key. It’s 32 letters and numbers.');
    const client = this.client;
    if (!client) return failed('Sign in first.');
    try {
      const keys = await client.keys();
      if (!keys) return failed('No device has turned on sync for this account yet.');
      const accountKey = await openWithRecoveryKey(keys.recovery, recovery);
      if (this.overtaken(client)) return OVERTAKEN;
      if (!accountKey)
        return failed('That recovery key doesn’t open this account. Check it, and try again.');
      return await this.checkAndTurnOn(client, accountKey);
    } catch (error) {
      return failed(reason(error));
    }
  }

  /**
   * On another device: takes the account key a device that's set up approved this one with. The
   * key was picked up once and won't come again, so a dropped connection is waited out.
   */
  private async linkWithKey(accountKey: Bytes): Promise<EditResult> {
    const client = this.client;
    if (!client) return failed('Sign in first.');
    for (let tries = 1; ; tries++) {
      try {
        return await this.checkAndTurnOn(client, accountKey);
      } catch (error) {
        const offline = error instanceof SyncError && error.kind === 'offline';
        if (!offline || tries >= KEY_TRIES || this.overtaken(client)) return failed(reason(error));
        await new Promise((resolve) => setTimeout(resolve, KEY_RETRY_MS));
      }
    }
  }

  /**
   * The server says this sign-in has ended, such as when another device signed it out. As when
   * signing in again finds that, the session goes, and sync says to sign in again.
   */
  private signedOutElsewhere(): void {
    if (this.closed || !this.client) return;
    void this.runner?.stop();
    this.runner = null;
    this.useClient(null);
    this.endSession();
    this.set({ state: 'signed-out', email: this.email() });
  }

  /** Turns sync on with an account key, once it's the one the account uses. */
  private async checkAndTurnOn(client: SyncClient, accountKey: Bytes): Promise<EditResult> {
    const keys = await client.keys();
    const keyId = (await accountKeys(accountKey)).id;
    if (this.overtaken(client)) return OVERTAKEN;
    if (!keys) return failed('No device has turned on sync for this account yet.');
    if (keys.keyId !== keyId) return failed('That key belongs to a different account.');
    // Linked, so a request to be approved, if this computer asked, is called off.
    this.approvals.stopAsking();
    await this.turnOnWith(client, accountKey);
    return { ok: true };
  }

  /**
   * Turns sync on with an account key, once it's the one the account uses. Where sync is sold, an
   * account without it (`noSync`, how it has sync) keeps the key, and sync pauses until it has.
   */
  private async turnOnWith(
    client: SyncClient,
    accountKey: Bytes,
    noSync?: SyncAccess,
  ): Promise<void> {
    const keys = await accountKeys(accountKey);
    if (this.overtaken(client)) return;
    // Another account's data must never mix in: a different key starts over.
    if (this.state.meta('keyId') !== keys.id) this.startOver();
    this.state.setMeta('keyId', keys.id);
    this.state.setMeta(UNCHECKED, '0');
    if (this.kept) this.secrets.set(this.keyFor(this.kept), toBase64Url(accountKey));
    if (noSync) {
      this.pause(noSync);
      return;
    }
    this.state.setMeta(PAUSED, '0');
    this.accountKey = accountKey;
    this.keys = keys;
    await this.runner?.stop();
    // A round a pause stopped is waited out too, so two rounds never run at once.
    await this.stopping;
    this.stopping = null;
    if (this.overtaken(client)) return;
    const engine = new SyncEngine({
      client,
      keys,
      state: this.state,
      tracker: this.deps.tracker,
      workspace: this.deps.workspace,
      device: this.device,
    });
    let skipped = 0;
    let lastSynced: string | null = null;
    this.set(this.on('syncing', lastSynced, null, skipped));
    let checked = false;
    // A runner that's been stopped or replaced speaks for nothing.
    const runner: SyncRunner = new SyncRunner({
      engine,
      client,
      state: this.state,
      onReport: (report) => {
        if (this.closed || this.runner !== runner) return;
        skipped = report.skipped.length;
        lastSynced = new Date().toISOString();
        if (report.pulled > 0 || report.conflicts > 0) this.deps.onApplied();
        // In case the server's word about a request to link went unheard.
        if (Date.now() - this.requestsLooked > REQUESTS_EVERY_MS) {
          this.requestsLooked = Date.now();
          void this.approvals.refresh();
        }
        // Where sync is sold, a payment that didn't go through shows, once in a while.
        if (checked && Date.now() - this.accessLooked > ACCESS_EVERY_MS) {
          this.accessLooked = Date.now();
          const epoch = this.accessEpoch;
          client.account().then(
            (account) => {
              if (!this.closed && this.runner === runner) {
                this.noteAccess(client, account.access, epoch);
              }
            },
            () => {},
          );
        }
        // Once the server answers, the account's key is checked, until the check gets through.
        if (!checked) {
          checked = true;
          void this.checkKey(client, runner, keys).then(
            (done) => {
              checked = done;
            },
            () => {
              checked = false;
            },
          );
        }
      },
      onActivity: (activity, message) => {
        if (this.runner !== runner) return;
        this.set(this.on(activity, lastSynced, message, skipped));
      },
      onRequests: () => {
        if (!this.closed && this.runner === runner) void this.approvals.refresh();
      },
      onSignedOut: () => {
        if (this.closed || this.runner !== runner) return;
        this.runner = null;
        this.approvals.use(null);
        this.endSession();
        this.set({ state: 'signed-out', email: this.email() });
      },
      onSubscriptionNeeded: () => {
        if (this.closed || this.runner !== runner) return;
        this.pause();
      },
    });
    this.runner = runner;
    runner.start();
    this.requestsLooked = Date.now();
    void this.approvals.refresh();
  }

  /**
   * Once a round of sync has run: notes the account's email, for a computer that set up before
   * it was known, and checks the account still uses this computer's key. Version 0.1.0 didn't
   * check when it signed in again, so after an account was deleted and made again, it synced
   * under its old key without saving that key to the account. A computer that set up later then
   * made another key, and each skipped what the other sent. So a key the account doesn't use
   * stops sync here, even after a restart, as signing in again would:
   * - the account has no key: this computer makes a new account key and recovery key.
   * - the account has another key: this computer links to it.
   * Returns whether the server answered. If it didn't, the next round asks again.
   */
  private async checkKey(
    client: SyncClient,
    runner: SyncRunner,
    keys: AccountKeys,
  ): Promise<boolean> {
    // Whether this check still speaks for the sign-in and the sync it was made for.
    const current = () => !this.overtaken(client) && this.runner === runner;
    const epoch = this.accessEpoch;
    let account: Awaited<ReturnType<SyncClient['account']>>;
    let saved: Awaited<ReturnType<SyncClient['keys']>>;
    try {
      [account, saved] = await Promise.all([client.account(), client.keys()]);
    } catch {
      return false;
    }
    if (!current()) return true;
    const email = account.user.email;
    this.state.setMeta('email', email);
    this.state.setMeta('account', account.user.id);
    if (saved?.keyId === keys.id) {
      if (this.current.state === 'on') this.set({ ...this.current, email });
      this.noteAccess(client, account.access, epoch);
      return true;
    }
    this.state.setMeta(UNCHECKED, '1');
    await runner.stop();
    if (!current()) return true;
    this.runner = null;
    this.keys = null;
    this.accountKey = null;
    void this.approvals.refresh();
    this.set(
      saved === null
        ? { state: 'setting-up', email, firstDevice: true, again: 'remade' }
        : { state: 'setting-up', email, firstDevice: false, again: 'changed' },
    );
    return true;
  }

  /** Syncs now, such as after an edit. */
  requestSync(): void {
    this.runner?.request();
  }

  /**
   * What claims on jobs need of sync here. Sync counts as set up once it's turned on, signed in or
   * not, paused or not, as another computer may share the job hunt, and before it's known whether
   * it is, as the app opens.
   */
  claimSync(): ClaimsSync {
    return {
      ...claimNotes(this.state),
      on: () => !this.known || !['off', 'unavailable', 'no-server'].includes(this.current.state),
      working: () => this.runner?.working() ?? false,
      now: () => this.runner?.now() ?? Promise.resolve(false),
      request: () => this.requestSync(),
    };
  }

  /** A link code for adding a phone or computer, good for 10 minutes and one use. */
  async makeLinkCode(): Promise<LinkCodeResult> {
    const { client, accountKey } = this;
    if (!client || !accountKey) return failed('Turn on sync first.');
    const code = newLinkCode();
    try {
      const link = await lockForLink(accountKey, code.bytes);
      await client.saveLink(link.id, link.data);
      const url = new URL('/link', this.server());
      url.hash = code.text.replaceAll('-', '');
      return {
        ok: true,
        link: {
          id: link.id,
          code: code.text,
          url: url.toString(),
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      };
    } catch (error) {
      this.subscriptionNeeded(error);
      return failed(reason(error));
    }
  }

  async cancelLinkCode(id: string): Promise<void> {
    await this.client?.cancelLink(id).catch(() => {});
  }

  /** How linking by approval stands here, after a fresh look for other devices' requests. */
  async approvalsView(): Promise<ApprovalsView> {
    await this.approvals.refresh();
    return this.approvals.view();
  }

  /** On a computer that isn't linked yet: asks a device that's set up to approve it. */
  async askToLink(): Promise<EditResult> {
    if (this.current.state !== 'setting-up' || this.current.firstDevice) {
      return failed('Only a computer that isn’t linked yet asks to be.');
    }
    return this.approvals.ask();
  }

  /** On the computer asking: the person says whether the emoji match the other device's. */
  confirmLinkCheck(matched: boolean): void {
    this.approvals.confirm(matched);
  }

  /** With sync on: starts approving another device's request, up to showing its emoji. */
  approveRequest(id: string): Promise<EditResult> {
    return this.approvals.approve(id);
  }

  /** With sync on: the person says whether the emoji match, which approves or turns it down. */
  answerApproval(matched: boolean): Promise<EditResult> {
    return this.approvals.answer(matched);
  }

  /** With sync on: turns another device's request down. */
  denyRequest(id: string): Promise<EditResult> {
    return this.approvals.deny(id);
  }

  /** Signs out the device whose request was just turned down: it isn't the person's. */
  signOutTurnedDown(): Promise<EditResult> {
    return this.approvals.signOutTurnedDown();
  }

  /** Puts away what's over: an approval that ended, or a request just turned down. */
  dismissApproval(): void {
    this.approvals.dismiss();
  }

  /** The account, its devices and its storage, which also tells how it has sync, where it's sold. */
  async account(): Promise<AccountResult> {
    const client = this.client;
    if (!client) return failed('Sign in first.');
    const epoch = this.accessEpoch;
    try {
      const account = await client.account();
      this.noteAccess(client, account.access, epoch);
      return { ok: true, account };
    } catch (error) {
      return failed(reason(error));
    }
  }

  /** Sync's status while it's on, with whether a payment didn't go through, where sync is sold. */
  private on(
    activity: SyncActivity,
    lastSynced: string | null,
    message: string | null,
    skipped: number,
  ): SyncStatus {
    return {
      state: 'on',
      email: this.email(),
      activity,
      lastSynced,
      message,
      skipped,
      ...(this.paymentFailed && { paymentFailed: true as const }),
    };
  }

  /** Where sync is sold: an account without it subscribes, in the browser, before setting up. */
  private toSubscribe(account: AccountInfo, access: SyncAccess): void {
    this.subscriber = account.user.id;
    this.set({
      state: 'subscribe',
      email: account.user.email,
      again: access.subscription !== null,
      waiting: false,
    });
  }

  /**
   * The account can't sync, where sync is sold (`access`, as it says, when it said): sync stops
   * here, keeping the job hunt, the sign-in and the account key, until the account has sync again.
   * It stays stopped after a restart. Meanwhile it asks the account now and then, and on coming
   * back to the app.
   */
  private pause(access?: SyncAccess): void {
    const runner = this.runner;
    this.runner = null;
    // A round that ends in an error still counts as stopped.
    if (runner) this.stopping = runner.stop().catch(() => {});
    this.accessEpoch++;
    this.keys = null;
    this.accountKey = null;
    this.paymentFailed = false;
    // Without the account's word, as when the server turned a change down, a subscription most
    // likely ended: the account says for sure in a moment.
    const again = access ? access.subscription !== null : true;
    this.state.setMeta(PAUSED, again ? 'again' : 'first');
    this.subscriber = this.state.meta('account');
    this.set({ state: 'paused', email: this.email(), again, waiting: false });
    const client = this.client;
    if (!client) return;
    this.watchPaused(client);
    if (!access) this.lookAtAccess(client);
  }

  /**
   * Keeps up with how the account has sync, from the server's word, where sync is sold. Without it,
   * sync pauses here. With it again, a computer that's paused, or waiting to subscribe, carries on.
   * A payment that didn't go through shows while sync carries on. A server that doesn't sell sync
   * says nothing of it, and every account syncs there.
   */
  private noteAccess(
    client: SyncClient,
    access: SyncAccess | undefined,
    epoch = this.accessEpoch,
  ): void {
    if (this.overtaken(client) || epoch !== this.accessEpoch) return;
    this.accessLooked = Date.now();
    const status = this.current;
    const without = access && !access.allowed ? access : null;
    if (status.state === 'on') {
      if (without) {
        this.pause(without);
        return;
      }
      const failed = access?.subscription?.state === 'retrying' && !access.gift;
      if (failed === this.paymentFailed) return;
      this.paymentFailed = failed;
      const { paymentFailed: _, ...rest } = status;
      this.set(failed ? { ...rest, paymentFailed: true } : rest);
    } else if (status.state === 'paused' && without) {
      // Still without sync: what it says follows whether a subscription ended.
      const again = without.subscription !== null;
      if (again === status.again) return;
      this.state.setMeta(PAUSED, again ? 'again' : 'first');
      this.set({ ...status, again });
    } else if ((status.state === 'subscribe' || status.state === 'paused') && !without) {
      void this.carryOn(client);
    }
  }

  /**
   * Where sync is sold, for an account without it: opens the server's page for subscribing in the
   * browser, naming the account, then asks every few seconds whether it has sync, and carries on
   * by itself once it has: to setting up, or to syncing again.
   */
  async subscribe(): Promise<EditResult> {
    const client = this.client;
    const server = this.kept;
    const { state } = this.current;
    if (!client || !server || (state !== 'subscribe' && state !== 'paused')) {
      return failed('Sign in first.');
    }
    const page = new URL('/subscribe', server.url);
    if (this.subscriber) page.searchParams.set('account', this.subscriber);
    await this.deps.openUrl(page.toString());
    if (this.overtaken(client) || !this.setWaiting(true)) return OVERTAKEN;
    void this.waitForSync(client);
    return { ok: true };
  }

  /** Notes whether the app is asking every few seconds for the account to have sync. */
  private setWaiting(waiting: boolean): boolean {
    const status = this.current;
    if (status.state !== 'subscribe' && status.state !== 'paused') return false;
    this.set({ ...status, waiting });
    return true;
  }

  /**
   * Asks every few seconds whether the account has sync, until it has, the sign-in ends, or about as
   * long as checkout stays open: then it stops waiting, and subscribing opens the page again.
   */
  private async waitForSync(client: SyncClient): Promise<void> {
    const wait = ++this.waits;
    const sleep =
      this.deps.subscriptionWait ??
      ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
    const current = () =>
      !this.overtaken(client) &&
      wait === this.waits &&
      (this.current.state === 'subscribe' || this.current.state === 'paused');
    const started = Date.now();
    while (Date.now() - started < SUBSCRIBE_FOR_MS) {
      const quick = Date.now() - started < SUBSCRIBE_QUICKLY_FOR_MS;
      await sleep(quick ? SUBSCRIBE_QUICK_MS : SUBSCRIBE_SLOW_MS);
      if (!current()) return;
      let access: SyncAccess | undefined;
      try {
        access = (await client.account()).access;
      } catch (error) {
        if (!current()) return;
        if (error instanceof SyncError && error.kind === 'signed-out') {
          this.signedOutElsewhere();
          return;
        }
        // Offline, or the server's busy: the next look may get through.
        continue;
      }
      if (!current()) return;
      // Once it carries on, it's done; a request that didn't get through asks again.
      if ((!access || access.allowed) && (await this.carryOn(client))) return;
    }
    if (current()) this.setWaiting(false);
  }

  /**
   * Once the account has sync: on to setting up this computer, or, with the account key it keeps,
   * to syncing again, once the key's checked against the account's. A request that doesn't get
   * through leaves it waiting or paused, to ask again. Says whether it carried on.
   */
  private async carryOn(client: SyncClient): Promise<boolean> {
    if (this.carrying || this.overtaken(client) || !this.kept) return false;
    this.carrying = true;
    this.accessEpoch++;
    try {
      const saved = this.secrets.get(this.keyFor(this.kept));
      const accountKey = saved ? fromBase64Url(saved) : null;
      if (accountKey) await this.resume(accountKey, true);
      else await this.checkSetup(true);
    } finally {
      this.carrying = false;
    }
    const { state } = this.current;
    return state !== 'subscribe' && state !== 'paused';
  }

  async removeDevice(id: string): Promise<EditResult> {
    if (!this.client) return failed('Sign in first.');
    try {
      await this.client.removeDevice(id);
      return { ok: true };
    } catch (error) {
      return failed(reason(error));
    }
  }

  /** Opens the account's page on the web, to download everything or delete the account. */
  async openAccountPage(): Promise<void> {
    if (this.kept) await this.deps.openUrl(new URL('/account', this.kept.url).toString());
  }

  /**
   * The terms and price of the server the window shows: the one a sign-in is waiting on, or the
   * one sync is with here, or Factwright's for turning sync on, as its sign-in options say. Null
   * when there's no server, or it didn't answer.
   */
  serverTerms(): Promise<ServerTerms | null> {
    const waiting = this.current.state === 'signing-in' ? this.signingInTo : null;
    const server = waiting ?? this.kept ?? this.factwright();
    if (!server) return Promise.resolve(null);
    let asked = this.terms.get(server.url);
    if (!asked) {
      asked = askSignInOptions(server.url, this.deps.fetch ?? fetch).then((options) => {
        if (options && options !== 'unreachable') return termsOf(options);
        // Asked again next time.
        this.terms.delete(server.url);
        return null;
      });
      this.terms.set(server.url, asked);
    }
    return asked;
  }

  /**
   * Turns sync off on this computer: signs it out, and forgets the session, the account key and
   * the server. The job hunt here stays as it is, and so does the account's data on other devices.
   */
  async signOut(): Promise<EditResult> {
    // As with signing in to a different account, a copy without Factwright's sync leaves what
    // that sync kept alone, and so does one without the keychain.
    if (this.keptForAnotherCopy()) return failed(NO_SERVER);
    if (!this.secrets.available()) return failed(NO_KEYCHAIN_MESSAGE);
    const server = this.kept;
    const token = this.token();
    await this.forget();
    if (server && token) await this.signOutOnServer(server, token);
    return { ok: true };
  }

  /** Ends a session on the server it's for, as far as it can be reached. */
  private async signOutOnServer(server: SyncServer, token: string): Promise<void> {
    await (this.deps.fetch ?? fetch)(new URL('/api/auth/sign-out', server.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  }

  /** Forgets everything sync kept here, and says it's off. */
  private async forget(): Promise<void> {
    await this.forgetAll();
    this.set({ state: 'off' });
  }

  /** Forgets everything sync kept here: the sign-in, the server, the keys and what it knew. */
  private async forgetAll(): Promise<void> {
    await this.runner?.stop();
    await this.stopping;
    this.stopping = null;
    clearInterval(this.pausedTimer);
    this.runner = null;
    this.useClient(null);
    this.keys = null;
    this.accountKey = null;
    this.pending = null;
    this.kept = null;
    this.subscriber = null;
    this.paymentFailed = false;
    this.secrets.clear();
    this.state.clear();
  }

  /**
   * Before the app quits, when this computer has a request to link out: calls it off, so it
   * doesn't wait on the other devices, taking a moment at most. Null when there's none.
   */
  callOffBeforeQuit(): Promise<void> | null {
    return this.approvals.hasRequest() ? this.approvals.stop() : null;
  }

  /** Stops sync as the app closes, once a round that's running has finished. */
  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // A request to link this computer is called off, so it doesn't wait on other devices.
    const asking = this.approvals.stop();
    this.signIn?.cancel();
    clearInterval(this.pausedTimer);
    await Promise.all([this.runner?.stop(), asking, this.stopping]);
    this.state.close();
  }
}
