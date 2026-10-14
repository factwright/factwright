import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AccountKeys,
  accountKeys,
  type Bytes,
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
  SyncClient,
  SyncError,
  toBase64Url,
} from '@factwright/sync';
import type { EditResult } from '../../shared/api.ts';
import type {
  AccountResult,
  LinkCodeResult,
  RecoveryKeyResult,
  SyncStatus,
} from '../../shared/sync.ts';
import type { Tracker } from '../jobs/tracker.ts';
import { computerName, userAgent } from './device.ts';
import { SyncEngine } from './engine.ts';
import { adoptGainedColumns, adoptGainedTables } from './rows.ts';
import { SyncRunner } from './runner.ts';
import { type Keychain, Secrets } from './secrets.ts';
import { DeviceSignIn } from './sign-in.ts';
import { SyncState } from './state.ts';

export interface SyncAccountDeps {
  /** The app's data folder. Sync keeps its notes and secrets in a folder there. */
  dataDir: string;
  /** The sync server, such as "https://app.factwright.com". */
  server: string;
  /** The app's version, which it tells the server. */
  version: string;
  keychain: Keychain;
  tracker: Tracker;
  workspace: string;
  /** Opens a page in the user's browser. */
  openUrl: (url: string) => void | Promise<void>;
  onStatus: (status: SyncStatus) => void;
  /** After changes from other devices land, so the window shows them. */
  onApplied: () => void;
  computerName?: () => Promise<string>;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests: how sign-in waits between asking whether the user approved. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const failed = (message: string) => ({ ok: false as const, message });

/** Notes a sign-in that hasn't been checked against the account's key on the server yet. */
const UNCHECKED = 'unchecked';

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
  private client: SyncClient | null = null;
  private keys: AccountKeys | null = null;
  private accountKey: Bytes | null = null;
  private runner: SyncRunner | null = null;
  private signIn: DeviceSignIn | null = null;
  /**
   * The account key a first device sets up with, kept until its recovery key is saved: a new
   * one, or, `kept`, the one this computer synced with, for an account that has none on the
   * server.
   */
  private pending: { accountKey: Bytes; recovery: Bytes | null; kept: boolean } | null = null;
  /** A rebuild of what sync knows, while it runs: signing out and closing wait for it. */
  private rebuilding: Promise<void> | null = null;
  private device = 'This computer';
  /** Once the app is closing, nothing more happens. */
  private closed = false;

  constructor(deps: SyncAccountDeps) {
    this.deps = deps;
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
    this.current = status;
    this.deps.onStatus(status);
  }

  private email(): string {
    return this.state.meta('email') ?? '';
  }

