import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type Account, startServer, type TestServer } from '@factwright/server/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../../shared/sync.ts';
import { Tracker } from '../jobs/tracker.ts';
import { SyncAccount } from './account.ts';
import { Secrets } from './secrets.ts';

// Each test signs in and syncs for real, against the server running locally.
vi.setConfig({ testTimeout: 30_000 });

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

/** A stand-in for the system's keychain. */
const keychain = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`locked:${text}`),
  decryptString: (locked: Buffer) => locked.toString().slice('locked:'.length),
};

let person: Account;
const folders: string[] = [];
const opened: SyncAccount[] = [];

beforeEach(async () => {
  person = await server.signUp('Sam Rivera');
});

afterEach(async () => {
  for (const sync of opened.splice(0)) await sync.stop();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The person, in their browser, approving the code a computer shows. */
async function approve(url: string) {
  const userCode = new URL(url).searchParams.get('user_code') ?? '';
  const headers = { authorization: `Bearer ${person.token}`, 'content-type': 'application/json' };
  await fetch(new URL(`/api/auth/device?user_code=${userCode}`, server.url), { headers });
  await fetch(new URL('/api/auth/device/approve', server.url), {
    method: 'POST',
    headers,
    body: JSON.stringify({ userCode }),
  });
}

/** A computer running the app, with its own data folder. */
function computer(
  name: string,
  dataDir = mkdtempSync(join(tmpdir(), 'factwright-account-')),
  fetchWith?: typeof fetch,
) {
  folders.push(dataDir);
  const workspace = join(dataDir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const tracker = new Tracker(join(dataDir, 'tracker.db'));
  const statuses: SyncStatus[] = [];
  const applied = vi.fn();
  const sync = new SyncAccount({
    dataDir,
    server: server.url.toString(),
    version: '0.0.0',
    keychain,
    tracker,
    workspace,
    openUrl: approve,
    onStatus: (status) => statuses.push(status),
    onApplied: applied,
    computerName: async () => name,
    sleep: async () => {},
    ...(fetchWith && { fetch: fetchWith }),
  });
  opened.push(sync);
  return {
    sync,
    dataDir,
    workspace,
    tracker,
    applied,
    statuses,
    write: (path: string, text: string) => {
      mkdirSync(join(workspace, ...path.split('/').slice(0, -1)), { recursive: true });
      writeFileSync(join(workspace, ...path.split('/')), text);
    },
    read: (path: string) => {
      const file = join(workspace, ...path.split('/'));
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
    /** Waits for a round of sync to finish. */
    synced: () =>
      vi.waitFor(
        () => {
          const now = sync.status();
          expect(now).toMatchObject({ state: 'on', activity: 'idle' });
          expect(now.state === 'on' && now.lastSynced).toBeTruthy();
        },
        { timeout: 10_000 },
      ),
  };
}

/** Signs in and turns sync on as the account's first device. Returns the recovery key. */
async function setUpFirst(first: ReturnType<typeof computer>) {
  await first.sync.start();
  expect(await first.sync.signInWithBrowser()).toEqual({ ok: true });
  expect(first.sync.status()).toEqual({
    state: 'setting-up',
    email: person.email,
    firstDevice: true,
  });
  const made = await recoveryKey(first.sync);
  expect(await first.sync.turnOn()).toEqual({ ok: true });
  return made;
}

/** The recovery key a computer that's setting up shows, to save. */
async function recoveryKey(sync: SyncAccount): Promise<string> {
  const made = await sync.newRecoveryKey();
  if (!made.ok) throw new Error(made.message);
  if (made.recoveryKey === null) throw new Error('No recovery key to save.');
  return made.recoveryKey;
}

/** Waits for a computer to be signed out, as when its account was deleted. */
async function signedOut(sync: SyncAccount) {
  sync.requestSync();
  await vi.waitFor(() => expect(sync.status()).toMatchObject({ state: 'signed-out' }), {
    timeout: 10_000,
  });
}

/** Waits for a computer to stop, asking for a recovery key for the key it kept. */
async function waitsForRecoveryKey(sync: SyncAccount) {
  await vi.waitFor(
    () =>
      expect(sync.status()).toEqual({
        state: 'setting-up',
        email: person.email,
        firstDevice: true,
        again: 'unsaved',
      }),
    { timeout: 10_000 },
  );
}

/** Sam deletes the account on the web, then signs up again with the same GitHub login. */
async function remakeAccount() {
  const deleted = await fetch(new URL('/api/auth/delete-user', server.url), {
    method: 'POST',
    headers: { authorization: `Bearer ${person.token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(deleted.status).toBe(200);
  person = await server.signUp('Sam Rivera');
}

/**
 * Version 0.1.0 signing in again on a computer that was signed out: it kept its account key and
 * synced straight away, checking nothing, and noted neither the account nor that it hadn't
 * checked. The version after it takes over from there.
 */
async function signInWithVersion010(dataDir: string) {
  const { token } = await server.newSession(person.id, 'Factwright/0.1.0 (Sam’s Mac)', 'device');
  new Secrets(join(dataDir, 'sync', 'secrets.json'), keychain).set('session', token);
  const state = new DatabaseSync(join(dataDir, 'sync', 'sync.db'));
  state.exec(`DELETE FROM meta WHERE key IN ('account', 'unchecked')`);
  state.close();
}

/** A promise to hold a request on, until the test opens it. */
interface Gate {
  opened: Promise<void>;
  open: () => void;
  waiting: boolean;
}

function gate(): Gate {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open, waiting: false };
}

/** A note sync keeps on this computer. */
function syncMeta(dataDir: string, key: string): string | null {
  const state = new DatabaseSync(join(dataDir, 'sync', 'sync.db'), { readOnly: true });
  const row = state.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  state.close();
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * Sam's Mac, set up with these files, then signed out when Sam deleted the account and made it
 * again. Returns the Mac and the ID of the key it set up.
 */
async function remadeUnderMac(files: Record<string, string> = {}) {
  const mac = computer('Sam’s Mac');
  for (const [path, text] of Object.entries(files)) mac.write(path, text);
  await setUpFirst(mac);
  await mac.synced();
  const keyId = (await person.client.keys())?.keyId;
  await remakeAccount();
  await signedOut(mac.sync);
  await mac.sync.stop();
  return { mac, keyId };
}

/**
 * Sam's Mac and PC, both syncing under one key, then both on 0.1.0 when Sam deleted the account
 * and made it again. Updated, each waits for a recovery key for the key it kept.
 */
async function remadeUnderMacAndPc() {
  const first = computer('Sam’s Mac');
  await setUpFirst(first);
  await first.synced();
  const second = computer('Sam’s PC');
  await second.sync.start();
  expect(await second.sync.signInWithBrowser()).toEqual({ ok: true });
  const link = await first.sync.makeLinkCode();
  if (!link.ok) throw new Error(link.message);
  expect(await second.sync.linkWithCode(link.link.code)).toEqual({ ok: true });
  await second.synced();
  const keyId = (await person.client.keys())?.keyId;
  await remakeAccount();
  for (const each of [first, second]) {
    await signedOut(each.sync);
    await each.sync.stop();
    await signInWithVersion010(each.dataDir);
  }
  const mac = computer('Sam’s Mac', first.dataDir);
  const pc = computer('Sam’s PC', second.dataDir);
  for (const each of [mac, pc]) {
    await each.sync.start();
    await waitsForRecoveryKey(each.sync);
  }
  return { mac, pc, keyId };
}

describe('turning on sync', () => {
  it('starts off, and turns on once signed in with a recovery key saved', async () => {
    const mac = computer('Sam’s Mac');
    await mac.sync.start();
    expect(mac.sync.status()).toEqual({ state: 'off' });
    const recoveryKey = await setUpFirst(mac);
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(mac.statuses.map((status) => status.state)).toContain('signing-in');
    expect(mac.sync.status()).toMatchObject({ state: 'on', email: person.email });
    await mac.synced();
  });

  it('links a second computer with a code from the first, and their job hunts merge', async () => {
    const mac = computer('Sam’s Mac');
    mac.write('facts/skills.md', '# Skills');
    await setUpFirst(mac);
    await mac.synced();

    const pc = computer('Sam’s PC');
    await pc.sync.start();
    await pc.sync.signInWithBrowser();
    expect(pc.sync.status()).toMatchObject({ state: 'setting-up', firstDevice: false });
    const link = await mac.sync.makeLinkCode();
    if (!link.ok) throw new Error(link.message);
    expect(link.link.url).toMatch(/\/link#[0-9A-Z]{32}$/);
    expect(await pc.sync.linkWithCode(link.link.code.toLowerCase())).toEqual({ ok: true });
    await pc.synced();
    expect(pc.read('facts/skills.md')).toBe('# Skills');
    expect(pc.applied).toHaveBeenCalled();
    // A code works once.
    expect(await pc.sync.linkWithCode(link.link.code)).toMatchObject({ ok: false });
  });

  it('unlocks a new computer with the recovery key, and refuses a wrong one', async () => {
    const mac = computer('Sam’s Mac');
    const recoveryKey = await setUpFirst(mac);
    const pc = computer('Sam’s PC');
    await pc.sync.start();
    await pc.sync.signInWithBrowser();
    expect(await pc.sync.useRecoveryKey('0000-0000-0000-0000-0000-0000-0000-0000')).toEqual({
      ok: false,
      message: 'That recovery key doesn’t open this account. Check it, and try again.',
    });
    expect(await pc.sync.useRecoveryKey('not a key')).toMatchObject({ ok: false });
    expect(await pc.sync.useRecoveryKey(recoveryKey)).toEqual({ ok: true });
    expect(pc.sync.status()).toMatchObject({ state: 'on' });
  });

  it('tells a second first device that another got there first', async () => {
    const mac = computer('Sam’s Mac');
    const pc = computer('Sam’s PC');
    await mac.sync.start();
    await pc.sync.start();
    await mac.sync.signInWithBrowser();
    await pc.sync.signInWithBrowser();
    await mac.sync.newRecoveryKey();
    await pc.sync.newRecoveryKey();
    expect(await mac.sync.turnOn()).toEqual({ ok: true });
    expect(await pc.sync.turnOn()).toMatchObject({
      ok: false,
      message: expect.stringContaining('Link this computer'),
    });
    expect(pc.sync.status()).toMatchObject({ state: 'setting-up', firstDevice: false });
  });
});

describe('a computer with sync on', () => {
  it('picks up where it left off when the app opens again', async () => {
    const mac = computer('Sam’s Mac');
    await setUpFirst(mac);
    await mac.synced();
    await mac.sync.stop();
    const again = computer('Sam’s Mac', mac.dataDir);
    await again.sync.start();
    expect(again.sync.status()).toMatchObject({ state: 'on', email: person.email });
  });

  it('lists the account’s devices, and signs one out', async () => {
    const mac = computer('Sam’s Mac');
    await setUpFirst(mac);
    const pc = computer('Sam’s PC');
    await pc.sync.start();
    await pc.sync.signInWithBrowser();
    const listed = await mac.sync.account();
    if (!listed.ok) throw new Error(listed.message);
    const names = listed.account.devices.map((device) => device.name);
    expect(names).toEqual(
      expect.arrayContaining(['Factwright on Sam’s Mac', 'Factwright on Sam’s PC']),
    );
    const theirs = listed.account.devices.find((device) => device.name.endsWith('Sam’s PC'));
    expect(await mac.sync.removeDevice(theirs?.id ?? '')).toEqual({ ok: true });
    expect(await pc.sync.account()).toMatchObject({ ok: false });
  });

  it('asks to sign in again when signed out elsewhere, and carries on with its key', async () => {
    const mac = computer('Sam’s Mac');
    await setUpFirst(mac);
    await mac.synced();
    const listed = await mac.sync.account();
    if (!listed.ok) throw new Error(listed.message);
    const own = listed.account.devices.find((device) => device.current);
    const other = await server.newSession(person.id);
    await other.client.removeDevice(own?.id ?? '');
    mac.sync.requestSync();
    await vi.waitFor(
      () => expect(mac.sync.status()).toEqual({ state: 'signed-out', email: person.email }),
      {
        timeout: 10_000,
      },
    );
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(mac.sync.status()).toMatchObject({ state: 'on' });
  });

  it('makes a new account key and recovery key when the account was deleted and made again', async () => {
    const mac = computer('Sam’s Mac');
    mac.write('facts/skills.md', 'Kept on the Mac');
    const oldRecoveryKey = await setUpFirst(mac);
    await mac.synced();
    const oldKeyId = (await person.client.keys())?.keyId;
    await remakeAccount();
    mac.sync.requestSync();
    await vi.waitFor(() => expect(mac.sync.status()).toMatchObject({ state: 'signed-out' }), {
      timeout: 10_000,
    });

    // Signing in again finds no key for the account: a new recovery key comes first, and
    // nothing goes up before it.
    const waiting = {
      state: 'setting-up',
      email: person.email,
      firstDevice: true,
      again: 'remade',
    };
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual(waiting);
    expect((await person.client.changes(0)).changes).toEqual([]);

    // Quitting before the key is saved changes nothing: the app asks again when it opens.
    await mac.sync.stop();
    const reopened = computer('Sam’s Mac', mac.dataDir);
    await reopened.sync.start();
    expect(reopened.sync.status()).toEqual(waiting);
    expect((await person.client.changes(0)).changes).toEqual([]);
    const newRecoveryKey = await recoveryKey(reopened.sync);
    expect(newRecoveryKey).not.toBe(oldRecoveryKey);
    expect(await reopened.sync.turnOn()).toEqual({ ok: true });
    await reopened.synced();
    // A new account key too, so a lost device that kept the old one can't get in.
    expect((await person.client.keys())?.keyId).not.toBe(oldKeyId);

    // The old recovery key opens nothing of the new account; the new one does.
    const pc = computer('Sam’s PC');
    await pc.sync.start();
    expect(await pc.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(await pc.sync.useRecoveryKey(oldRecoveryKey)).toMatchObject({ ok: false });
    expect(await pc.sync.useRecoveryKey(newRecoveryKey)).toEqual({ ok: true });
    await pc.synced();
    expect(pc.read('facts/skills.md')).toBe('Kept on the Mac');
  });

  it('won’t sync into another account that uses another key, even after a restart', async () => {
    const mac = computer('Sam’s Mac');
    mac.write('facts/skills.md', 'Sam’s');
    await setUpFirst(mac);
    await mac.synced();
    const sam = person;
    const listed = await mac.sync.account();
    if (!listed.ok) throw new Error(listed.message);
    const own = listed.account.devices.find((device) => device.current);
    const other = await server.newSession(sam.id);
    await other.client.removeDevice(own?.id ?? '');
    mac.sync.requestSync();
    await vi.waitFor(() => expect(mac.sync.status()).toMatchObject({ state: 'signed-out' }), {
      timeout: 10_000,
    });

    // Someone else's account, with its own key, signs in on the Mac.
    person = await server.signUp('Alex Kim');
    const alexPc = computer('Alex’s PC');
    await setUpFirst(alexPc);
    await alexPc.synced();
    const before = (await person.client.changes(0)).changes.length;
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    const linking = { state: 'setting-up', email: person.email, firstDevice: false };
    expect(mac.sync.status()).toEqual(linking);
    await mac.sync.stop();
    const reopened = computer('Sam’s Mac', mac.dataDir);
    await reopened.sync.start();
    expect(reopened.sync.status()).toEqual(linking);
    expect((await person.client.changes(0)).changes).toHaveLength(before);

    // Not the account Sam meant: that sign-in ends, and Sam's own carries on as before.
    expect(await reopened.sync.useDifferentAccount()).toEqual({ ok: true });
    expect(reopened.sync.status()).toMatchObject({ state: 'signed-out' });
    person = sam;
    expect(await reopened.sync.signInWithBrowser()).toEqual({ ok: true });
    await reopened.synced();
    expect((await person.client.changes(0)).changes.length).toBeGreaterThan(0);
  });

  it('stops when 0.1.0 synced a remade account without its key, then keeps that key', async () => {
    const { mac, keyId } = await remadeUnderMac({ 'facts/skills.md': 'Synced before the remake' });
    await signInWithVersion010(mac.dataDir);
    // 0.1.0 sends what changes after it signs in again, under its old key.
    mac.write('facts/notes.md', 'Sent by 0.1.0');

    // Updated, the Mac syncs as before, until it finds the account has no key on the server.
    const updated = computer('Sam’s Mac', mac.dataDir);
    await updated.sync.start();
    await waitsForRecoveryKey(updated.sync);
    await updated.sync.stop();
    const reopened = computer('Sam’s Mac', mac.dataDir);
    await reopened.sync.start();
    await waitsForRecoveryKey(reopened.sync);

    // Its recovery key is for the key it has, which the account keeps, and syncing carries on.
    const saved = await recoveryKey(reopened.sync);
    expect(await reopened.sync.turnOn()).toEqual({ ok: true });
    await reopened.synced();
    expect((await person.client.keys())?.keyId).toBe(keyId);

    // What 0.1.0 never sent to the remade account went up too, so a new computer gets it all.
    const pc = computer('Sam’s PC');
    await pc.sync.start();
    expect(await pc.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(await pc.sync.useRecoveryKey(saved)).toEqual({ ok: true });
    await pc.synced();
    expect(pc.read('facts/skills.md')).toBe('Synced before the remake');
    expect(pc.read('facts/notes.md')).toBe('Sent by 0.1.0');
  });

  it('keeps what changes while it waits for the recovery key, as changes', async () => {
    const { mac } = await remadeUnderMac();
    await signInWithVersion010(mac.dataDir);
    mac.write('facts/edited.md', 'Before');
    mac.write('facts/deleted.md', 'Deleted while waiting');
    const updated = computer('Sam’s Mac', mac.dataDir);
    const at = '2026-10-13T10:00:00.000Z';
    const job = (company: string) => ({
      company,
      company_key: company.toLowerCase(),
      role: 'Staff',
      links: '[]',
      manual: 1,
      updated_at: at,
    });
    updated.tracker.applySyncRow('jobs', 'acme--staff', job('Acme'));
    updated.tracker.applySyncRow('jobs', 'beta--staff', job('Beta'));
    const call = {
      job_id: 'acme--staff',
      kind: 'phone',
      on_date: '2026-10-20',
      at_time: '10:00',
      state: 'scheduled',
      outcome: null,
      notes: null,
      created_at: at,
    };
    updated.tracker.applySyncRow('calls', 'call-1', call);
    await updated.sync.start();
    await waitsForRecoveryKey(updated.sync);

    // Sam keeps working before saving the recovery key.
    updated.write('facts/edited.md', 'Changed while waiting');
    rmSync(join(updated.workspace, 'facts', 'deleted.md'));
    updated.tracker.applySyncRow('jobs', 'beta--staff', null);
    updated.tracker.applySyncRow('calls', 'call-1', {
      ...call,
      state: 'done',
      outcome: 'Went well',
    });
    const saved = await recoveryKey(updated.sync);
    expect(await updated.sync.turnOn()).toEqual({ ok: true });
    await updated.synced();

    // Every change stays as made, here and on a new computer: no conflict copies, and nothing
    // deleted comes back.
    const pc = computer('Sam’s PC');
    await pc.sync.start();
    expect(await pc.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(await pc.sync.useRecoveryKey(saved)).toEqual({ ok: true });
    await pc.synced();
    for (const each of [updated, pc]) {
      expect(each.read('facts/edited.md')).toBe('Changed while waiting');
      expect(readdirSync(join(each.workspace, 'facts'))).toEqual(['edited.md']);
      expect(each.tracker.syncRow('jobs', 'beta--staff')).toBeNull();
      expect(each.tracker.syncRow('calls', 'call-1')).toMatchObject({
        state: 'done',
        outcome: 'Went well',
      });
    }
  });

  it('rebuilds what sync knew even if the app closes while the check stops sync', async () => {
    const { mac } = await remadeUnderMac({ 'facts/skills.md': 'Synced before the remake' });
    await signInWithVersion010(mac.dataDir);
    // The check's question about the account waits, then so does the next round, so the check
    // is waiting for that round to end when the app closes.
    const account = gate();
    let round: Gate | null = null;
    const updated = computer('Sam’s Mac', mac.dataDir, async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/account' && !account.waiting) {
        account.waiting = true;
        await account.opened;
      }
      if (round && path === '/api/sync/changes' && !init?.method) {
        round.waiting = true;
        await round.opened;
      }
      return fetch(input, init);
    });
    await updated.sync.start();
    await vi.waitFor(() => expect(account.waiting).toBe(true), { timeout: 10_000 });
    round = gate();
    updated.sync.requestSync();
    await vi.waitFor(() => expect(round?.waiting).toBe(true), { timeout: 10_000 });
    account.open();
    await vi.waitFor(() => expect(syncMeta(mac.dataDir, 'unchecked')).toBe('1'), {
      timeout: 10_000,
    });
    const closing = updated.sync.stop();
    round.open();
    await closing;

    const reopened = computer('Sam’s Mac', mac.dataDir);
    await reopened.sync.start();
    await waitsForRecoveryKey(reopened.sync);
    const saved = await recoveryKey(reopened.sync);
    expect(await reopened.sync.turnOn()).toEqual({ ok: true });
    await reopened.synced();
    const pc = computer('Sam’s PC');
    await pc.sync.start();
    expect(await pc.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(await pc.sync.useRecoveryKey(saved)).toEqual({ ok: true });
    await pc.synced();
    expect(pc.read('facts/skills.md')).toBe('Synced before the remake');
  });

  it('pays no mind to a late answer about the account it was signed in to before', async () => {
    const { mac, keyId } = await remadeUnderMac({ 'facts/skills.md': 'Sam’s job hunt' });
    await signInWithVersion010(mac.dataDir);
    const sam = person;
    const late = gate();
    let answered = false;
    const updated = computer('Sam’s Mac', mac.dataDir, async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(String(input)).pathname === '/api/account' && !late.waiting) {
        late.waiting = true;
        await late.opened;
        answered = true;
      }
      return response;
    });
    await updated.sync.start();
    await vi.waitFor(() => expect(late.waiting).toBe(true), { timeout: 10_000 });

    // Meanwhile the Mac is signed out, and Alex signs in on it, to an account with no key.
    const listed = await sam.client.account();
    for (const device of listed.devices) {
      if (device.name === 'Factwright on Sam’s Mac') await sam.client.removeDevice(device.id);
    }
    await signedOut(updated.sync);
    person = await server.signUp('Alex Kim');
    expect(await updated.sync.signInWithBrowser()).toEqual({ ok: true });
    const remade = { state: 'setting-up', email: person.email, firstDevice: true, again: 'remade' };
    expect(updated.sync.status()).toEqual(remade);

    // The late answer about Sam's account changes nothing for Alex's sign-in.
    late.open();
    await vi.waitFor(() => expect(answered).toBe(true), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(updated.sync.status()).toEqual(remade);
    await recoveryKey(updated.sync);
    expect(await updated.sync.turnOn()).toEqual({ ok: true });
    expect((await person.client.keys())?.keyId).not.toBe(keyId);
  });

  it('asks again on the next round when the check gets no answer', async () => {
    const { mac } = await remadeUnderMac();
    await signInWithVersion010(mac.dataDir);
    let answers = false;
    let asked = 0;
    const updated = computer('Sam’s Mac', mac.dataDir, async (input, init) => {
      if (new URL(String(input)).pathname === '/api/sync/keys') {
        asked += 1;
        if (!answers) throw new TypeError('fetch failed');
      }
      return fetch(input, init);
    });
    await updated.sync.start();
    await vi.waitFor(() => expect(asked).toBe(1), { timeout: 10_000 });
    await updated.synced();
    answers = true;
    updated.sync.requestSync();
    await waitsForRecoveryKey(updated.sync);
    expect(asked).toBeGreaterThanOrEqual(2);
  });

  it('carries on with no new recovery key when another computer kept the same key and saved one', async () => {
    const { mac, pc, keyId } = await remadeUnderMacAndPc();
    // The Mac saves its recovery key first; the PC, asked after, has none to make.
    await recoveryKey(mac.sync);
    expect(await mac.sync.turnOn()).toEqual({ ok: true });
    expect(await pc.sync.newRecoveryKey()).toEqual({ ok: true, recoveryKey: null });
    expect(pc.sync.status()).toMatchObject({ state: 'on' });
    expect((await person.client.keys())?.keyId).toBe(keyId);
    pc.write('facts/from-pc.md', 'From the PC');
    pc.sync.requestSync();
    await vi.waitFor(() => expect(mac.read('facts/from-pc.md')).toBe('From the PC'), {
      timeout: 10_000,
    });
  });

  it('carries on when another computer that kept the same key saved its recovery key first', async () => {
    const { mac, pc, keyId } = await remadeUnderMacAndPc();
    // Both show a recovery key, and the Mac's is saved first.
    await recoveryKey(pc.sync);
    await recoveryKey(mac.sync);
    expect(await mac.sync.turnOn()).toEqual({ ok: true });
    expect(await pc.sync.turnOn()).toEqual({ ok: true });
    expect(pc.sync.status()).toMatchObject({ state: 'on' });
    expect((await person.client.keys())?.keyId).toBe(keyId);
  });

  it('ends the sign-in on the recovery key step, and asks again after signing back in', async () => {
    const { mac, keyId } = await remadeUnderMac();
    await signInWithVersion010(mac.dataDir);
    const updated = computer('Sam’s Mac', mac.dataDir);
    await updated.sync.start();
    await waitsForRecoveryKey(updated.sync);
    expect(await updated.sync.useDifferentAccount()).toEqual({ ok: true });
    expect(updated.sync.status()).toMatchObject({ state: 'signed-out' });
    expect(await updated.sync.signInWithBrowser()).toEqual({ ok: true });
    await waitsForRecoveryKey(updated.sync);
    await recoveryKey(updated.sync);
    expect(await updated.sync.turnOn()).toEqual({ ok: true });
    expect((await person.client.keys())?.keyId).toBe(keyId);
  });

  it('stops when 0.1.0 synced under its old key after another device made a new one, and links', async () => {
    const mac = computer('Sam’s Mac');
    mac.write('facts/skills.md', 'From the Mac');
    await setUpFirst(mac);
    await mac.synced();
    await remakeAccount();
    mac.sync.requestSync();
    await vi.waitFor(() => expect(mac.sync.status()).toMatchObject({ state: 'signed-out' }), {
      timeout: 10_000,
    });
    await mac.sync.stop();

    // The PC sets up the remade account with a new key, then the Mac signs in again on 0.1.0.
    const pc = computer('Sam’s PC');
    pc.write('facts/education.md', 'From the PC');
    await setUpFirst(pc);
    await pc.synced();
    await signInWithVersion010(mac.dataDir);

    const updated = computer('Sam’s Mac', mac.dataDir);
    await updated.sync.start();
    const linking = {
      state: 'setting-up',
      email: person.email,
      firstDevice: false,
      again: 'changed',
    };
    await vi.waitFor(() => expect(updated.sync.status()).toEqual(linking), { timeout: 10_000 });
    await updated.sync.stop();
    const reopened = computer('Sam’s Mac', mac.dataDir);
    await reopened.sync.start();
    expect(reopened.sync.status()).toEqual(linking);

    // Linked with a code from the PC, each gets the other's job hunt.
    const link = await pc.sync.makeLinkCode();
    if (!link.ok) throw new Error(link.message);
    expect(await reopened.sync.linkWithCode(link.link.code)).toEqual({ ok: true });
    await reopened.synced();
    expect(reopened.read('facts/education.md')).toBe('From the PC');
    pc.sync.requestSync();
    await vi.waitFor(() => expect(pc.read('facts/skills.md')).toBe('From the Mac'), {
      timeout: 10_000,
    });
  });

  it('says why when the account can’t be checked after signing in again, and syncs nothing', async () => {
    const mac = computer('Sam’s Mac');
    await setUpFirst(mac);
    await mac.synced();
    const listed = await mac.sync.account();
    if (!listed.ok) throw new Error(listed.message);
    const own = listed.account.devices.find((device) => device.current);
    await (await server.newSession(person.id)).client.removeDevice(own?.id ?? '');
    mac.sync.requestSync();
    await vi.waitFor(() => expect(mac.sync.status()).toMatchObject({ state: 'signed-out' }), {
      timeout: 10_000,
    });
    await mac.sync.stop();
    // The same Mac, opened again while the server can't answer about the account's key.
    const flaky = computer('Sam’s Mac', mac.dataDir, async (input, init) => {
      if (String(input).includes('/api/sync/keys')) throw new TypeError('fetch failed');
      return fetch(input, init);
    });
    await flaky.sync.start();
    expect(await flaky.sync.signInWithBrowser()).toMatchObject({
      ok: false,
      message: expect.stringContaining('Can’t reach the sync server'),
    });
    expect(flaky.sync.status()).toMatchObject({ state: 'signed-out' });
  });

  it('turns off on this computer, keeping the job hunt here', async () => {
    const mac = computer('Sam’s Mac');
    mac.write('facts/skills.md', 'Stays');
    await setUpFirst(mac);
    await mac.synced();
    expect(await mac.sync.signOut()).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual({ state: 'off' });
    expect(mac.read('facts/skills.md')).toBe('Stays');
    expect(existsSync(join(mac.dataDir, 'sync', 'secrets.json'))).toBe(false);
  });
});
