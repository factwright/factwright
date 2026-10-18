import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
import { NO_KEYCHAIN, NO_KEYCHAIN_MESSAGE, Secrets } from './secrets.ts';

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
/** The same person, on a server of their own, for the tests that start one. */
let ownPerson: Account;
/** A server that sells sync, as Factwright's will, for the tests that start one, and the person on it. */
let selling: TestServer | undefined;
let seller: Account;
const folders: string[] = [];
const opened: SyncAccount[] = [];

beforeEach(async () => {
  person = await server.signUp('Sam Rivera');
});

afterEach(async () => {
  for (const sync of opened.splice(0)) await sync.stop();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The person, in their browser, approving the code a computer shows, on the server it's for. */
async function approve(url: string) {
  const { origin, searchParams } = new URL(url);
  const userCode = searchParams.get('user_code') ?? '';
  const signedIn =
    origin === server.url.origin ? person : origin === selling?.url.origin ? seller : ownPerson;
  const headers = { authorization: `Bearer ${signedIn.token}`, 'content-type': 'application/json' };
  await fetch(new URL(`/api/auth/device?user_code=${userCode}`, origin), { headers });
  await fetch(new URL('/api/auth/device/approve', origin), {
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
  otherProfiles?: () => { name: string; email: string; server: string | null }[],
  factwright: string | null = server.url.toString(),
) {
  folders.push(dataDir);
  const workspace = join(dataDir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const tracker = new Tracker(join(dataDir, 'tracker.db'));
  const statuses: SyncStatus[] = [];
  const applied = vi.fn();
  // The pages the app opens in the browser: the person approves a sign-in's code there.
  const pages: string[] = [];
  const sync = new SyncAccount({
    dataDir,
    server: factwright,
    version: '0.0.0',
    keychain,
    tracker,
    workspace,
    openUrl: async (url) => {
      pages.push(url);
      if (new URL(url).pathname === '/device') await approve(url);
    },
    onStatus: (status) => statuses.push(status),
    onApplied: applied,
    computerName: async () => name,
    sleep: async () => {},
    subscriptionWait: (ms) => new Promise((done) => setTimeout(done, Math.min(ms, 25))),
    ...(fetchWith && { fetch: fetchWith }),
    ...(otherProfiles && { otherProfiles }),
  });
  opened.push(sync);
  return {
    sync,
    dataDir,
    workspace,
    tracker,
    applied,
    statuses,
    pages,
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

/** Waits for a computer to stop, asking for a new account key and recovery key. */
async function waitsForNewKey(sync: SyncAccount) {
  await vi.waitFor(
    () =>
      expect(sync.status()).toEqual({
        state: 'setting-up',
        email: person.email,
        firstDevice: true,
        again: 'remade',
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
 * and made it again. Updated, each waits to make a new key.
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
    await waitsForNewKey(each.sync);
  }
  return { mac, pc, keyId };
}

describe('a copy built without Factwright’s sync', () => {
  const refused = { ok: false, message: 'This copy of Factwright doesn’t have Factwright’s sync.' };

  /** The app, built without Factwright's sync, on a data folder. */
  function withoutServer(dataDir: string) {
    const openUrl = vi.fn();
    const sync = new SyncAccount({
      dataDir,
      server: null,
      version: '0.0.0',
      keychain,
      tracker: new Tracker(join(dataDir, 'tracker.db')),
      workspace: join(dataDir, 'workspace'),
      openUrl,
      onStatus: () => {},
      onApplied: vi.fn(),
      computerName: async () => 'Sam’s Mac',
    });
    opened.push(sync);
    return { sync, openUrl };
  }

  it('is off, offering only a server of your own, and never signs in to Factwright’s', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'factwright-account-'));
    folders.push(dataDir);
    const { sync, openUrl } = withoutServer(dataDir);
    await sync.start();
    expect(sync.status()).toEqual({ state: 'off' });
    expect(await sync.signInWithBrowser()).toEqual(refused);
    expect(sync.status()).toEqual({ state: 'off' });
    expect(await sync.serverTerms()).toBeNull();
    await sync.openAccountPage();
    expect(openUrl).not.toHaveBeenCalled();
  });

  // Such as one run from the code on the data folder of a copy installed from factwright.com.
  it('leaves sync as a copy with Factwright’s set it up, without asking the keychain', async () => {
    const mac = computer('Sam’s Mac');
    await setUpFirst(mac);
    await mac.synced();
    await mac.sync.stop();
    const secrets = join(mac.dataDir, 'sync', 'secrets.json');
    const kept = readFileSync(secrets, 'utf8');
    const known = ['keyId', 'account'].map((key) => syncMeta(mac.dataDir, key));
    expect(known).not.toContain(null);
    const asked = [
      vi.spyOn(keychain, 'isEncryptionAvailable'),
      vi.spyOn(keychain, 'decryptString'),
    ];
    try {
      const { sync, openUrl } = withoutServer(mac.dataDir);
      await sync.start();
      expect(sync.status()).toEqual({ state: 'no-server' });
      expect(await sync.signOut()).toEqual(refused);
      expect(await sync.useDifferentAccount()).toEqual(refused);
      expect(await sync.signInWithBrowser()).toEqual(refused);
      expect(await sync.connect('https://factwright-sync.sam.workers.dev')).toEqual({
        ok: false,
        message: 'Turn off sync on this computer first, then connect your server.',
      });
      expect(sync.status()).toEqual({ state: 'no-server' });
      expect(openUrl).not.toHaveBeenCalled();
      await sync.stop();
      for (const spy of asked) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of asked) spy.mockRestore();
    }
    expect(readFileSync(secrets, 'utf8')).toBe(kept);
    expect(['keyId', 'account'].map((key) => syncMeta(mac.dataDir, key))).toEqual(known);
    // The copy with the server picks sync up where it left off.
    const again = computer('Sam’s Mac', mac.dataDir);
    await again.sync.start();
    expect(again.sync.status()).toMatchObject({ state: 'on', email: person.email });
  });
});

// An installed copy that another program drives through Chromium's debugging port, as tests do,
// gets no keychain for sync, since on a Mac every copy shares one Keychain item.
describe('a copy without the keychain', () => {
  const refused = { ok: false, message: NO_KEYCHAIN_MESSAGE };

  /** The app with no keychain, on a data folder of its own, noting what it asks the server. */
  function withoutKeychain(dataDir: string) {
    folders.push(dataDir);
    const asked: string[] = [];
    const openUrl = vi.fn();
    const sync = new SyncAccount({
      dataDir,
      server: server.url.toString(),
      version: '0.0.0',
      keychain: NO_KEYCHAIN,
      tracker: new Tracker(join(dataDir, 'tracker.db')),
      workspace: join(dataDir, 'workspace'),
      openUrl,
      onStatus: () => {},
      onApplied: vi.fn(),
      computerName: async () => 'Sam’s Mac',
      sleep: async () => {},
      fetch: async (input, init) => {
        asked.push(String(input));
        return fetch(input, init);
      },
    });
    opened.push(sync);
    return { sync, asked, openUrl };
  }

  it('can’t turn on, and never asks the server', async () => {
    const { sync, asked, openUrl } = withoutKeychain(
      mkdtempSync(join(tmpdir(), 'factwright-account-')),
    );
    await sync.start();
    expect(sync.status()).toEqual({ state: 'off' });
    expect(await sync.signInWithBrowser()).toEqual(refused);
    expect(sync.status()).toEqual({ state: 'unavailable' });
    expect(asked).toEqual([]);
    expect(openUrl).not.toHaveBeenCalled();
  });

  // Such as a copy started for a test on a folder that has the user's sync folder in it.
  it('leaves keys copied or linked into its folder locked, and as they are', async () => {
    const mac = computer('Sam’s Mac');
    await setUpFirst(mac);
    await mac.synced();
    await mac.sync.stop();
    const secrets = join(mac.dataDir, 'sync', 'secrets.json');
    const kept = readFileSync(secrets, 'utf8');
    const put = [
      (into: string) => copyFileSync(secrets, into),
      (into: string) => symlinkSync(secrets, into),
    ];
    for (const putIn of put) {
      const dataDir = mkdtempSync(join(tmpdir(), 'factwright-account-'));
      mkdirSync(join(dataDir, 'sync'));
      putIn(join(dataDir, 'sync', 'secrets.json'));
      const { sync, asked, openUrl } = withoutKeychain(dataDir);
      await sync.start();
      expect(sync.status()).toEqual({ state: 'unavailable' });
      expect(await sync.signInWithBrowser()).toEqual(refused);
      expect(await sync.useDifferentAccount()).toEqual(refused);
      expect(await sync.signOut()).toEqual(refused);
      expect(sync.status()).toEqual({ state: 'unavailable' });
      await sync.stop();
      expect(asked).toEqual([]);
      expect(openUrl).not.toHaveBeenCalled();
      expect(readFileSync(join(dataDir, 'sync', 'secrets.json'), 'utf8')).toBe(kept);
    }
    expect(readFileSync(secrets, 'utf8')).toBe(kept);
    // The computer whose keys they are carries on syncing with them.
    const again = computer('Sam’s Mac', mac.dataDir);
    await again.sync.start();
    expect(again.sync.status()).toMatchObject({ state: 'on', email: person.email });
  });

  it('leaves a sign-in to a server of your own locked, and as it is', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'factwright-account-'));
    mkdirSync(join(dataDir, 'sync'));
    const planted = JSON.stringify({
      ownSession: keychain
        .encryptString(
          JSON.stringify({ server: 'https://factwright-sync.sam.workers.dev', token: 'x' }),
        )
        .toString('base64'),
      ownAccountKey: keychain.encryptString('made-up key').toString('base64'),
    });
    writeFileSync(join(dataDir, 'sync', 'secrets.json'), planted);
    const { sync, asked, openUrl } = withoutKeychain(dataDir);
    await sync.start();
    expect(sync.status()).toEqual({ state: 'unavailable' });
    expect(await sync.connect('https://factwright-sync.alex.workers.dev')).toEqual({
      ok: false,
      message: 'Turn off sync on this computer first, then connect your server.',
    });
    expect(await sync.signOut()).toEqual(refused);
    await sync.stop();
    expect(asked).toEqual([]);
    expect(openUrl).not.toHaveBeenCalled();
    expect(readFileSync(join(dataDir, 'sync', 'secrets.json'), 'utf8')).toBe(planted);
  });
});

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
    // The link step then says the PC's recovery key won't open the account.
    expect(pc.sync.status()).toMatchObject({
      state: 'setting-up',
      firstDevice: false,
      again: 'taken',
    });
  });

  it('stops a step still waiting on the server when the sign-in ends', async () => {
    const save = gate();
    const signOut = gate();
    const mac = computer('Sam’s Mac', undefined, async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/sync/keys' && init?.method === 'PUT' && !save.waiting) {
        save.waiting = true;
        await save.opened;
      }
      if (path === '/api/auth/sign-out' && !signOut.waiting) {
        signOut.waiting = true;
        await signOut.opened;
      }
      return fetch(input, init);
    });
    mac.write('facts/skills.md', 'Stays on the Mac');
    await mac.sync.start();
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    await recoveryKey(mac.sync);
    const turningOn = mac.sync.turnOn();
    await vi.waitFor(() => expect(save.waiting).toBe(true), { timeout: 10_000 });
    // Not the account Sam meant: that sign-in ends while the key is still being saved, and the
    // key is saved before the server hears of the sign-out.
    const ending = mac.sync.useDifferentAccount();
    await vi.waitFor(() => expect(signOut.waiting).toBe(true), { timeout: 10_000 });
    save.open();
    expect(await turningOn).toMatchObject({ ok: false });
    signOut.open();
    expect(await ending).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual({ state: 'off' });
    // Nothing went up to the account Sam left.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await person.client.changes(0)).changes).toEqual([]);
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

  it('turns away an account another profile on this computer syncs with, keeping none of it', async () => {
    const mac = computer('Sam’s Mac');
    await setUpFirst(mac);
    // Someone else's profile on the same Mac, in a browser still signed in as Sam.
    const other = computer('Sam’s Mac', undefined, undefined, () => [
      { name: 'Sam Rivera', email: person.email.toUpperCase(), server: null },
    ]);
    await other.sync.start();
    expect(await other.sync.signInWithBrowser()).toEqual({
      ok: false,
      message:
        'The profile “Sam Rivera” on this computer syncs with that account, and each profile needs its own. If your browser signed in as someone else, sign out of Factwright there first.',
    });
    expect(other.sync.status()).toEqual({ state: 'off' });
    expect(new Secrets(join(other.dataDir, 'sync', 'secrets.json'), keychain).get('session')).toBe(
      null,
    );
    // Its sign-in ended on the server too: the Mac's first profile is the only one signed in.
    const listed = await person.client.account();
    const macs = listed.devices.filter((device) => device.name === 'Factwright on Sam’s Mac');
    expect(macs).toHaveLength(1);
  });

  it('keeps nothing of a sign-in canceled while its account is checked', async () => {
    const mac = computer('Sam’s Mac');
    await setUpFirst(mac);
    const checking = gate();
    const other = computer(
      'Sam’s Mac',
      undefined,
      async (input, init) => {
        if (new URL(String(input)).pathname === '/api/account' && !checking.waiting) {
          checking.waiting = true;
          await checking.opened;
        }
        return fetch(input, init);
      },
      () => [{ name: 'Alex', email: 'alex@example.com', server: null }],
    );
    await other.sync.start();
    const signingIn = other.sync.signInWithBrowser();
    await vi.waitFor(() => expect(checking.waiting).toBe(true), { timeout: 10_000 });
    other.sync.cancelSignIn();
    checking.open();
    expect(await signingIn).toEqual({ ok: false, message: 'Signing in was canceled.' });
    expect(other.sync.status()).toEqual({ state: 'off' });
    expect(new Secrets(join(other.dataDir, 'sync', 'secrets.json'), keychain).get('session')).toBe(
      null,
    );
    const listed = await person.client.account();
    const macs = listed.devices.filter((device) => device.name === 'Factwright on Sam’s Mac');
    expect(macs).toHaveLength(1);
  });

  it('signs another profile in to an account of its own', async () => {
    const sam = person;
    await setUpFirst(computer('Sam’s Mac'));
    person = await server.signUp('Alex Kim');
    const other = computer('Sam’s Mac', undefined, undefined, () => [
      { name: 'Sam Rivera', email: sam.email, server: null },
    ]);
    await other.sync.start();
    expect(await other.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(other.sync.status()).toEqual({
      state: 'setting-up',
      email: person.email,
      firstDevice: true,
    });
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

  it('stops when 0.1.0 synced a remade account without its key, and makes a new one', async () => {
    const { mac, keyId } = await remadeUnderMac({ 'facts/skills.md': 'Synced before the remake' });
    await signInWithVersion010(mac.dataDir);
    // 0.1.0 sends what changes after it signs in again, under its old key.
    mac.write('facts/notes.md', 'Sent by 0.1.0');

    // Updated, the Mac syncs as before, until it finds the account has no key on the server.
    const updated = computer('Sam’s Mac', mac.dataDir);
    await updated.sync.start();
    await waitsForNewKey(updated.sync);
    await updated.sync.stop();
    const reopened = computer('Sam’s Mac', mac.dataDir);
    await reopened.sync.start();
    await waitsForNewKey(reopened.sync);

    // A new account key and recovery key, as after signing in again to a remade account.
    const saved = await recoveryKey(reopened.sync);
    expect(await reopened.sync.turnOn()).toEqual({ ok: true });
    await reopened.synced();
    expect((await person.client.keys())?.keyId).not.toBe(keyId);

    // Everything on the Mac went up under the new key, so a new computer gets all of it.
    const pc = computer('Sam’s PC');
    await pc.sync.start();
    expect(await pc.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(await pc.sync.useRecoveryKey(saved)).toEqual({ ok: true });
    await pc.synced();
    expect(pc.read('facts/skills.md')).toBe('Synced before the remake');
    expect(pc.read('facts/notes.md')).toBe('Sent by 0.1.0');
  });

  it('keeps what changes while it waits for the new recovery key', async () => {
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
    await waitsForNewKey(updated.sync);

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
    // deleted comes back from what 0.1.0 sent under the old key.
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

  it('asks again after a restart, even if the app closes while the check stops sync', async () => {
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
    await waitsForNewKey(reopened.sync);
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

  it('pays no mind to a late answer as it opens, once someone else has signed in', async () => {
    const { mac } = await remadeUnderMac({ 'facts/skills.md': 'Sam’s job hunt' });
    await signInWithVersion010(mac.dataDir);
    const updated = computer('Sam’s Mac', mac.dataDir);
    await updated.sync.start();
    await waitsForNewKey(updated.sync);
    await updated.sync.stop();

    // Opened again, the Mac asks about Sam's account, and the answer is slow.
    const late = gate();
    let answered = false;
    const reopened = computer('Sam’s Mac', mac.dataDir, async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(String(input)).pathname === '/api/sync/keys' && !late.waiting) {
        late.waiting = true;
        await late.opened;
        answered = true;
      }
      return response;
    });
    const opening = reopened.sync.start();
    await vi.waitFor(() => expect(late.waiting).toBe(true), { timeout: 10_000 });

    // Meanwhile that sign-in ends here, and Alex signs in.
    expect(await reopened.sync.useDifferentAccount()).toEqual({ ok: true });
    person = await server.signUp('Alex Kim');
    expect(await reopened.sync.signInWithBrowser()).toEqual({ ok: true });
    const alex = { state: 'setting-up', email: person.email, firstDevice: true, again: 'remade' };
    expect(reopened.sync.status()).toEqual(alex);
    late.open();
    await opening;
    expect(answered).toBe(true);
    expect(reopened.sync.status()).toEqual(alex);
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
    await waitsForNewKey(updated.sync);
    expect(asked).toBeGreaterThanOrEqual(2);
  });

  it('links a second computer that kept the old key to the first one’s new key', async () => {
    const { mac, pc, keyId } = await remadeUnderMacAndPc();
    mac.write('facts/from-mac.md', 'From the Mac');
    pc.write('facts/from-pc.md', 'From the PC');
    // The Mac makes the new key first; the PC, trying after, is told to link instead.
    await recoveryKey(mac.sync);
    expect(await mac.sync.turnOn()).toEqual({ ok: true });
    await mac.synced();
    await recoveryKey(pc.sync);
    expect(await pc.sync.turnOn()).toMatchObject({
      ok: false,
      message: expect.stringContaining('Link this computer'),
    });
    expect(pc.sync.status()).toMatchObject({ state: 'setting-up', firstDevice: false });
    const link = await mac.sync.makeLinkCode();
    if (!link.ok) throw new Error(link.message);
    expect(await pc.sync.linkWithCode(link.link.code)).toEqual({ ok: true });
    await pc.synced();
    expect((await person.client.keys())?.keyId).not.toBe(keyId);
    expect(pc.read('facts/from-mac.md')).toBe('From the Mac');
    mac.sync.requestSync();
    await vi.waitFor(() => expect(mac.read('facts/from-pc.md')).toBe('From the PC'), {
      timeout: 10_000,
    });
  });

  it('ends the sign-in on the recovery key step, and asks again after signing back in', async () => {
    const { mac, keyId } = await remadeUnderMac();
    await signInWithVersion010(mac.dataDir);
    const updated = computer('Sam’s Mac', mac.dataDir);
    await updated.sync.start();
    await waitsForNewKey(updated.sync);
    expect(await updated.sync.useDifferentAccount()).toEqual({ ok: true });
    expect(updated.sync.status()).toMatchObject({ state: 'signed-out' });
    expect(await updated.sync.signInWithBrowser()).toEqual({ ok: true });
    await waitsForNewKey(updated.sync);
    await recoveryKey(updated.sync);
    expect(await updated.sync.turnOn()).toEqual({ ok: true });
    expect((await person.client.keys())?.keyId).not.toBe(keyId);
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

describe('a server of your own', () => {
  let own: TestServer;
  let address: string;

  beforeAll(async () => {
    // As a server of your own runs: with GitHub sign-in, and without Factwright's terms and
    // privacy policy.
    own = await startServer({
      TERMS_URL: '',
      PRIVACY_URL: '',
      GITHUB_CLIENT_ID: 'test-client',
      GITHUB_CLIENT_SECRET: 'test-secret',
    });
    address = own.url.origin;
  });

  afterAll(() => own?.close());

  beforeEach(async () => {
    ownPerson = await own.signUp('Sam Rivera');
  });

  /** A fetch that notes the server each request goes to. */
  function noting() {
    const asked: string[] = [];
    const fetchWith: typeof fetch = async (input, init) => {
      asked.push(new URL(String(input)).origin);
      return fetch(input, init);
    };
    return { asked, fetchWith };
  }

  /** Connects a computer to the server of your own, and turns sync on there as its first device. */
  async function setUpOwn(mac: ReturnType<typeof computer>) {
    await mac.sync.start();
    expect(await mac.sync.connect(address)).toEqual({ ok: true });
    await recoveryKey(mac.sync);
    expect(await mac.sync.turnOn()).toEqual({ ok: true });
    await mac.synced();
  }

  /** What sync keeps secret on a computer, opened with the stand-in keychain. */
  const secretsOf = (dataDir: string) =>
    new Secrets(join(dataDir, 'sync', 'secrets.json'), keychain);

  it('connects, names it at every step, and keeps the sign-in with its address', async () => {
    const mac = computer('Sam’s Mac');
    await mac.sync.start();
    expect(await mac.sync.serverTerms()).toEqual({
      legal: { terms: 'https://factwright.com/terms', privacy: 'https://factwright.com/privacy' },
      subscription: false,
    });
    expect(await mac.sync.connect(`  ${address}/  `)).toEqual({ ok: true });
    expect(mac.statuses).toContainEqual(
      expect.objectContaining({ state: 'signing-in', ownServer: address }),
    );
    expect(mac.sync.status()).toEqual({
      state: 'setting-up',
      email: ownPerson.email,
      firstDevice: true,
      ownServer: address,
    });
    await recoveryKey(mac.sync);
    expect(await mac.sync.turnOn()).toEqual({ ok: true });
    await mac.synced();
    expect(mac.sync.status()).toMatchObject({ state: 'on', ownServer: address });
    // It has no terms of its own, so none show.
    expect(await mac.sync.serverTerms()).toEqual({ legal: null, subscription: false });
    const secrets = secretsOf(mac.dataDir);
    expect(secrets.get('session')).toBeNull();
    expect(JSON.parse(secrets.get('ownSession') ?? '')).toEqual({
      server: address,
      token: expect.any(String),
    });
    // Its account key is kept apart from Factwright's too, which a version from before reads.
    expect(secrets.get('ownAccountKey')).toEqual(expect.any(String));
    expect(secrets.has('accountKey')).toBe(false);
    expect(syncMeta(mac.dataDir, 'server')).toBe(address);

    // Opened again, it carries on with the same server.
    await mac.sync.stop();
    const again = computer('Sam’s Mac', mac.dataDir);
    await again.sync.start();
    expect(again.sync.status()).toMatchObject({ state: 'on', ownServer: address });
  });

  it('sends everything only to that server: syncing, links, and the account page', async () => {
    const { asked, fetchWith } = noting();
    const mac = computer('Sam’s Mac', undefined, fetchWith);
    await setUpOwn(mac);
    const link = await mac.sync.makeLinkCode();
    if (!link.ok) throw new Error(link.message);
    expect(new URL(link.link.url).origin).toBe(address);
    await mac.sync.stop();
    // Opened again, in a copy built with Factwright's own sync, it still goes there alone.
    const openUrl = vi.fn();
    const again = new SyncAccount({
      dataDir: mac.dataDir,
      server: server.url.toString(),
      version: '0.0.0',
      keychain,
      tracker: mac.tracker,
      workspace: mac.workspace,
      openUrl,
      onStatus: () => {},
      onApplied: vi.fn(),
      computerName: async () => 'Sam’s Mac',
      fetch: fetchWith,
    });
    opened.push(again);
    await again.start();
    await again.openAccountPage();
    expect(openUrl).toHaveBeenCalledWith(`${address}/account`);
    await again.stop();
    expect(asked.length).toBeGreaterThan(0);
    expect(new Set(asked)).toEqual(new Set([address]));
  });

  it('syncs a second computer through it, linked with a code', async () => {
    const mac = computer('Sam’s Mac');
    mac.write('facts/skills.md', 'From the Mac');
    await setUpOwn(mac);
    const link = await mac.sync.makeLinkCode();
    if (!link.ok) throw new Error(link.message);
    const pc = computer('Sam’s PC');
    await pc.sync.start();
    expect(await pc.sync.connect(address)).toEqual({ ok: true });
    expect(pc.sync.status()).toMatchObject({ state: 'setting-up', firstDevice: false });
    expect(await pc.sync.linkWithCode(link.link.code)).toEqual({ ok: true });
    await pc.synced();
    expect(pc.read('facts/skills.md')).toBe('From the Mac');
  });

  it('won’t connect another server until sync is turned off here, then forgets this one', async () => {
    const { asked, fetchWith } = noting();
    const mac = computer('Sam’s Mac', undefined, fetchWith);
    await setUpOwn(mac);
    const refused = {
      ok: false,
      message: 'Turn off sync on this computer first, then connect your server.',
    };
    expect(await mac.sync.connect('https://factwright-sync.alex.workers.dev')).toEqual(refused);
    expect(await mac.sync.signOut()).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual({ state: 'off' });
    expect(existsSync(join(mac.dataDir, 'sync', 'secrets.json'))).toBe(false);
    expect(syncMeta(mac.dataDir, 'server')).toBeNull();
    // Its sign-in ended on that server too.
    const left = await ownPerson.client.account();
    expect(left.devices.map((device) => device.name)).not.toContain('Factwright on Sam’s Mac');

    // Now Factwright's own sync, kept as its sign-in always was, with nothing sent to the other.
    asked.length = 0;
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual({
      state: 'setting-up',
      email: person.email,
      firstDevice: true,
    });
    expect(new Set(asked)).toEqual(new Set([server.url.origin]));
    const secrets = secretsOf(mac.dataDir);
    expect(secrets.has('ownSession')).toBe(false);
    expect(secrets.get('session')).toEqual(expect.any(String));
  });

  it('signs in to it again once its sign-in ends, even after a restart', async () => {
    const mac = computer('Sam’s Mac');
    await setUpOwn(mac);
    const listed = await mac.sync.account();
    if (!listed.ok) throw new Error(listed.message);
    const here = listed.account.devices.find((device) => device.current);
    await ownPerson.client.removeDevice(here?.id ?? '');
    mac.sync.requestSync();
    const signedOut = { state: 'signed-out', email: ownPerson.email, ownServer: address };
    await vi.waitFor(() => expect(mac.sync.status()).toEqual(signedOut), { timeout: 10_000 });
    // The token's gone, and the address stays.
    expect(JSON.parse(secretsOf(mac.dataDir).get('ownSession') ?? '')).toEqual({
      server: address,
    });
    await mac.sync.stop();
    const again = computer('Sam’s Mac', mac.dataDir);
    await again.sync.start();
    expect(again.sync.status()).toEqual(signedOut);
    expect(await again.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(again.sync.status()).toMatchObject({ state: 'on', ownServer: address });
  });

  it('signs in to it again after the wrong account, before anything is set up', async () => {
    const { asked, fetchWith } = noting();
    const mac = computer('Sam’s Mac', undefined, fetchWith);
    await mac.sync.start();
    expect(await mac.sync.connect(address)).toEqual({ ok: true });
    // As when the link step's Sign in again ends the old sign-in, then starts a new one.
    expect(await mac.sync.useDifferentAccount()).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual({
      state: 'signed-out',
      email: ownPerson.email,
      ownServer: address,
    });
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(mac.sync.status()).toMatchObject({ state: 'setting-up', ownServer: address });
    expect(new Set(asked)).toEqual(new Set([address]));
    // Turning sync off is what frees it for another server.
    expect(await mac.sync.signOut()).toEqual({ ok: true });
    expect(existsSync(join(mac.dataDir, 'sync', 'secrets.json'))).toBe(false);
  });

  it('syncs a copy without Factwright’s sync', async () => {
    const mac = computer('Sam’s Mac', undefined, undefined, undefined, null);
    await setUpOwn(mac);
    expect(mac.sync.status()).toMatchObject({ state: 'on', ownServer: address });
    await mac.sync.stop();
    const again = computer('Sam’s Mac', mac.dataDir, undefined, undefined, null);
    await again.sync.start();
    expect(again.sync.status()).toMatchObject({ state: 'on', ownServer: address });
  });

  it('goes by Factwright’s own sign-in when a version from before kept one beside it', async () => {
    const mac = computer('Sam’s Mac');
    await setUpOwn(mac);
    await mac.sync.stop();
    // A version from before servers of your own signed in to Factwright's, beside it.
    secretsOf(mac.dataDir).set(
      'session',
      (await server.newSession(person.id, undefined, 'device')).token,
    );
    const { asked, fetchWith } = noting();
    const again = computer('Sam’s Mac', mac.dataDir, fetchWith);
    await again.sync.start();
    // That account has no key yet, so this computer sets it up as its first device, with nothing
    // of the other server's: its sign-in, its account key and its notes are gone.
    expect(again.sync.status()).toEqual({
      state: 'setting-up',
      email: person.email,
      firstDevice: true,
    });
    expect(new Set(asked)).toEqual(new Set([server.url.origin]));
    const secrets = secretsOf(mac.dataDir);
    expect(secrets.has('ownSession') || secrets.has('ownAccountKey')).toBe(false);
    expect(syncMeta(mac.dataDir, 'server')).toBeNull();
  });

  it('keeps an account key a version from before left as Factwright’s, never its own', async () => {
    const mac = computer('Sam’s Mac');
    await setUpOwn(mac);
    await mac.sync.stop();
    // A version from before linked to Factwright's beside it, and was signed out there since.
    const file = join(mac.dataDir, 'sync', 'secrets.json');
    secretsOf(mac.dataDir).set('accountKey', 'A-key-for-Factwrights-account');
    const kept = readFileSync(file, 'utf8');
    // A copy without Factwright's sync leaves all of it, and never asks the keychain.
    const asked = [
      vi.spyOn(keychain, 'isEncryptionAvailable'),
      vi.spyOn(keychain, 'decryptString'),
    ];
    try {
      const without = computer('Sam’s Mac', mac.dataDir, undefined, undefined, null);
      await without.sync.start();
      expect(without.sync.status()).toEqual({ state: 'no-server' });
      await without.sync.stop();
      for (const spy of asked) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of asked) spy.mockRestore();
    }
    expect(readFileSync(file, 'utf8')).toBe(kept);
    // A copy with it takes it as Factwright's, and drops what's older, for your own server.
    const again = computer('Sam’s Mac', mac.dataDir);
    await again.sync.start();
    expect(again.sync.status()).toEqual({ state: 'off' });
    const secrets = secretsOf(mac.dataDir);
    expect(secrets.get('accountKey')).toBe('A-key-for-Factwrights-account');
    expect(secrets.has('ownSession') || secrets.has('ownAccountKey')).toBe(false);
  });

  it('checks an account another profile syncs with by its server too', async () => {
    const elsewhere = () => [{ name: 'Alex Kim', email: ownPerson.email, server: null }];
    const mac = computer('Sam’s Mac', undefined, undefined, elsewhere);
    await mac.sync.start();
    // The same email on Factwright's own server is another account.
    expect(await mac.sync.connect(address)).toEqual({ ok: true });

    const same = () => [{ name: 'Alex Kim', email: ownPerson.email, server: address }];
    const pc = computer('Sam’s Mac', undefined, undefined, same);
    await pc.sync.start();
    expect(await pc.sync.connect(address)).toEqual({
      ok: false,
      message:
        'The profile “Alex Kim” on this computer syncs with that account, and each profile needs its own. If your browser signed in as someone else, sign out of Factwright there first.',
    });
    expect(pc.sync.status()).toEqual({ state: 'off' });
  });

  describe('checking it first', () => {
    const fake = 'https://factwright-sync.example.workers.dev';

    /** A computer whose requests to the made-up server get this answer. */
    const answering = (answer: () => Response | Promise<Response>) =>
      computer('Sam’s Mac', undefined, async (input, init) =>
        new URL(String(input)).origin === fake ? answer() : fetch(input, init),
      );

    it('says what’s wrong with an address, before asking anything', async () => {
      const { asked, fetchWith } = noting();
      const mac = computer('Sam’s Mac', undefined, fetchWith);
      await mac.sync.start();
      for (const [typed, message] of [
        ['', 'Type your server’s address.'],
        [
          'http://factwright-sync.sam.workers.dev',
          'Use your server’s address that starts with https://.',
        ],
        [
          `${fake}/api`,
          'Type the address alone, with nothing after it, like https://factwright-sync.yourname.workers.dev.',
        ],
      ]) {
        expect(await mac.sync.connect(typed as string)).toEqual({ ok: false, message });
      }
      expect(asked).toEqual([]);
      expect(mac.sync.status()).toEqual({ state: 'off' });
    });

    it('signs in only to a Factwright sync server that has what this version needs', async () => {
      const options = (body: unknown) => () => Response.json(body);
      for (const [answer, result] of [
        [
          () => new Response('Not found', { status: 404 }),
          {
            ok: false,
            message:
              'That address doesn’t answer as a Factwright sync server. Check it’s your server’s.',
          },
        ],
        [
          options({ hello: 'world' }),
          {
            ok: false,
            message:
              'That address doesn’t answer as a Factwright sync server. Check it’s your server’s.',
          },
        ],
        [
          () => Promise.reject(new TypeError('fetch failed')),
          {
            ok: false,
            message:
              'Can’t reach that server. Check its address and your connection, then try again.',
          },
        ],
        [
          options({ providers: ['github'] }),
          {
            ok: false,
            message: 'Your server needs an update for this version of Factwright.',
            help: 'update',
          },
        ],
        [
          options({ providers: [], features: ['approve'] }),
          {
            ok: false,
            message:
              'Your server has no way to sign in yet. Set up its GitHub sign-in, then try again.',
            help: 'set-up',
          },
        ],
      ] as const) {
        const mac = answering(answer);
        await mac.sync.start();
        expect(await mac.sync.connect(fake)).toEqual(result);
        expect(mac.sync.status()).toEqual({ state: 'off' });
        expect(mac.statuses.map((status) => status.state)).not.toContain('signing-in');
      }
    });

    it('does nothing more once going back or another sign-in overtakes the check', async () => {
      for (const overtake of ['cancel', 'sign in'] as const) {
        const checking = gate();
        const mac = answering(async () => {
          checking.waiting = true;
          await checking.opened;
          return Response.json({ providers: ['github'], features: ['approve'] });
        });
        await mac.sync.start();
        const connecting = mac.sync.connect(fake);
        await vi.waitFor(() => expect(checking.waiting).toBe(true));
        if (overtake === 'cancel') {
          mac.sync.cancelSignIn();
        } else {
          // Back, then Factwright's sign-in, all while the check waits.
          expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
        }
        checking.open();
        expect(await connecting).toEqual({ ok: false, message: 'Signing in was canceled.' });
        // No sign-in to the made-up server started, whatever came after.
        expect(mac.statuses.filter((status) => 'ownServer' in status)).toEqual([]);
        expect(mac.sync.status()).toEqual(
          overtake === 'cancel'
            ? { state: 'off' }
            : { state: 'setting-up', email: person.email, firstDevice: true },
        );
      }
    });

    it('takes Factwright’s own address as Factwright’s sync', async () => {
      const mac = computer('Sam’s Mac');
      await mac.sync.start();
      expect(await mac.sync.connect(server.url.origin)).toEqual({ ok: true });
      expect(mac.sync.status()).toEqual({
        state: 'setting-up',
        email: person.email,
        firstDevice: true,
      });
    });
  });
});

describe('a server that sells sync', () => {
  /** What the server's operator sends to give free sync, or take it back. */
  const freeSync = (email: string, off = false) =>
    fetch(new URL('/api/admin/free-sync', selling?.url), {
      method: 'POST',
      headers: { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({ email, ...(off && { off: true }) }),
    }).then((response) => expect(response.ok).toBe(true));

  /** An account's subscription, as Stripe last told the server: in this state, renewing in a month. */
  async function subscription(account: Account, status: 'active' | 'past_due' | 'canceled') {
    const now = new Date();
    await selling?.env.DB.prepare(
      `INSERT INTO "syncAccess" (account, subscription, status, renewsAt, canceling, updatedAt)
       VALUES (?, 'sub_test', ?, ?, 0, ?)
       ON CONFLICT (account) DO UPDATE SET subscription = excluded.subscription,
         status = excluded.status, renewsAt = excluded.renewsAt`,
    )
      .bind(
        account.id,
        status,
        new Date(now.getTime() + 30 * 86_400_000).toISOString(),
        now.toISOString(),
      )
      .run();
  }

  /** A fetch that counts the changes each computer sends. */
  function counting() {
    let pushes = 0;
    const fetchWith: typeof fetch = async (input, init) => {
      if (init?.method === 'POST' && new URL(String(input)).pathname === '/api/sync/changes') {
        pushes += 1;
      }
      return fetch(input, init);
    };
    return { pushes: () => pushes, fetchWith };
  }

  /** A computer that syncs through the server that sells sync. */
  const sellingComputer = (name: string, dataDir?: string, fetchWith?: typeof fetch) =>
    computer(name, dataDir, fetchWith, undefined, selling?.url.toString() ?? null);

  /** Signs in and turns sync on as the account's first device, once the account has sync. */
  async function setUpFirstHere(mac: ReturnType<typeof computer>) {
    await mac.sync.start();
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual({
      state: 'setting-up',
      email: seller.email,
      firstDevice: true,
    });
    await recoveryKey(mac.sync);
    expect(await mac.sync.turnOn()).toEqual({ ok: true });
    await mac.synced();
  }

  /**
   * Waits for sync to pause here: `again` once a subscription ended, or not, as when free sync was
   * taken back.
   */
  const paused = (mac: ReturnType<typeof computer>, again: boolean) =>
    vi.waitFor(
      () =>
        expect(mac.sync.status()).toEqual({
          state: 'paused',
          email: seller.email,
          again,
          waiting: false,
        }),
      { timeout: 10_000 },
    );

  beforeAll(async () => {
    selling = await startServer({
      STRIPE_SECRET_KEY: 'rk_test_only',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_only',
      STRIPE_PRICE_MONTHLY: 'price_month',
      STRIPE_PRICE_YEARLY: 'price_year',
      // Nothing here reaches Stripe: the app never pays, only the browser does.
      STRIPE_API_URL: 'http://127.0.0.1:9',
      EARLY_BEFORE: '2026-01-01T00:00:00.000Z',
    });
  });

  afterAll(async () => {
    await selling?.close();
    selling = undefined;
  });

  beforeEach(async () => {
    seller = (await selling?.signUp('Sam Rivera')) as Account;
  });

  it('asks to subscribe after signing in, then sets up once the account has sync', async () => {
    const mac = sellingComputer('Sam’s Mac');
    await mac.sync.start();
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual({
      state: 'subscribe',
      email: seller.email,
      again: false,
      waiting: false,
    });

    expect(await mac.sync.subscribe()).toEqual({ ok: true });
    // The browser opens the server's page for subscribing, naming the account it's for.
    expect(mac.pages.at(-1)).toBe(`${selling?.url.origin}/subscribe?account=${seller.id}`);
    expect(mac.sync.status()).toMatchObject({ state: 'subscribe', waiting: true });

    await subscription(seller, 'active');
    await vi.waitFor(
      () =>
        expect(mac.sync.status()).toEqual({
          state: 'setting-up',
          email: seller.email,
          firstDevice: true,
        }),
      { timeout: 10_000 },
    );
    await recoveryKey(mac.sync);
    expect(await mac.sync.turnOn()).toEqual({ ok: true });
    await mac.synced();
  });

  it('skips subscribing for an account with sync already: free sync, or from before it was sold', async () => {
    await freeSync(seller.email);
    await setUpFirstHere(sellingComputer('Sam’s Mac'));

    seller = (await selling?.signUp('Sam Rivera', { since: new Date('2025-12-01') })) as Account;
    await setUpFirstHere(sellingComputer('Sam’s PC'));
  });

  it('pauses once the subscription ends, without trying again after each change, then picks up', async () => {
    await freeSync(seller.email);
    const { pushes, fetchWith } = counting();
    const mac = sellingComputer('Sam’s Mac', undefined, fetchWith);
    await setUpFirstHere(mac);
    const records = (await seller.client.account()).usage.records;

    await freeSync(seller.email, true);
    mac.write('notes/while-paused.md', 'Written while sync was paused');
    mac.sync.requestSync();
    // Free sync was taken back: there was no subscription to end.
    await paused(mac, false);
    const tried = pushes();
    for (const name of ['a', 'b', 'c']) {
      mac.write(`notes/${name}.md`, name);
      mac.sync.requestSync();
    }
    await new Promise((done) => setTimeout(done, 2500));
    expect(pushes()).toBe(tried);
    expect(mac.sync.status()).toMatchObject({ state: 'paused', waiting: false });

    // Subscribing again picks up where it left off: what changed while paused goes up.
    expect(await mac.sync.subscribe()).toEqual({ ok: true });
    expect(mac.pages.at(-1)).toBe(`${selling?.url.origin}/subscribe?account=${seller.id}`);
    await subscription(seller, 'active');
    await mac.synced();
    expect((await seller.client.account()).usage.records).toBe(records + 4);
  });

  it('stays paused after a restart, and carries on by itself once the account has sync again', async () => {
    await freeSync(seller.email);
    const first = sellingComputer('Sam’s Mac');
    await setUpFirstHere(first);
    await freeSync(seller.email, true);
    first.write('notes/paused.md', 'Paused');
    first.sync.requestSync();
    await paused(first, false);
    await first.sync.stop();

    const { pushes, fetchWith } = counting();
    const again = sellingComputer('Sam’s Mac', first.dataDir, fetchWith);
    await again.sync.start();
    expect(again.sync.status()).toEqual({
      state: 'paused',
      email: seller.email,
      again: false,
      waiting: false,
    });
    await new Promise((done) => setTimeout(done, 500));
    expect(pushes()).toBe(0);
    await again.sync.stop();

    // Sync given back while the app was closed, such as free sync from Steve.
    await freeSync(seller.email);
    const back = sellingComputer('Sam’s Mac', first.dataDir);
    await back.sync.start();
    await back.synced();
  });

  it('says a payment didn’t go through, while sync carries on, until the card works', async () => {
    await subscription(seller, 'past_due');
    const mac = sellingComputer('Sam’s Mac');
    await setUpFirstHere(mac);
    await vi.waitFor(
      () => expect(mac.sync.status()).toMatchObject({ state: 'on', paymentFailed: true }),
      { timeout: 10_000 },
    );
    mac.write('notes/still.md', 'Still syncing');
    mac.sync.requestSync();
    await mac.synced();

    await subscription(seller, 'active');
    // Looking at the account, as the Sync screen does, notes it.
    const looked = await mac.sync.account();
    expect(looked.ok && looked.account.access).toMatchObject({ allowed: true });
    expect(mac.sync.status()).toMatchObject({ state: 'on', activity: 'idle' });
    expect(mac.sync.status()).not.toHaveProperty('paymentFailed');
  });

  it('pauses on signing in again with its key, once the subscription ended meanwhile', async () => {
    await subscription(seller, 'active');
    const mac = sellingComputer('Sam’s Mac');
    await setUpFirstHere(mac);
    // Signed out from another device, then the subscription ran out.
    const device = (await seller.client.account()).devices.find((each) => !each.current);
    if (!device) throw new Error('The Mac isn’t signed in.');
    await seller.client.removeDevice(device.id);
    mac.sync.requestSync();
    await vi.waitFor(() => expect(mac.sync.status()).toMatchObject({ state: 'signed-out' }), {
      timeout: 10_000,
    });
    await subscription(seller, 'canceled');

    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual({
      state: 'paused',
      email: seller.email,
      again: true,
      waiting: false,
    });
  });

  /** Sam's Mac, set up with free sync, then paused once it was taken back. */
  async function pausedMac(fetchWith?: typeof fetch) {
    await freeSync(seller.email);
    const mac = sellingComputer('Sam’s Mac', undefined, fetchWith);
    await setUpFirstHere(mac);
    await freeSync(seller.email, true);
    mac.write('notes/paused.md', 'Written while paused');
    mac.sync.requestSync();
    await paused(mac, false);
    return mac;
  }

  it('asks again on coming back to the app, and carries on once the account has sync', async () => {
    const mac = await pausedMac();
    // Subscribed from another device, then back to the app here.
    await subscription(seller, 'active');
    mac.sync.lookAgain();
    await mac.synced();
  });

  it('stays paused when carrying on doesn’t get through, and carries on at the next look', async () => {
    // Each answer about the account, in order: through, or lost on the way.
    const answers: ('through' | 'lost')[] = [];
    const mac = await pausedMac(async (input, init) => {
      const lost = new URL(String(input)).pathname === '/api/account' && answers.shift() === 'lost';
      if (lost) throw new TypeError('fetch failed');
      return fetch(input, init);
    });
    await freeSync(seller.email);
    // The look sees sync is back, then the connection drops as it carries on.
    answers.push('through', 'lost');
    expect((await mac.sync.account()).ok).toBe(true);
    await vi.waitFor(() => expect(answers).toEqual([]));
    await new Promise((done) => setTimeout(done, 300));
    expect(mac.sync.status()).toMatchObject({ state: 'paused' });
    // The next look gets through.
    expect((await mac.sync.account()).ok).toBe(true);
    await mac.synced();
  });

  it('pays no mind to an answer about the account from before it carried on', async () => {
    let hold: Gate | null = null;
    const mac = await pausedMac(async (input, init) => {
      const response = await fetch(input, init);
      const held = hold;
      if (held && new URL(String(input)).pathname === '/api/account') {
        hold = null;
        held.waiting = true;
        await held.opened;
      }
      return response;
    });
    // A look asked while the account had no sync, held on its way back.
    const late = gate();
    hold = late;
    mac.sync.lookAgain();
    await vi.waitFor(() => expect(late.waiting).toBe(true));
    // Meanwhile the account gets sync again, and another look carries on.
    await freeSync(seller.email);
    expect((await mac.sync.account()).ok).toBe(true);
    await mac.synced();
    // The late answer, that it had no sync, comes in after: sync carries on all the same.
    late.open();
    await new Promise((done) => setTimeout(done, 300));
    mac.write('notes/after.md', 'After');
    mac.sync.requestSync();
    await mac.synced();
  });

  it('subscribes again before a second computer links, once the subscription ended', async () => {
    await subscription(seller, 'canceled');
    const pc = sellingComputer('Sam’s PC');
    await pc.sync.start();
    expect(await pc.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(pc.sync.status()).toEqual({
      state: 'subscribe',
      email: seller.email,
      again: true,
      waiting: false,
    });
  });

  it('stops waiting once the sign-in ends, and never carries on after', async () => {
    const mac = sellingComputer('Sam’s Mac');
    await mac.sync.start();
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(await mac.sync.subscribe()).toEqual({ ok: true });
    expect(await mac.sync.useDifferentAccount()).toEqual({ ok: true });
    expect(mac.sync.status()).toEqual({ state: 'off' });
    await subscription(seller, 'active');
    await new Promise((done) => setTimeout(done, 500));
    expect(mac.sync.status()).toEqual({ state: 'off' });
  });

  it('carries on as soon as the account has sync, when the window asks how it stands', async () => {
    const mac = sellingComputer('Sam’s Mac');
    await mac.sync.start();
    expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
    expect(mac.sync.status()).toMatchObject({ state: 'subscribe', waiting: false });
    // Subscribed from the phone, without the app opening the browser.
    await subscription(seller, 'active');
    expect((await mac.sync.account()).ok).toBe(true);
    await vi.waitFor(
      () =>
        expect(mac.sync.status()).toEqual({
          state: 'setting-up',
          email: seller.email,
          firstDevice: true,
        }),
      { timeout: 10_000 },
    );
  });
});
