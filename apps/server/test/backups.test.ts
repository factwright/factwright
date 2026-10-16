import type { PushChange } from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Account, someId, startServer, type TestServer } from './server.ts';

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
  /** An account's store, to run its cleanup as if at another time, or its alarm. */
  const storeOf = async (account: Pick<Account, 'id'>) => {
    const env = (await server.worker.getEnv()) as unknown as {
      STORES: {
        idFromName(name: string): unknown;
        get(id: unknown): {
          cleanup(now?: number): Promise<void>;
          runAlarm(): Promise<void>;
          nextAlarm(): Promise<number | null>;
        };
      };
    };
    return env.STORES.get(env.STORES.idFromName(account.id));
  };

  /** A key too long for R2, so a delete that names it fails, as one does when R2 is down. */
  const refused = (account: Account) => `users/${account.id}/files/${'x'.repeat(1024)}`;

  /** The failures the Worker wrote down since the logs were last cleared. */
  const errors = () =>
    server.server
      .getLogs()
      .filter((log) => log.level === 'error')
      .map((log) => log.message)
      .join('\n');

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
    const store = await storeOf(sam);

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
    const store = await storeOf(sam);
    await store.cleanup();
    await sam.client.push([{ ...change(record, 0, 'v1'), file }]);
    await store.cleanup(Date.now() + 86_400_000);
    expect(await sam.client.getFile(file)).not.toBeNull();
  });

  it('finishes removing a file from R2 at the next cleanup, after R2 failed to', async () => {
    const sam = await server.signUp();
    const [record, kept, unused] = [someId(), someId(), someId()];
    await sam.client.putFile(kept, new Uint8Array(20));
    await sam.client.push([{ ...change(record, 0, 'v1'), file: kept }]);
    await sam.client.putFile(unused, new Uint8Array(10));
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    await storage.exec('UPDATE files SET at = 0');
    const inR2 = async () =>
      (await server.env.FILES.list({ prefix: `users/${sam.id}/files/` })).objects.length;
    const store = await storeOf(sam);
    await store.cleanup();

    // R2 fails the delete, after the store has forgotten the file and freed its space. The
    // cleanup writes that down and still succeeds, so the alarm plans the next one.
    await storage.exec('INSERT INTO trash (key) VALUES (?)', refused(sam));
    server.server.clearLogs();
    await store.cleanup(Date.now() + 86_400_000);
    // The runtime's logs arrive a moment after the run.
    await vi.waitFor(() =>
      expect(errors()).toMatch(
        new RegExp(`Couldn't delete account ${sam.id}'s unused files from R2: .*not valid`),
      ),
    );
    expect(await sam.client.getFile(unused)).toBeNull();
    expect((await sam.client.account()).usage).toMatchObject({ files: 1, bytes: 22 });
    expect(await inR2()).toBe(2);
    expect(await storage.exec('SELECT key FROM trash')).toHaveLength(2);

    // Once R2 deletes again, the next cleanup finishes, and frees nothing twice.
    await storage.exec('DELETE FROM trash WHERE key = ?', refused(sam));
    await store.cleanup(Date.now() + 86_400_000);
    expect(await inR2()).toBe(1);
    expect(await storage.exec('SELECT key FROM trash')).toEqual([]);
    expect((await sam.client.account()).usage).toMatchObject({ files: 1, bytes: 22 });
    expect(await sam.client.getFile(kept)).not.toBeNull();
  });

  it('deletes from R2 a thousand keys at a time, the most R2 takes at once', async () => {
    const sam = await server.signUp();
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    await storage.exec(
      `WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000)
       INSERT INTO trash (key) SELECT printf('users/%s/files/%04d', ?, i) FROM n`,
      sam.id,
    );
    // Sorted after the thousand, it's alone in the second delete, so only that one fails.
    await storage.exec('INSERT INTO trash (key) VALUES (?)', refused(sam));
    server.server.clearLogs();
    await (await storeOf(sam)).cleanup();
    expect(await storage.exec('SELECT key FROM trash')).toEqual([{ key: refused(sam) }]);
    await vi.waitFor(() => expect(errors()).toMatch(/unused files from R2: .*not valid/));
  });

  it('never deletes from R2 a file the store has again, as after a restore', async () => {
    const sam = await server.signUp();
    const file = someId();
    await sam.client.putFile(file, new Uint8Array(10));
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    await storage.exec('INSERT INTO trash (key) SELECT key FROM files');
    await (await storeOf(sam)).cleanup();
    expect(await sam.client.getFile(file)).not.toBeNull();
    expect(await storage.exec('SELECT key FROM trash')).toEqual([]);
  });

  it('is still planned for the next day after one fails, and the failure is written down', async () => {
    const sam = await server.signUp();
    // Signing in claims the store, which plans no cleanup until something's stored.
    await sam.client.account();
    const store = await storeOf(sam);
    expect(await store.nextAlarm()).toBeNull();
    // Without one of its tables, the cleanup's transaction fails.
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    await storage.exec('DROP TABLE links');
    server.server.clearLogs();

    const ran = Date.now();
    await store.runAlarm();
    expect(await store.nextAlarm()).toBeGreaterThanOrEqual(ran + 86_400_000);
    expect(await store.nextAlarm()).toBeLessThanOrEqual(Date.now() + 86_400_000);
    // The runtime's logs arrive a moment after the run.
    await vi.waitFor(() =>
      expect(errors()).toMatch(
        new RegExp(`Couldn't clean up account ${sam.id}'s store: .*no such table: links`),
      ),
    );
  });

  it('isn’t planned after a deleted account’s last sweep', async () => {
    const sam = await server.signUp();
    await sam.client.account();
    await server.env.FILES.put(`users/${sam.id}/files/left-behind`, 'locked');
    // Deleted, with a file for its last sweep, such as an upload that was on its way.
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: sam.id });
    await storage.exec("INSERT INTO meta (key, value) VALUES ('deleted', ?)", sam.id);
    const store = await storeOf(sam);
    await store.runAlarm();
    expect((await server.env.FILES.list({ prefix: `users/${sam.id}/` })).objects).toEqual([]);
    expect(await store.nextAlarm()).toBeNull();
  });

  it('isn’t planned for a store no account has claimed', async () => {
    const store = await storeOf({ id: someId() });
    await store.runAlarm();
    expect(await store.nextAlarm()).toBeNull();
  });
});
