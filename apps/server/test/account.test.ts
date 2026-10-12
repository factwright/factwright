import { API } from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECRET, someId, startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('the account', () => {
  it('says who it is, which devices are signed in, and how much it stores', async () => {
    const sam = await server.signUp('Sam Rivera');
    await server.newSession(sam.id, IPHONE);
    await sam.client.putFile(someId(), new Uint8Array(100));
    const info = await sam.client.account();
    expect(info.user).toMatchObject({ id: sam.id, email: sam.email, name: 'Sam Rivera' });
    expect(info.devices.map((device) => [device.name, device.current]).sort()).toEqual([
      ['Factwright on Test Mac', true],
      ['Safari on iPhone', false],
    ]);
    expect(info.usage).toMatchObject({ bytes: 100, files: 1, records: 0 });
    expect(info.usage.limit).toBe(1024 * 1024 * 1024);
  });

  it('signs a device out, which then can’t sync', async () => {
    const sam = await server.signUp();
    const phone = await server.newSession(sam.id, IPHONE);
    await sam.client.removeDevice(phone.sessionId);
    await expect(phone.client.changes(0)).rejects.toMatchObject({ kind: 'signed-out' });
    expect((await sam.client.account()).devices).toHaveLength(1);
  });

  it('exports what it keeps, still locked', async () => {
    const sam = await server.signUp();
    await sam.client.push([
      { record: someId(), base: 0, data: 'locked-record', file: null, deleted: false },
    ]);
    const response = await fetch(new URL(API.export, server.url), {
      headers: { authorization: `Bearer ${sam.token}` },
    });
    expect(response.headers.get('content-disposition')).toContain('attachment');
    const exported = (await response.json()) as { account: object; store: { records: object[] } };
    expect(exported.account).toMatchObject({ id: sam.id, email: sam.email });
    expect(exported.store.records).toEqual([expect.objectContaining({ data: 'locked-record' })]);
  });
});

describe('deleting the account', () => {
  const deleteAccount = (token: string) =>
    fetch(new URL('/api/auth/delete-user', server.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });

  it('removes its store, its files, its backups and its sign-in', async () => {
    const sam = await server.signUp();
    const file = someId();
    await sam.client.putFile(file, new TextEncoder().encode('locked'));
    await sam.client.push([{ record: someId(), base: 0, data: 'locked', file, deleted: false }]);
    await server.env.FILES.put(`backups/${sam.id}/2026-10-01.json.gz`, 'backup');
    const response = await deleteAccount(sam.token);
    expect(response.status).toBe(200);
    expect((await server.env.FILES.list({ prefix: `users/${sam.id}/` })).objects).toEqual([]);
    expect((await server.env.FILES.list({ prefix: `backups/${sam.id}/` })).objects).toEqual([]);
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    expect(await storage.exec('SELECT * FROM meta')).toEqual([]);
    await expect(sam.client.account()).rejects.toMatchObject({ kind: 'signed-out' });
    const user = await server.env.DB.prepare('SELECT id FROM "user" WHERE id = ?')
      .bind(sam.id)
      .first();
    expect(user).toBeNull();
  });

  it('needs a fresh sign-in', async () => {
    const sam = await server.signUp();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await server.env.DB.prepare('UPDATE "session" SET createdAt = ? WHERE id = ?')
      .bind(hourAgo, sam.sessionId)
      .run();
    const response = await deleteAccount(sam.token);
    expect(response.status).toBe(400);
    // The web view asks for a fresh sign-in when it sees this.
    expect(await response.json()).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect((await sam.client.account()).user.id).toBe(sam.id);
  });

  it('keeps the secret for signing sessions to itself', async () => {
    const sam = await server.signUp();
    const text = JSON.stringify(await sam.client.account());
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(sam.token);
  });
});
