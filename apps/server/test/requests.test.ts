import { randomBytes } from 'node:crypto';
import {
  API,
  commitmentTo,
  LinkApproval,
  LinkAsk,
  type LinkRequest,
  newAccountKey,
  type SyncClient,
} from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { someId, startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0 Safari/537.36';

/** An account with a computer that's set up, and a new device signed in beside it. */
async function twoDevices() {
  const mac = await server.signUp();
  const keyId = randomBytes(16).toString('base64url');
  await mac.client.saveKeys(keyId, 'locked-with-the-recovery-key');
  const pc = await server.newSession(mac.id, WINDOWS_CHROME);
  return { mac, pc, keyId };
}

/** The request as a device that's set up lists it. */
async function listed(client: SyncClient, id: string): Promise<LinkRequest> {
  const found = (await client.linkRequests()).find((request) => request.id === id);
  if (!found) throw new Error('The request isn’t listed.');
  return found;
}

/** 65 bytes starting with 4, the shape of a one-time public key, though not a point on the curve. */
const someKey = () => Buffer.concat([Buffer.of(4), randomBytes(64)]).toString('base64url');

describe('approving a new device', () => {
  it('hands the account key to the new device once, sealed so only it can open it', async () => {
    const { mac, pc, keyId } = await twoDevices();
    const ask = await LinkAsk.start(pc.client);
    expect(await ask.step()).toEqual({ state: 'waiting' });

    const request = await listed(mac.client, ask.id);
    expect(request).toMatchObject({ device: 'Chrome on Windows', mine: false, key: null });
    const approval = await LinkApproval.start(mac.client, request, keyId);
    const asked = await ask.step();
    expect(asked).toMatchObject({ state: 'check', approver: 'Factwright on Test Mac' });
    const approving = await approval.step();
    expect(approving).toEqual({ state: 'check', check: asked.state === 'check' && asked.check });

    const accountKey = newAccountKey();
    await approval.approve(accountKey);
    expect(await ask.step()).toMatchObject({ state: 'check', approved: true });
    ask.confirm();
    expect(await ask.finish()).toEqual(accountKey);
    // Picked up once, and the approving device can see it was.
    expect(await pc.client.takeApproval(ask.id)).toBeNull();
    expect(await approval.step()).toEqual({ state: 'linked' });
    expect((await mac.client.linkRequest(ask.id))?.state).toBe('linked');
    expect(await mac.client.linkRequests()).toEqual([]);
  });

  it('never shows the sealed key to anyone, while it waits to be picked up', async () => {
    const { mac, pc, keyId } = await twoDevices();
    const ask = await LinkAsk.start(pc.client);
    const approval = await LinkApproval.start(mac.client, await listed(mac.client, ask.id), keyId);
    await ask.step();
    await approval.step();
    await approval.approve(newAccountKey());
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: mac.id });
    const [row] = (await storage.exec('SELECT sealed FROM requests WHERE id = ?', ask.id)) as {
      sealed: string;
    }[];
    const sealed = row?.sealed ?? '';
    expect(sealed).toMatch(/^[A-Za-z0-9_-]{82}$/);
    for (const token of [mac.token, pc.token]) {
      const headers = { authorization: `Bearer ${token}` };
      for (const path of [`${API.requests}/${ask.id}`, API.requests, API.export]) {
        const answer = await fetch(new URL(path, server.url), { headers });
        expect(await answer.text()).not.toContain(sealed);
      }
    }
    expect((await pc.client.linkRequest(ask.id))?.state).toBe('approved');
  });

  it('lets only the device that asked show its key, and pick the sealed key up', async () => {
    const { mac, pc, keyId } = await twoDevices();
    const other = await server.newSession(mac.id, WINDOWS_CHROME);
    const ask = await LinkAsk.start(pc.client);
    const approval = await LinkApproval.start(mac.client, await listed(mac.client, ask.id), keyId);
    await expect(other.client.showKey(ask.id, someKey())).rejects.toMatchObject({
      kind: 'refused',
    });
    await ask.step();
    await approval.step();
    await approval.approve(newAccountKey());
    expect(await other.client.takeApproval(ask.id)).toBeNull();
    expect(await mac.client.takeApproval(ask.id)).toBeNull();
    // Calling it off from another device does nothing: it's still there for the one that asked.
    await other.client.cancelRequest(ask.id);
    ask.confirm();
    expect(await ask.finish()).not.toBeNull();
  });

  it('lets only the device that offered approve it, once the new device shows its key', async () => {
    const { mac, pc, keyId } = await twoDevices();
    const other = await server.newSession(mac.id);
    const ask = await LinkAsk.start(pc.client);
    const request = await listed(mac.client, ask.id);
    await LinkApproval.start(mac.client, request, keyId);
    const sealed = 'A'.repeat(82);
    // Not before the new device has shown its key.
    await expect(mac.client.approveRequest(ask.id, sealed)).rejects.toMatchObject({
      status: 403,
    });
    await ask.step();
    await expect(other.client.approveRequest(ask.id, sealed)).rejects.toMatchObject({
      status: 403,
    });
    await expect(pc.client.approveRequest(ask.id, sealed)).rejects.toMatchObject({ status: 403 });
    await mac.client.approveRequest(ask.id, sealed);
    // Once approved, it stays as it was approved.
    await expect(mac.client.approveRequest(ask.id, 'B'.repeat(82))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('lets one device offer to approve, and never the one that asked', async () => {
    const { mac, pc, keyId } = await twoDevices();
    const phone = await server.newSession(mac.id, 'Mozilla/5.0 (iPhone) Safari/604.1');
    const ask = await LinkAsk.start(pc.client);
    const request = await listed(mac.client, ask.id);
    await expect(pc.client.offerToApprove(ask.id, someKey())).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('its own request'),
    });
    await LinkApproval.start(mac.client, request, keyId);
    await expect(LinkApproval.start(phone.client, request, keyId)).rejects.toMatchObject({
      kind: 'conflict',
      message: 'Another device is approving it.',
    });
    expect((await listed(phone.client, ask.id)).approving).toBe(false);
    expect((await listed(mac.client, ask.id)).approving).toBe(true);
  });

  it('lets the new device show only one key', async () => {
    const { mac, pc, keyId } = await twoDevices();
    const ask = await LinkAsk.start(pc.client);
    await LinkApproval.start(mac.client, await listed(mac.client, ask.id), keyId);
    await ask.step();
    await expect(pc.client.showKey(ask.id, someKey())).rejects.toMatchObject({ status: 403 });
  });

  it('can be turned down on another device, and then hands nothing over', async () => {
    const { mac, pc, keyId } = await twoDevices();
    const ask = await LinkAsk.start(pc.client);
    const approval = await LinkApproval.start(mac.client, await listed(mac.client, ask.id), keyId);
    await ask.step();
    await approval.step();
    await approval.approve(newAccountKey());
    await approval.deny();
    expect(await ask.step()).toEqual({ state: 'denied' });
    ask.confirm();
    expect(await ask.finish()).toBeNull();
    expect(await mac.client.linkRequests()).toEqual([]);
    // The device that asked calls it off instead of turning it down.
    const again = await LinkAsk.start(pc.client);
    await expect(pc.client.denyRequest(again.id)).rejects.toMatchObject({ status: 403 });
  });

  it('can be called off by the device that asked', async () => {
    const { mac, pc } = await twoDevices();
    const ask = await LinkAsk.start(pc.client);
    await ask.cancel();
    expect(await ask.step()).toEqual({ state: 'gone' });
    expect(await mac.client.linkRequests()).toEqual([]);
  });

  it('stops working once its time runs out', async () => {
    const { mac, pc } = await twoDevices();
    const ask = await LinkAsk.start(pc.client);
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: mac.id });
    await storage.exec('UPDATE requests SET expires = ?', Date.now() - 1);
    expect(await ask.step()).toEqual({ state: 'gone' });
    expect(await mac.client.linkRequests()).toEqual([]);
  });

  it('runs out 10 minutes after it’s made', async () => {
    const { mac, pc } = await twoDevices();
    const before = Date.now();
    const ask = await LinkAsk.start(pc.client);
    const { asked, expires } = await listed(mac.client, ask.id);
    expect(Date.parse(asked)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(expires) - Date.parse(asked)).toBe(10 * 60_000);
  });

  it('keeps one request per device: asking again replaces the last', async () => {
    const { mac, pc } = await twoDevices();
    const first = await LinkAsk.start(pc.client);
    const second = await LinkAsk.start(pc.client);
    expect(await first.step()).toEqual({ state: 'gone' });
    expect((await mac.client.linkRequests()).map((request) => request.id)).toEqual([second.id]);
  });

  it('lets only a few wait at once', async () => {
    const { mac } = await twoDevices();
    for (let i = 0; i < 5; i++) {
      await LinkAsk.start((await server.newSession(mac.id, WINDOWS_CHROME)).client);
    }
    const sixth = await server.newSession(mac.id, WINDOWS_CHROME);
    await expect(LinkAsk.start(sixth.client)).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('Too many devices are asking'),
    });
  });

  it('takes only so many in an hour', async () => {
    const { mac, pc } = await twoDevices();
    for (let i = 0; i < 10; i++) await LinkAsk.start(pc.client);
    await expect(LinkAsk.start(pc.client)).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('a lot of requests to link in an hour'),
    });
    // Refused, the device's last request stays as it was.
    expect(await mac.client.linkRequests()).toHaveLength(1);
    // Another device's asks are its own: they don't count against this one's.
    const laptop = await server.newSession(mac.id, WINDOWS_CHROME);
    await LinkAsk.start(laptop.client);
    // An hour on, it takes them again.
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: mac.id });
    await storage.exec('UPDATE requests_made SET at = ?', Date.now() - 61 * 60_000);
    await LinkAsk.start(pc.client);
  });

  it('lets an approving device offer again after a lost answer, until the new device shows its key', async () => {
    const { mac, pc } = await twoDevices();
    const ask = await LinkAsk.start(pc.client);
    await mac.client.offerToApprove(ask.id, someKey());
    await mac.client.offerToApprove(ask.id, someKey());
    const offered = await listed(mac.client, ask.id);
    await pc.client.showKey(ask.id, someKey());
    await expect(mac.client.offerToApprove(ask.id, someKey())).rejects.toMatchObject({
      kind: 'conflict',
    });
    // The same key again is fine, and changes nothing.
    await mac.client.offerToApprove(ask.id, offered.approver?.key ?? '');
    expect((await listed(mac.client, ask.id)).approver?.key).toBe(offered.approver?.key);
  });

  it('are swept away once they run out, and by a restore', async () => {
    const { mac, pc } = await twoDevices();
    await LinkAsk.start(pc.client);
    const env = (await server.worker.getEnv()) as unknown as {
      STORES: {
        idFromName(name: string): unknown;
        get(id: unknown): { cleanup(now?: number): Promise<void> };
      };
    };
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: mac.id });
    const left = async () =>
      ((await storage.exec('SELECT COUNT(*) AS n FROM requests')) as { n: number }[])[0]?.n;
    await env.STORES.get(env.STORES.idFromName(mac.id)).cleanup(Date.now() + 11 * 60_000);
    expect(await left()).toBe(0);

    await LinkAsk.start((await server.newSession(mac.id, WINDOWS_CHROME)).client);
    await mac.client.push([
      { record: someId(), base: 0, data: 'locked', file: null, deleted: false },
    ]);
    await server.worker.scheduled({
      cron: '17 4 * * *',
      scheduledTime: new Date('2026-10-12T04:17:00Z'),
    });
    const restored = await fetch(new URL('/api/admin/restore', server.url), {
      method: 'POST',
      headers: { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({ account: mac.id, day: '2026-10-12' }),
    });
    expect(restored.status).toBe(204);
    expect(await left()).toBe(0);
  });

  it('refuses what isn’t in the shape it takes', async () => {
    const { mac, pc, keyId } = await twoDevices();
    const id = someId().slice(0, 22);
    await expect(pc.client.askToLink('short', someId())).rejects.toMatchObject({
      kind: 'refused',
    });
    await expect(pc.client.askToLink(id, 'not-a-hash')).rejects.toMatchObject({
      kind: 'refused',
    });
    const ask = await LinkAsk.start(pc.client);
    for (const key of ['', 'A'.repeat(87), someKey().slice(1), `${someKey()}A`]) {
      await expect(mac.client.offerToApprove(ask.id, key)).rejects.toMatchObject({
        kind: 'refused',
      });
    }
    await LinkApproval.start(mac.client, await listed(mac.client, ask.id), keyId);
    await ask.step();
    for (const sealed of ['', 'A'.repeat(81), 'A'.repeat(83), `${'A'.repeat(81)}!`]) {
      await expect(mac.client.approveRequest(ask.id, sealed)).rejects.toMatchObject({
        kind: 'refused',
      });
    }
  });

  it('answers for a request that isn’t there as gone, whatever its ID', async () => {
    const { pc } = await twoDevices();
    for (const id of [someId().slice(0, 22), 'not-an-id']) {
      expect(await pc.client.linkRequest(id)).toBeNull();
      expect(await pc.client.takeApproval(id)).toBeNull();
      await expect(pc.client.offerToApprove(id, someKey())).rejects.toMatchObject({
        kind: 'not-found',
      });
    }
  });

  it('keeps the commitment the new device sent, as it sent it', async () => {
    const { mac, pc } = await twoDevices();
    const id = randomBytes(16).toString('base64url');
    const key = someKey();
    const commitment = (await commitmentTo(id, key)) ?? '';
    expect(commitment).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await pc.client.askToLink(id, commitment);
    expect((await listed(mac.client, id)).commitment).toBe(commitment);
  });

  it('tells listening devices when the account’s requests change', async () => {
    const { mac, pc } = await twoDevices();
    const socket = new WebSocket(mac.client.liveUrl(await mac.client.liveTicket()));
    const heard: string[] = [];
    socket.addEventListener('message', (event) => heard.push(String(event.data)));
    await new Promise((resolve) => socket.addEventListener('open', resolve));
    await vi.waitFor(() => expect(heard).toEqual(['{"cursor":0}']));
    const ask = await LinkAsk.start(pc.client);
    await vi.waitFor(() => expect(heard.at(-1)).toBe('{"requests":1}'));
    await ask.cancel();
    await vi.waitFor(() => expect(heard.at(-1)).toBe('{"requests":0}'));
    socket.close();
  });

  it('says when the device asking signed in', async () => {
    const { mac, pc } = await twoDevices();
    const ask = await LinkAsk.start(pc.client);
    const { signedIn, asked } = await listed(mac.client, ask.id);
    expect(Date.parse(signedIn)).toBeLessThanOrEqual(Date.parse(asked));
    expect(Date.now() - Date.parse(signedIn)).toBeLessThan(60_000);
  });

  it('lets a device ask only soon after it signed in', async () => {
    const { mac } = await twoDevices();
    const old = await server.newSession(mac.id, WINDOWS_CHROME);
    await server.env.DB.prepare('UPDATE "session" SET createdAt = ? WHERE id = ?')
      .bind(new Date(Date.now() - 31 * 60_000).toISOString(), old.sessionId)
      .run();
    await expect(LinkAsk.start(old.client)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('signed in a while ago'),
    });
    expect(await mac.client.linkRequests()).toEqual([]);
  });

  it('names the device asking by the ID the account lists it under, to sign it out by', async () => {
    const { mac, pc } = await twoDevices();
    const ask = await LinkAsk.start(pc.client);
    const request = await listed(mac.client, ask.id);
    expect(request.deviceId).toBe(pc.sessionId);
    // Turned down, the device that asked stays signed in, and says so.
    await mac.client.denyRequest(ask.id);
    expect(await ask.step()).toEqual({ state: 'denied' });
    // It can't dodge being signed out by calling its request off first.
    await ask.cancel();
    await mac.client.removeDevice(request.deviceId);
    await expect(pc.client.linkRequests()).rejects.toMatchObject({ kind: 'signed-out' });
  });

  it('says the server can approve devices', async () => {
    const { pc } = await twoDevices();
    expect(await pc.client.features()).toEqual(['approve']);
    const anyone = await fetch(new URL('/api/sign-in-options', server.url));
    expect(await anyone.json()).toMatchObject({ features: ['approve'] });
  });
});

