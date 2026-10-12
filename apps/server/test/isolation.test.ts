import { API, SyncClient } from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Account, someId, startServer, type TestServer } from './server.ts';

let server: TestServer;
let alice: Account;
let bob: Account;
/** What Alice keeps, which Bob tries to reach. */
const hers = {
  record: someId(),
  file: someId(),
  link: someId().slice(0, 22),
  keyId: someId().slice(0, 22),
};

beforeAll(async () => {
  server = await startServer();
  alice = await server.signUp('Alice');
  bob = await server.signUp('Bob');
  await alice.client.saveKeys(hers.keyId, 'alice-locked-key');
  await alice.client.putFile(hers.file, new TextEncoder().encode('alice-locked-file'));
  await alice.client.push([
    { record: hers.record, base: 0, data: 'alice-locked-record', file: hers.file, deleted: false },
  ]);
  await alice.client.saveLink(hers.link, 'alice-locked-link');
});

afterAll(() => server?.close());

/**
 * One account can never read or change another's data, through any part of the API. Every
 * request names its account only through its session, so Bob asking for Alice's IDs finds
 * nothing of hers.
 */
describe('separate accounts', () => {
  it('don’t see each other’s keys, records or files', async () => {
    expect(await bob.client.keys()).toBeNull();
    expect((await bob.client.changes(0)).changes).toEqual([]);
    expect(await bob.client.versions(hers.record)).toEqual([]);
    expect(await bob.client.version(hers.record, 1)).toBeNull();
    expect(await bob.client.getFile(hers.file)).toBeNull();
    expect(await bob.client.missingFiles([hers.file])).toEqual([hers.file]);
  });

  it('can’t pick up each other’s link codes', async () => {
    expect(await bob.client.takeLink(hers.link)).toBeNull();
    await bob.client.cancelLink(hers.link);
    // Alice's link is still there for her own new device.
    const hersAgain = await server.newSession(alice.id);
    expect(await hersAgain.client.takeLink(hers.link)).toBe('alice-locked-link');
  });

  it('keep their own versions of the same record ID', async () => {
    const { results } = await bob.client.push([
      { record: hers.record, base: 0, data: 'bob-record', file: null, deleted: false },
    ]);
    expect(results[0]).toMatchObject({ ok: true, version: 1 });
    expect(await alice.client.version(hers.record, 1)).toMatchObject({
      data: 'alice-locked-record',
    });
    expect((await alice.client.versions(hers.record)).map((v) => v.version)).toEqual([1]);
  });

  it('can’t point a record at the other’s file', async () => {
    const { results } = await bob.client.push([
      { record: someId(), base: 0, data: 'bob', file: hers.file, deleted: false },
    ]);
    expect(results[0]).toMatchObject({ ok: false, reason: 'missing-file' });
  });

  it('can’t set up keys in the other’s account', async () => {
    expect(await bob.client.saveKeys(someId().slice(0, 22), 'bob-key')).toBe('saved');
    expect((await alice.client.keys())?.recovery).toBe('alice-locked-key');
  });

  it('can’t sign the other’s devices out, or see them', async () => {
    const aliceDevice = (await alice.client.account()).devices[0];
    expect(aliceDevice).toBeDefined();
    await expect(bob.client.removeDevice(aliceDevice?.id ?? '')).rejects.toMatchObject({
      kind: 'not-found',
    });
    const seen = (await bob.client.account()).devices.map((device) => device.id);
    expect(seen).not.toContain(aliceDevice?.id);
    expect((await alice.client.account()).user.name).toBe('Alice');
  });

  it('don’t export each other’s data', async () => {
    const response = await fetch(new URL(API.export, server.url), {
      headers: { authorization: `Bearer ${bob.token}` },
    });
    const text = await response.text();
    expect(text).not.toContain('alice-locked');
    expect(text).not.toContain(alice.email);
  });

  it('give nothing to a request without a session, or with a made-up one', async () => {
    for (const token of [null, 'made-up-token', `${alice.token}x`]) {
      const stranger = server.clientFor(token);
      await expect(stranger.keys()).rejects.toMatchObject({ kind: 'signed-out' });
      await expect(stranger.changes(0)).rejects.toMatchObject({ kind: 'signed-out' });
      await expect(stranger.getFile(hers.file)).rejects.toMatchObject({ kind: 'signed-out' });
      await expect(stranger.takeLink(hers.link)).rejects.toMatchObject({ kind: 'signed-out' });
      await expect(stranger.account()).rejects.toMatchObject({ kind: 'signed-out' });
    }
  });

  it('ignore any account named in the request itself', async () => {
    const response = await fetch(
      new URL(`${API.changes}?since=0&account=${alice.id}`, server.url),
      {
        headers: { authorization: `Bearer ${bob.token}`, 'x-factwright-account': alice.id },
      },
    );
    expect(await response.text()).not.toContain('alice-locked');
  });

  it('can’t listen to each other’s changes with a made-up ticket', async () => {
    const forged = new SyncClient({ server: server.url.toString() }).liveUrl(
      Buffer.from(JSON.stringify({ account: alice.id, expires: Date.now() + 60_000 })).toString(
        'base64url',
      ),
    );
    const response = await server.server.fetch(forged.replace(/^ws/, 'http'), {
      headers: { upgrade: 'websocket' },
    });
    expect(response.status).toBe(401);
  });
});
