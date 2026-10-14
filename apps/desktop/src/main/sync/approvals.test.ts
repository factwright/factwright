import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Account, startServer, type TestServer } from '@factwright/server/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalsView, SyncStatus } from '../../shared/sync.ts';
import { Tracker } from '../jobs/tracker.ts';
import { SyncAccount } from './account.ts';

// Each test signs in, links and syncs for real, against the server running locally.
vi.setConfig({ testTimeout: 30_000 });

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

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

/** The person, in their browser, approving the code a computer shows to sign in. */
async function approveSignIn(url: string) {
  const userCode = new URL(url).searchParams.get('user_code') ?? '';
  const headers = { authorization: `Bearer ${person.token}`, 'content-type': 'application/json' };
  await fetch(new URL(`/api/auth/device?user_code=${userCode}`, server.url), { headers });
  await fetch(new URL('/api/auth/device/approve', server.url), {
    method: 'POST',
    headers,
    body: JSON.stringify({ userCode }),
  });
}

/** A computer running the app, with its own data folder, keeping the latest of each view. */
function computer(name: string, fetchWith?: typeof fetch) {
  const dataDir = mkdtempSync(join(tmpdir(), 'factwright-approve-'));
  folders.push(dataDir);
  const workspace = join(dataDir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const seen: { status: SyncStatus | null; approvals: ApprovalsView | null } = {
    status: null,
    approvals: null,
  };
  const sync = new SyncAccount({
    dataDir,
    server: server.url.toString(),
    version: '0.0.0',
    keychain,
    tracker: new Tracker(join(dataDir, 'tracker.db')),
    workspace,
    openUrl: approveSignIn,
    onStatus: (status) => {
      seen.status = status;
    },
    onApprovals: (view) => {
      seen.approvals = view;
    },
    onApplied: () => {},
    computerName: async () => name,
    sleep: async () => {},
    approvalWait: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50))),
    ...(fetchWith && { fetch: fetchWith }),
  });
  opened.push(sync);
  const approvals = () => {
    if (!seen.approvals) throw new Error('Nothing about approvals yet.');
    return seen.approvals;
  };
  return {
    sync,
    seen,
    approvals,
    write: (path: string, text: string) => writeFileSync(join(workspace, path), text),
    read: (path: string) => {
      const file = join(workspace, path);
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
  };
}

/** The account's first computer, with sync on. */
async function firstComputer(name = 'Sam’s Mac') {
  const mac = computer(name);
  await mac.sync.start();
  expect(await mac.sync.signInWithBrowser()).toEqual({ ok: true });
  await mac.sync.newRecoveryKey();
  expect(await mac.sync.turnOn()).toEqual({ ok: true });
  return mac;
}

/** A computer signed in to the same account, not linked yet. */
async function newComputer(name = 'SAM-PC', fetchWith?: typeof fetch) {
  const pc = computer(name, fetchWith);
  await pc.sync.start();
  expect(await pc.sync.signInWithBrowser()).toEqual({ ok: true });
  expect(pc.sync.status()).toMatchObject({ state: 'setting-up', firstDevice: false });
  return pc;
}

/** Both computers, up to where each shows its emoji. */
async function upToTheCheck() {
  const mac = await firstComputer();
  const pc = await newComputer();
  await vi.waitFor(() => expect(pc.approvals().supported).toBe(true));
  expect(await pc.sync.askToLink()).toEqual({ ok: true });
  await mac.sync.approvalsView();
  await vi.waitFor(() =>
    expect(mac.approvals().requests).toMatchObject([
      { device: 'Factwright on SAM-PC', elsewhere: false },
    ]),
  );
  const id = mac.approvals().requests[0]?.id ?? '';
  expect(await mac.sync.approveRequest(id)).toEqual({ ok: true });
  await vi.waitFor(() => expect(mac.approvals().approving).toMatchObject({ step: 'check' }));
  await vi.waitFor(() => expect(pc.approvals().asking).toMatchObject({ step: 'check' }));
  return { mac, pc, id };
}