  private clientFor(token: string): SyncClient {
    return new SyncClient({
      server: this.deps.server,
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
    if (!this.secrets.available()) {
      this.set({ state: 'unavailable' });
      return;
    }
    const token = this.secrets.get('session');
    if (!token) {
      this.set({ state: 'off' });
      return;
    }
    this.client = this.clientFor(token);
    const saved = this.secrets.get('accountKey');
    const accountKey = saved ? fromBase64Url(saved) : null;
    if (accountKey) {
      // Signed in again, but not yet checked against the account, such as when the app quit
      // while asking for a new recovery key: it's checked before anything syncs.
      if (this.state.meta(UNCHECKED) === '1') await this.resume(accountKey);
      else await this.turnOnWith(accountKey);
      return;
    }
    await this.checkSetup();
  }

  /** Signed in without the account key: is this the first device, or does it link to others? */
  private async checkSetup(): Promise<void> {
    if (!this.client) return;
    try {
      const account = await this.client.account();
      this.state.setMeta('account', account.user.id);
      this.state.setMeta('email', account.user.email);
      const keys = await this.client.keys();
      this.set({ state: 'setting-up', email: account.user.email, firstDevice: keys === null });
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'signed-out') await this.forget();
      else this.set({ state: 'setting-up', email: this.email(), firstDevice: false });
    }
  }

  /** Signs in through the browser: shows a code, opens the page, and waits for the user. */
  async signInWithBrowser(): Promise<EditResult> {
    if (!this.secrets.available()) {
      this.set({ state: 'unavailable' });
      return failed('This computer’s keychain isn’t available.');
    }
    this.signIn?.cancel();
    const before: SyncStatus =
      this.current.state === 'signing-in' ? { state: 'off' } : this.current;
    const flow = new DeviceSignIn({
      server: this.deps.server,
      userAgent: userAgent(this.deps.version, this.device),
      ...(this.deps.fetch && { fetch: this.deps.fetch }),
      ...(this.deps.sleep && { sleep: this.deps.sleep }),
    });
    this.signIn = flow;
    let pending: Awaited<ReturnType<DeviceSignIn['start']>>;
    try {
      pending = await flow.start();
    } catch (error) {
      this.signIn = null;
      return failed(reason(error));
    }
    // Only the sync server's own pages open: never another site, or a file on this computer.
    if (new URL(pending.url).origin !== new URL(this.deps.server).origin) {
      flow.cancel();
      this.signIn = null;
      return failed('The sync server sent a sign-in page somewhere else. Try again later.');
    }
    this.set({ state: 'signing-in', code: pending.code, url: pending.url });
    await this.deps.openUrl(pending.url);
    const result = await flow.finish();
    // Another sign-in took over: it says how things stand.
    if (this.signIn !== flow)
      return failed(result.ok ? 'Signing in was canceled.' : result.message);
    this.signIn = null;
    if (!result.ok) {
      this.set(before);
      return failed(result.message);
    }
    const saved = this.secrets.get('accountKey');
    const accountKey = saved ? fromBase64Url(saved) : null;
    // Noted before the new sign-in is kept, so it's never kept unchecked.
    if (accountKey) this.state.setMeta(UNCHECKED, '1');
    this.secrets.set('session', result.token);
    this.client = this.clientFor(result.token);
    if (!accountKey) {
      await this.checkSetup();
      return { ok: true };
    }
    return this.resume(accountKey);
  }

  /**
   * After signing in again with the account key this computer kept: nothing syncs until the
   * account's key on the server says what to do. Until then the sign-in stays unchecked, so a
   * restart asks again.
   * - The same key: sync carries on.
   * - No key: the account is new, or was deleted and made again. This computer makes a new
   *   account key and recovery key, as a first device does, so the old ones, which a lost or
   *   stolen device may still hold, open nothing of it. But when it's the account this computer
   *   was syncing, as `checkKey` found, it saves a recovery key for the key it has.
   * - Another key: the account isn't this computer's to sync with until it links, and linking
   *   adds this computer's job hunt to it. Nothing goes up before that.
   * When the server can't be asked, sign-in says why, and nothing syncs.
   */
  private async resume(accountKey: Bytes): Promise<EditResult> {
    if (!this.client) return failed('Sign in first.');
    let account: Awaited<ReturnType<SyncClient['account']>>;
    let saved: Awaited<ReturnType<SyncClient['keys']>>;
    try {
      [account, saved] = await Promise.all([this.client.account(), this.client.keys()]);
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'signed-out') {
        this.secrets.delete('session');
        this.client = null;
      }
      this.set({ state: 'signed-out', email: this.email() });
      return failed(reason(error));
    }
    this.pending = null;
    const email = account.user.email;
    const keys = await accountKeys(accountKey);
    // Whether a check found this computer syncing this very account under the key it has.
    const synced = this.state.meta('account') === account.user.id;
    if (saved === null) {
      if (synced) {
        // If the app closed before what sync knew was rebuilt, it's rebuilt now, before anything
        // changes here. Saving the recovery key tries again if this can't.
        await this.rebuildNotes(this.client, keys).catch(() => {});
        this.pending = { accountKey, recovery: null, kept: true };
      }
      this.set({
        state: 'setting-up',
        email,
        firstDevice: true,
        again: synced ? 'unsaved' : 'remade',
      });
      return { ok: true };
    }
    if (saved.keyId !== keys.id) {
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
    await this.turnOnWith(accountKey);
    return { ok: true };
  }

  /**
   * For a key this computer keeps, when what sync knew may be from the account before this one
   * was made again: rebuilds it from the server's versions, sending nothing, so what changes here
   * from now on syncs as a change, not a conflict. It's noted done only for the sign-in it was
   * done for, so one cut short by signing out or closing is done again.
   */
  private async rebuildNotes(client: SyncClient, keys: AccountKeys): Promise<void> {
    while (this.rebuilding) await this.rebuilding;
    if (this.state.meta('keyId') === keys.id) return;
    const work = (async () => {
      this.startOver();
      const { tracker, workspace } = this.deps;
      const engine = new SyncEngine({
        client,
        keys,
        state: this.state,
        tracker,
        workspace,
        device: this.device,
      });
      const report = await engine.pullOnly();
      if (report.pulled > 0 || report.conflicts > 0) this.deps.onApplied();
      if (!this.closed && this.client === client) this.state.setMeta('keyId', keys.id);
    })();
    const settled = work.then(
      () => {},
      () => {},
    );
    this.rebuilding = settled;
    try {
      await work;
    } finally {
      if (this.rebuilding === settled) this.rebuilding = null;
    }
  }

  /** Forgets what sync knew of the account's history, keeping who's signed in. */
  private startOver(): void {
    const email = this.email();
    const account = this.state.meta('account');
    const unchecked = this.state.meta(UNCHECKED);
    this.state.clear();
    this.state.setMeta('email', email);
    if (account !== null) this.state.setMeta('account', account);
    if (unchecked !== null) this.state.setMeta(UNCHECKED, unchecked);
  }

  /**
   * Signed in with an account this computer shouldn't sync with: ends that sign-in only. The
   * account key this computer has, and what sync knows, stay for the right account.
   */
  async useDifferentAccount(): Promise<EditResult> {
    const token = this.secrets.get('session');
    if (token) await this.signOutOnServer(token);
    this.secrets.delete('session');
    this.client = null;
    this.pending = null;
    this.set(
      this.secrets.get('accountKey')
        ? { state: 'signed-out', email: this.email() }
        : { state: 'off' },
    );
    return { ok: true };
  }

  /** Stops waiting for the browser. Sync goes back to where it stood. */
  cancelSignIn(): void {
    this.signIn?.cancel();
  }

  /** On the first device: makes the account key and its recovery key, to save before going on. */
  async newRecoveryKey(): Promise<RecoveryKeyResult> {
    if (this.current.state !== 'setting-up') return failed('Sign in first.');
    const kept = this.pending?.kept ? this.pending.accountKey : null;
    if (kept && this.client) {
      // Another computer that kept this same key may have saved a recovery key for it since.
      // That one works, so this computer carries on without making another.
      const client = this.client;
      try {
        const keys = await accountKeys(kept);
        if ((await client.keys())?.keyId === keys.id) {
          await this.rebuildNotes(client, keys);
          this.pending = null;
          await this.turnOnWith(kept);
          return { ok: true, recoveryKey: null };
        }
      } catch {
        // Saving the recovery key asks again.
      }
    }
    const recovery = newRecoveryKey();
    this.pending = {
      accountKey: kept ?? this.pending?.accountKey ?? newAccountKey(),
      recovery: recovery.bytes,
      kept: kept !== null,
    };
    return { ok: true, recoveryKey: recovery.text };
  }

  /** On the first device, once the recovery key is saved: turns sync on. */
  async turnOn(): Promise<EditResult> {
    const recovery = this.pending?.recovery;
    if (!this.client || !this.pending || !recovery) return failed('Make your recovery key first.');
    const { accountKey, kept } = this.pending;
    const client = this.client;
    try {
      const keys = await accountKeys(accountKey);
      // A kept key syncs on from what the server has, once that's rebuilt here.
      if (kept) await this.rebuildNotes(client, keys);
      const locked = await lockWithRecoveryKey(accountKey, recovery);
      if ((await client.saveKeys(keys.id, locked)) === 'taken') {
        this.pending = null;
        // Another computer that kept this same key saved its recovery key first: that's the
        // one that works, and sync carries on here.
        if ((await client.keys())?.keyId === keys.id) {
          await this.turnOnWith(accountKey);
          return { ok: true };
        }
        this.set({ state: 'setting-up', email: this.email(), firstDevice: false });
        return failed(
          'Another device turned on sync for this account first. Link this computer to it instead.',
        );
      }
    } catch (error) {
      return failed(reason(error));
    }
    this.pending = null;
    await this.turnOnWith(accountKey);
    return { ok: true };
  }

  /** On another device: takes the account key from a link code shown on a device that's set up. */
  async linkWithCode(text: string): Promise<EditResult> {
    const code = readLinkCode(text);
    if (!code) return failed('That isn’t a link code. It’s 32 letters and numbers.');
    if (!this.client) return failed('Sign in first.');
    try {
      const data = await this.client.takeLink(await linkId(code));
      const accountKey = data && (await openLink(data, code));
      if (!accountKey) {
        return failed(
          'That code didn’t work. It lasts 10 minutes: make a new one on your other device.',
        );
      }
      return await this.checkAndTurnOn(accountKey);
    } catch (error) {
      return failed(reason(error));
    }
  }

  /** On another device, or after losing every device: unlocks the account key with the recovery key. */
  async useRecoveryKey(text: string): Promise<EditResult> {
    const recovery = readRecoveryKey(text);
    if (!recovery) return failed('That isn’t a recovery key. It’s 32 letters and numbers.');
    if (!this.client) return failed('Sign in first.');
    try {
      const keys = await this.client.keys();
      if (!keys) return failed('No device has turned on sync for this account yet.');
      const accountKey = await openWithRecoveryKey(keys.recovery, recovery);
      if (!accountKey)
        return failed('That recovery key doesn’t open this account. Check it, and try again.');
      return await this.checkAndTurnOn(accountKey);
    } catch (error) {
      return failed(reason(error));
    }
  }

  /** Turns sync on with an account key, once it's the one the account uses. */
  private async checkAndTurnOn(accountKey: Bytes): Promise<EditResult> {
    const keys = await this.client?.keys();
    if (keys && keys.keyId !== (await accountKeys(accountKey)).id) {
      return failed('That key belongs to a different account.');
    }
    await this.turnOnWith(accountKey);
    return { ok: true };
  }

  private async turnOnWith(accountKey: Bytes): Promise<void> {
    if (!this.client) return;
    const keys = await accountKeys(accountKey);
    // Another account's data must never mix in: a different key starts over. The account is
    // noted again once a check finds it uses this key.
    if (this.state.meta('keyId') !== keys.id) {
      this.startOver();
      this.state.forgetMeta('account');
    }
    this.state.setMeta('keyId', keys.id);
    this.state.setMeta(UNCHECKED, '0');
    this.secrets.set('accountKey', toBase64Url(accountKey));
    this.accountKey = accountKey;
    this.keys = keys;
    await this.runner?.stop();
    const engine = new SyncEngine({
      client: this.client,
      keys,
      state: this.state,
      tracker: this.deps.tracker,
      workspace: this.deps.workspace,
      device: this.device,
    });
    let skipped = 0;
    let lastSynced: string | null = null;
    this.set({
      state: 'on',
      email: this.email(),
      activity: 'syncing',
      lastSynced,
      message: null,
      skipped,
    });
    let checked = false;
    // A runner that's been replaced or stopped speaks for nothing.
    const runner: SyncRunner = new SyncRunner({
      engine,
      client: this.client,
      state: this.state,
      onReport: (report) => {
        if (this.closed || this.runner !== runner) return;
        skipped = report.skipped.length;
        lastSynced = new Date().toISOString();
        if (report.pulled > 0 || report.conflicts > 0) this.deps.onApplied();
        // Once the server answers, the account's key is checked, until the check gets through.
        if (!checked) {
          checked = true;
          void this.checkKey(runner, accountKey, keys).then(
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
        this.set({ state: 'on', email: this.email(), activity, lastSynced, message, skipped });
      },
      onSignedOut: () => {
        if (this.closed || this.runner !== runner) return;
        this.runner = null;
        this.secrets.delete('session');
        this.set({ state: 'signed-out', email: this.email() });
      },
    });
    this.runner = runner;
    runner.start();
  }

  /**
   * Once a round of sync has run: notes the account's email, for a computer that set up before
   * it was known, and checks the account still uses this computer's key. Version 0.1.0 didn't
   * check when it signed in again, so after an account was deleted and made again, it synced
   * under its old key without saving that key to the account. A computer that set up later then
   * made another key, and each skipped what the other sent. So a key the account doesn't use
   * stops sync here, even after a restart, until:
   * - the account has no key: this computer saves a recovery key for the key it has. What sync
   *   knew may be from the account before, so first it's rebuilt from what the server has, before
   *   anything changes here; then what the server lacks goes up.
   * - the account has another key: this computer links to it.
   * Returns whether the server answered. If it didn't, the next round asks again.
   */
  private async checkKey(
    runner: SyncRunner,
    accountKey: Bytes,
    keys: AccountKeys,
  ): Promise<boolean> {
    const client = this.client;
    if (!client) return true;
    // Whether this check still speaks for the sign-in and the sync it was made for.
    const current = () => !this.closed && this.client === client && this.runner === runner;
    let account: Awaited<ReturnType<SyncClient['account']>>;
    let saved: Awaited<ReturnType<SyncClient['keys']>>;
    try {
      [account, saved] = await Promise.all([client.account(), client.keys()]);
    } catch {
      return false;
    }
    if (!current()) return true;
    const before = this.state.meta('account');
    const email = account.user.email;
    this.state.setMeta('email', email);
    this.state.setMeta('account', account.user.id);
    if (saved?.keyId === keys.id) {
      if (this.current.state === 'on') this.set({ ...this.current, email });
      return true;
    }
    this.state.setMeta(UNCHECKED, '1');
    // Noted before anything else, so the rebuild happens even if the app closes first.
    if (saved === null && before !== account.user.id) this.state.forgetMeta('keyId');
    await runner.stop();
    if (!current()) return true;
    this.runner = null;
    this.keys = null;
    this.accountKey = null;
    if (saved === null) {
      await this.rebuildNotes(client, keys).catch(() => {});
      if (this.closed || this.client !== client) return true;
      this.pending = { accountKey, recovery: null, kept: true };
      this.set({ state: 'setting-up', email, firstDevice: true, again: 'unsaved' });
    } else {
      this.set({ state: 'setting-up', email, firstDevice: false, again: 'changed' });
    }
    return true;
  }

  /** Syncs now, such as after an edit. */
  requestSync(): void {
    this.runner?.request();
  }

  /** A link code for adding a phone or computer, good for 10 minutes and one use. */
  async makeLinkCode(): Promise<LinkCodeResult> {
    if (!this.client || !this.accountKey) return failed('Turn on sync first.');
    const code = newLinkCode();
    try {
      const link = await lockForLink(this.accountKey, code.bytes);
      await this.client.saveLink(link.id, link.data);
      const url = new URL('/link', this.deps.server);
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
      return failed(reason(error));
    }
  }

  async cancelLinkCode(id: string): Promise<void> {
    await this.client?.cancelLink(id).catch(() => {});
  }

  async account(): Promise<AccountResult> {
    if (!this.client) return failed('Sign in first.');
    try {
      return { ok: true, account: await this.client.account() };
    } catch (error) {
      return failed(reason(error));
    }
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
    await this.deps.openUrl(new URL('/account', this.deps.server).toString());
  }

  /**
   * Turns sync off on this computer: signs it out, and forgets the session and the account
   * key. The job hunt here stays as it is, and so does the account's data on other devices.
   */
  async signOut(): Promise<EditResult> {
    const token = this.secrets.get('session');
    if (token) await this.signOutOnServer(token);
    await this.forget();
    return { ok: true };
  }

  /** Ends a session on the server, as far as it can be reached. */
  private async signOutOnServer(token: string): Promise<void> {
    await (this.deps.fetch ?? fetch)(new URL('/api/auth/sign-out', this.deps.server), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  }

  private async forget(): Promise<void> {
    await this.runner?.stop();
    while (this.rebuilding) await this.rebuilding;
    this.runner = null;
    this.client = null;
    this.keys = null;
    this.accountKey = null;
    this.pending = null;
    this.secrets.clear();
    this.state.clear();
    this.set({ state: 'off' });
  }

  /** Stops sync as the app closes, once a round that's running has finished. */
  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.signIn?.cancel();
    await this.runner?.stop();
    while (this.rebuilding) await this.rebuilding;
    this.state.close();
  }
}