describe('separate accounts', () => {
  it('never see or touch each other’s requests to link', async () => {
    const { mac, pc, keyId } = await twoDevices();
    const bob = await server.signUp('Bob');
    const ask = await LinkAsk.start(pc.client);
    const request = await listed(mac.client, ask.id);
    expect(await bob.client.linkRequests()).toEqual([]);
    expect(await bob.client.linkRequest(ask.id)).toBeNull();
    await expect(LinkApproval.start(bob.client, request, keyId)).rejects.toMatchObject({
      kind: 'not-found',
    });
    await expect(bob.client.denyRequest(ask.id)).rejects.toMatchObject({ kind: 'not-found' });
    await bob.client.cancelRequest(ask.id);
    expect(await bob.client.takeApproval(ask.id)).toBeNull();
    // Still waiting, untouched, for the account it belongs to.
    expect(await listed(mac.client, ask.id)).toMatchObject({ approver: null, state: 'waiting' });
  });

  it('turn away anyone not signed in', async () => {
    const stranger = server.clientFor(null);
    await expect(stranger.linkRequests()).rejects.toMatchObject({ kind: 'signed-out' });
    await expect(stranger.askToLink(someId().slice(0, 22), someId())).rejects.toMatchObject({
      kind: 'signed-out',
    });
  });
});
