import type { PushChange } from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { someId, startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const change = (record: string, base: number, data = `locked-${base + 1}`): PushChange => ({
  record,
  base,
  data,
  file: null,
  deleted: false,
});

describe('the locked account key', () => {
  it('is saved by the first device only, and read by every device', async () => {
    const { client, id } = await server.signUp();
    expect(await client.keys()).toBeNull();
    const keyId = someId().slice(0, 22);
    expect(await client.saveKeys(keyId, 'locked-with-recovery')).toBe('saved');
    const other = await server.newSession(id);
    expect(await other.client.saveKeys(someId().slice(0, 22), 'another')).toBe('taken');
    expect(await other.client.keys()).toMatchObject({ keyId, recovery: 'locked-with-recovery' });
  });

  it('can’t be changed once saved, so no session can spoil recovery', async () => {
    const { client, token } = await server.signUp();
    const keyId = someId().slice(0, 22);
    await client.saveKeys(keyId, 'first');
    expect(await client.saveKeys(keyId, 'second')).toBe('taken');
    // The old way to name the key being replaced does nothing now.
    const response = await fetch(new URL('/api/sync/keys', server.url), {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ keyId, recovery: 'second', replacing: keyId }),
    });
    expect(response.status).toBe(409);
    expect((await client.keys())?.recovery).toBe('first');
  });
});

describe('changes', () => {
  it('go in one version at a time, and come back to every device', async () => {
    const { client, id } = await server.signUp();
    const [first, second] = [someId(), someId()];
    const pushed = await client.push([change(first, 0), change(second, 0)]);
    expect(pushed.results).toEqual([
      { record: first, ok: true, version: 1, seq: 1 },
      { record: second, ok: true, version: 1, seq: 2 },
    ]);
    const other = await server.newSession(id);
    const page = await other.client.changes(0);
    expect(page.changes.map((each) => [each.record, each.version, each.data])).toEqual([
      [first, 1, 'locked-1'],
      [second, 1, 'locked-1'],
    ]);
    expect(page.cursor).toBe(2);
    expect(page.more).toBe(false);
    expect(page.changes[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await other.client.changes(2)).changes).toEqual([]);
  });

  it('come back once each, at their newest version, after where a device left off', async () => {
    const { client } = await server.signUp();
    const record = someId();
    await client.push([change(record, 0)]);
    await client.push([change(record, 1)]);
    await client.push([change(record, 2)]);
    const page = await client.changes(0);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0]).toMatchObject({ record, version: 3, seq: 3, data: 'locked-3' });
  });

  it('come in pages', async () => {
    const { client } = await server.signUp();
    const records = Array.from({ length: 5 }, someId);
    await client.push(records.map((record) => change(record, 0)));
    const first = await client.changes(0, 2);
    expect(first.changes).toHaveLength(2);
    expect(first.more).toBe(true);
    const second = await client.changes(first.cursor, 2);
    const third = await client.changes(second.cursor, 2);
    expect(third.more).toBe(false);
    expect([...first.changes, ...second.changes, ...third.changes].map((c) => c.record)).toEqual(
      records,
    );
  });

  it('turn back a change made from an old version, with the newer one to merge with', async () => {
    const { client, id } = await server.signUp();
    const record = someId();
    await client.push([change(record, 0)]);
    const laptop = await server.newSession(id);
    await laptop.client.push([change(record, 1, 'from-laptop')]);
    const { results } = await client.push([change(record, 1, 'from-desktop')]);
    expect(results[0]).toMatchObject({
      record,
      ok: false,
      reason: 'conflict',
      current: { record, version: 2, data: 'from-laptop' },
    });
    // Merged, from the version it now knows.
    expect((await client.push([change(record, 2, 'merged')])).results[0]).toMatchObject({
      ok: true,
      version: 3,
    });
  });

  it('turn back a change to a record the server has no version of', async () => {
    const { client } = await server.signUp();
    const { results } = await client.push([change(someId(), 4)]);
    expect(results[0]).toMatchObject({ ok: false, reason: 'conflict', current: null });
  });

  it('keep deletions, so every device hears of them', async () => {
    const { client } = await server.signUp();
    const record = someId();
    await client.push([change(record, 0)]);
    await client.push([{ record, base: 1, data: 'locked-tombstone', file: null, deleted: true }]);
    const [deleted] = (await client.changes(0)).changes;
    expect(deleted).toMatchObject({ record, version: 2, deleted: true });
  });

  it('keep earlier versions, newest first, each with its data', async () => {
    const { client } = await server.signUp();
    const record = someId();
    await client.push([change(record, 0)]);
    await client.push([change(record, 1)]);
    const versions = await client.versions(record);
    expect(versions.map((each) => each.version)).toEqual([2, 1]);
    expect(await client.version(record, 1)).toMatchObject({ version: 1, data: 'locked-1' });
    expect(await client.version(record, 9)).toBeNull();
  });

  it('start a device over when it’s ahead of the store, as after a restore', async () => {
    const { client } = await server.signUp();
    const record = someId();
    await client.push([change(record, 0)]);
    const page = await client.changes(500);
    expect(page.changes.map((each) => each.record)).toEqual([record]);
  });

  it('are refused when they aren’t in the shape the server takes', async () => {
    const { client } = await server.signUp();
    const bad = [
      [{ ...change(someId(), 0), record: 'short' }],
      [{ ...change(someId(), 0), base: -1 }],
      [{ ...change(someId(), 0), data: '' }],
      [{ ...change(someId(), 0), file: 'not-an-id' }],
      Array.from({ length: 101 }, () => change(someId(), 0)),
    ];
    for (const changes of bad) {
      await expect(client.push(changes)).rejects.toMatchObject({ kind: 'refused' });
    }
  });
});