describe('linking a computer from one that’s set up', () => {
  it('shows the same emoji on both, and links once the person says so on each', async () => {
    const { mac, pc } = await upToTheCheck();
    const onMac = mac.approvals().approving;
    const onPc = pc.approvals().asking;
    expect(onPc).toMatchObject({ approver: 'Factwright on Sam’s Mac', confirmed: false });
    expect(onMac?.step === 'check' && onMac.check).toEqual(onPc?.step === 'check' && onPc.check);

    pc.sync.confirmLinkCheck(true);
    await vi.waitFor(() => expect(pc.approvals().asking).toMatchObject({ confirmed: true }));
    // Nothing is handed over until the computer that's set up approves too.
    expect(pc.sync.status()).toMatchObject({ state: 'setting-up' });
    expect(await mac.sync.answerApproval(true)).toEqual({ ok: true });
    await vi.waitFor(() => expect(pc.sync.status()).toMatchObject({ state: 'on' }), {
      timeout: 10_000,
    });
    await vi.waitFor(() =>
      expect(mac.approvals().approving).toMatchObject({
        step: 'ended',
        linked: true,
        message: 'Factwright on SAM-PC is linked.',
      }),
    );
    expect(pc.approvals().asking).toBeNull();

    // They sync as one account from here.
    mac.write('note.md', 'From the Mac');
    mac.sync.requestSync();
    await vi.waitFor(() => expect(pc.read('note.md')).toBe('From the Mac'), { timeout: 15_000 });
    mac.sync.dismissApproval();
    expect(mac.approvals().approving).toBeNull();
  });

  it('links nothing when the person says the emoji don’t match on the new computer', async () => {
    const { mac, pc } = await upToTheCheck();
    pc.sync.confirmLinkCheck(false);
    expect(pc.approvals().asking).toMatchObject({
      step: 'ended',
      message: expect.stringContaining('Nothing was linked'),
    });
    await vi.waitFor(() =>
      expect(mac.approvals().approving).toMatchObject({ step: 'ended', linked: false }),
    );
    expect(pc.sync.status()).toMatchObject({ state: 'setting-up' });
  });

  it('links nothing when the person says they don’t match on the computer that’s set up', async () => {
    const { mac, pc } = await upToTheCheck();
    pc.sync.confirmLinkCheck(true);
    expect(await mac.sync.answerApproval(false)).toEqual({ ok: true });
    await vi.waitFor(() =>
      expect(pc.approvals().asking).toMatchObject({
        step: 'ended',
        message: expect.stringContaining('turned this down'),
      }),
    );
    expect(pc.sync.status()).toMatchObject({ state: 'setting-up' });
  });

  it('turns a request down without starting to approve it', async () => {
    const mac = await firstComputer();
    const pc = await newComputer();
    await vi.waitFor(() => expect(pc.approvals().supported).toBe(true));
    await pc.sync.askToLink();
    const view = await mac.sync.approvalsView();
    expect(await mac.sync.denyRequest(view.requests[0]?.id ?? '')).toEqual({ ok: true });
    expect(mac.approvals().requests).toEqual([]);
    await vi.waitFor(() =>
      expect(pc.approvals().asking).toMatchObject({
        step: 'ended',
        message: expect.stringContaining('turned this down'),
      }),
    );
  });

  it('calls its request off once it links with a code instead', async () => {
    const mac = await firstComputer();
    const pc = await newComputer();
    await vi.waitFor(() => expect(pc.approvals().supported).toBe(true));
    await pc.sync.askToLink();
    expect((await mac.sync.approvalsView()).requests).toHaveLength(1);
    const made = await mac.sync.makeLinkCode();
    if (!made.ok) throw new Error(made.message);
    expect(await pc.sync.linkWithCode(made.link.code)).toEqual({ ok: true });
    expect(pc.approvals().asking).toBeNull();
    await vi.waitFor(async () => expect((await mac.sync.approvalsView()).requests).toEqual([]));
  });

  it('lets only a computer that isn’t linked yet ask, and only one with sync on approve', async () => {
    const mac = await firstComputer();
    expect(await mac.sync.askToLink()).toMatchObject({ ok: false });
    const pc = await newComputer();
    await vi.waitFor(() => expect(pc.approvals().supported).toBe(true));
    await pc.sync.askToLink();
    // The computer that isn't linked has no key to approve anything with, and sees nothing.
    expect((await pc.sync.approvalsView()).requests).toEqual([]);
    expect(await pc.sync.approveRequest('A'.repeat(22))).toMatchObject({ ok: false });
  });

  it('offers only the code when the server can’t approve devices yet', async () => {
    // A server from before approving devices lists no features.
    const older: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith('/api/sign-in-options')) return response;
      return new Response(JSON.stringify({ providers: ['github'] }), {
        headers: { 'content-type': 'application/json' },
      });
    };
    await firstComputer();
    const pc = await newComputer('SAM-PC', older);
    await vi.waitFor(() => expect(pc.seen.approvals).not.toBeNull());
    expect(pc.approvals().supported).toBe(false);
    expect(await pc.sync.askToLink()).toEqual({
      ok: false,
      message: 'The sync server can’t approve devices yet. Type a code instead.',
    });
  });
});
