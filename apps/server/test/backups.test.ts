import type { PushChange } from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { someId, startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const change = (record: string, base: number, data: string): PushChange => ({
  record,
  base,
  data,
  file: null,
  deleted: false,
});

const backUp = (day: string) =>
  server.worker.scheduled({ cron: '17 4 * * *', scheduledTime: new Date(`${day}T04:17:00Z`) });

const restore = (body: object, token = 'test-admin-token') =>
  fetch(new URL('/api/admin/restore', server.url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('daily backups', () => {
  it('save each account’s store, and keep two weeks of them', async () => {
    const sam = await server.signUp();
    const empty = await server.signUp();
    await sam.client.push([change(someId(), 0, 'locked')]);
    await server.env.FILES.put(`backups/${sam.id}/2026-09-20.json.gz`, 'old');
    await server.env.FILES.put(`backups/${sam.id}/2026-10-01.json.gz`, 'recent');
    await backUp('2026-10-12');
    const kept = (await server.env.FILES.list({ prefix: `backups/${sam.id}/` })).objects;
    expect(kept.map((object) => object.key).sort()).toEqual([
      `backups/${sam.id}/2026-10-01.json.gz`,
      `backups/${sam.id}/2026-10-12.json.gz`,
    ]);
    // An account with nothing stored has nothing to back up.
    expect((await server.env.FILES.list({ prefix: `backups/${empty.id}/` })).objects).toEqual([]);
  });

  it('put a store back as it was that day, and devices pull everything again', async () => {
    const sam = await server.signUp();
    const record = someId();
    await sam.client.push([change(record, 0, 'before')]);
    await backUp('2026-10-12');
    await sam.client.push([change(record, 1, 'after')]);
    const response = await restore({ account: sam.id, day: '2026-10-12' });
    expect(response.status).toBe(204);
    const page = await sam.client.changes(0);
    expect(page.changes.map((each) => [each.version, each.data])).toEqual([[1, 'before']]);
    // A device that saw version 2 hears of the restored version 1, after where it left off.
    expect((await sam.client.changes(2)).changes).toMatchObject([{ version: 1, data: 'before' }]);
  });

  it('are restored by the operator only', async () => {
    const sam = await server.signUp();
    expect((await restore({ account: sam.id, day: '2026-10-12' }, 'wrong')).status).toBe(404);
    expect((await restore({ account: sam.id, day: '2026-10-12' }, sam.token)).status).toBe(404);
    expect((await restore({ account: sam.id, day: 'yesterday' })).status).toBe(400);
    expect((await restore({ account: sam.id, day: '1999-01-01' })).status).toBe(404);
  });
});

describe('deleting an account for someone who asked', () => {
  const remove = (body: object, token = 'test-admin-token') =>
    fetch(new URL('/api/admin/delete', server.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('is only for the operator', async () => {
    const sam = await server.signUp();
    expect((await remove({ email: sam.email }, 'a-guess')).status).toBe(404);
    expect((await sam.client.account()).user.id).toBe(sam.id);
  });

  it('removes the account and everything it has, found by its email', async () => {
    const sam = await server.signUp();
    await sam.client.push([change(someId(), 0, 'locked')]);
    await server.env.FILES.put(`backups/${sam.id}/2026-10-01.json.gz`, 'backup');
    expect((await remove({ email: sam.email })).status).toBe(204);
    await expect(sam.client.account()).rejects.toMatchObject({ kind: 'signed-out' });
    expect((await server.env.FILES.list({ prefix: `backups/${sam.id}/` })).objects).toEqual([]);
    const user = await server.env.DB.prepare('SELECT id FROM "user" WHERE id = ?')
      .bind(sam.id)
      .first();
    expect(user).toBeNull();
    expect((await remove({ email: sam.email })).status).toBe(404);
  });

  it('finds the account however its email is typed, and says what it needs', async () => {
    const sam = await server.signUp();
    expect((await remove({ email: ` ${sam.email.toUpperCase()} ` })).status).toBe(204);
    await expect(sam.client.account()).rejects.toMatchObject({ kind: 'signed-out' });
    const nothing = await fetch(new URL('/api/admin/delete', server.url), {
      method: 'POST',
      headers: { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' },
      body: 'null',
    });
    expect(nothing.status).toBe(400);
  });
});

describe('the daily cleanup', () => {
  it('drops old versions and unused files, but keeps every record’s current version', async () => {
    const sam = await server.signUp();
    const [record, oldFile, newFile] = [someId(), someId(), someId()];
    await sam.client.putFile(oldFile, new Uint8Array(10));
    await sam.client.putFile(newFile, new Uint8Array(20));
    await sam.client.push([{ ...change(record, 0, 'v1'), file: oldFile }]);
    await sam.client.push([{ ...change(record, 1, 'v2'), file: newFile }]);
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    const longAgo = new Date(Date.now() - 120 * 86_400_000).toISOString();
    await storage.exec('UPDATE versions SET at = ?', longAgo);
    await storage.exec('UPDATE files SET at = 0');
    const env = (await server.worker.getEnv()) as unknown as {
      STORES: {
        idFromName(name: string): unknown;
        get(id: unknown): { cleanup(now?: number): Promise<void> };
      };
    };
    const store = env.STORES.get(env.STORES.idFromName(sam.id));

    // The first run marks the file nothing points to now; a later run removes it.
    await store.cleanup();
    expect((await sam.client.versions(record)).map((each) => each.version)).toEqual([2]);
    expect(await sam.client.getFile(oldFile)).not.toBeNull();
    await store.cleanup(Date.now() + 86_400_000);
    expect(await sam.client.getFile(oldFile)).toBeNull();
    expect(await sam.client.getFile(newFile)).not.toBeNull();
    expect((await sam.client.account()).usage).toMatchObject({ files: 1 });
  });

  it('keeps a file a device points to again before it’s removed', async () => {
    const sam = await server.signUp();
    const [record, file] = [someId(), someId()];
    await sam.client.putFile(file, new Uint8Array(10));
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    await storage.exec('UPDATE files SET at = 0');
    const env = (await server.worker.getEnv()) as unknown as {
      STORES: {
        idFromName(name: string): unknown;
        get(id: unknown): { cleanup(now?: number): Promise<void> };
      };
    };
    const store = env.STORES.get(env.STORES.idFromName(sam.id));
    await store.cleanup();
    await sam.client.push([{ ...change(record, 0, 'v1'), file }]);
    await store.cleanup(Date.now() + 86_400_000);
    expect(await sam.client.getFile(file)).not.toBeNull();
  });
});
