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
    const phone = await server.newSession(sam.id, IPHONE);
    const file = someId();
    await sam.client.putFile(file, new TextEncoder().encode('locked'));
    await sam.client.push([{ record: someId(), base: 0, data: 'locked', file, deleted: false }]);
    await server.env.FILES.put(`backups/${sam.id}/2026-10-01.json.gz`, 'backup');
    // A device code Sam approved, which the computer never picked up.
    await server.env.DB.prepare(
      `INSERT INTO "deviceCode" (id, deviceCode, userCode, userId, expiresAt, status)
       VALUES (?, ?, ?, ?, ?, 'approved')`,
    )
      .bind(someId(), someId(), 'WDJBMJHT', sam.id, new Date(Date.now() + 600_000).toISOString())
      .run();
    const response = await deleteAccount(sam.token);
    expect(response.status).toBe(200);
    expect((await server.env.FILES.list({ prefix: `users/${sam.id}/` })).objects).toEqual([]);
    expect((await server.env.FILES.list({ prefix: `backups/${sam.id}/` })).objects).toEqual([]);
    // The store keeps only that the account was deleted, so nothing can fill it again.
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    expect(await storage.exec('SELECT key FROM meta')).toEqual([{ key: 'deleted' }]);
    await expect(sam.client.account()).rejects.toMatchObject({ kind: 'signed-out' });
    await expect(phone.client.changes(0)).rejects.toMatchObject({ kind: 'signed-out' });
    for (const table of ['user', 'account', 'session', 'deviceCode']) {
      const left = await server.env.DB.prepare(
        `SELECT count(*) AS n FROM "${table}" WHERE ${table === 'user' ? 'id' : 'userId'} = ?`,
      )
        .bind(sam.id)
        .first<{ n: number }>();
      expect(left?.n, table).toBe(0);
    }
  });

  it('needs a sign-in with GitHub or Google in the last 15 minutes, which a device code can’t give', async () => {
    const sam = await server.signUp();
    await sam.client.push([
      { record: someId(), base: 0, data: 'locked', file: null, deleted: false },
    ]);
    // Sam last signed in with GitHub an hour ago; this session came from a device code just now.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await server.env.DB.prepare('UPDATE "account" SET updatedAt = ? WHERE userId = ?')
      .bind(hourAgo, sam.id)
      .run();
    const response = await deleteAccount(sam.token);
    expect(response.status).toBe(400);
    // The web view asks for a fresh sign-in when it sees this.
    expect(await response.json()).toMatchObject({ code: 'SESSION_NOT_FRESH' });
    expect((await sam.client.changes(0)).changes).toHaveLength(1);

    // Signing in with GitHub again updates the account's link, and then it can go.
    await server.env.DB.prepare('UPDATE "account" SET updatedAt = ? WHERE userId = ?')
      .bind(new Date().toISOString(), sam.id)
      .run();
    expect((await deleteAccount(sam.token)).status).toBe(200);
  });

  it('turns away an upload that lands while the store is deleted, and keeps no copy of it', async () => {
    const sam = await server.signUp();
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    await storage.exec("INSERT INTO meta (key, value) VALUES ('deleted', ?)", sam.id);
    await expect(
      sam.client.putFile(someId(), new TextEncoder().encode('locked')),
    ).rejects.toMatchObject({ kind: 'signed-out' });
    expect((await server.env.FILES.list({ prefix: `users/${sam.id}/` })).objects).toEqual([]);
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

describe('sign-in records', () => {
  const DAY = 86_400_000;
  const insert = (sql: string, ...values: unknown[]) =>
    server.env.DB.prepare(sql)
      .bind(...values)
      .run();
  const ids = async (table: string) =>
    (await server.env.DB.prepare(`SELECT id FROM "${table}"`).bind().all<{ id: string }>()).results
      .map((row) => row.id)
      .sort();

  it('are forgotten once a day, when they’ve ended or run out', async () => {
    const now = Date.now();
    const iso = (offset: number) => new Date(now + offset).toISOString();
    const sam = await server.signUp();
    // A session from a device Sam stopped using, which ran out yesterday.
    await insert(
      `INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES ('ended', ?, 'ended-token', ?, ?, '203.0.113.7', 'Factwright/0.0.0 (Old Mac)', ?)`,
      iso(-DAY),
      iso(-61 * DAY),
      iso(-61 * DAY),
      sam.id,
    );
    for (const [id, offset] of [
      ['verification-old', -DAY],
      ['verification-new', 10 * 60_000],
    ] as const) {
      await insert(
        `INSERT INTO "verification" (id, identifier, value, expiresAt, createdAt, updatedAt)
         VALUES (?, ?, 'state', ?, ?, ?)`,
        id,
        id,
        iso(offset),
        iso(-DAY),
        iso(-DAY),
      );
    }
    for (const [id, offset] of [
      ['code-old', -DAY],
      ['code-new', 10 * 60_000],
    ] as const) {
      await insert(
        `INSERT INTO "deviceCode" (id, deviceCode, userCode, expiresAt, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        id,
        `${id}-device`,
        `${id}-user`,
        iso(offset),
      );
    }
    for (const [id, last] of [
      ['limit-old', now - 2 * 60 * 60_000],
      ['limit-new', now - 30_000],
    ] as const) {
      await insert(
        `INSERT INTO "rateLimit" (id, key, count, lastRequest) VALUES (?, ?, 1, ?)`,
        id,
        `198.51.100.${id.length}|/sign-in/social|${id}`,
        last,
      );
    }

    await server.worker.scheduled({ cron: '17 4 * * *', scheduledTime: new Date(now) });

    expect(await ids('session')).not.toContain('ended');
    expect(await ids('session')).toContain(sam.sessionId);
    expect(await ids('verification')).toEqual(['verification-new']);
    expect(await ids('deviceCode')).toEqual(['code-new']);
    expect(await ids('rateLimit')).not.toContain('limit-old');
    expect(await ids('rateLimit')).toContain('limit-new');
    // Sam's own session still works.
    expect((await sam.client.account()).user.id).toBe(sam.id);
  });
});
