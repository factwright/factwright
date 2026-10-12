import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Account, startServer, type TestServer } from '@factwright/server/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../../shared/sync.ts';
import { Tracker } from '../jobs/tracker.ts';
import { SyncAccount } from './account.ts';

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
function computer(name: string, dataDir = mkdtempSync(join(tmpdir(), 'factwright-account-'))) {
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
  const made = await first.sync.newRecoveryKey();
  if (!made.ok) throw new Error(made.message);
  expect(await first.sync.turnOn()).toEqual({ ok: true });
  return made.recoveryKey;
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
