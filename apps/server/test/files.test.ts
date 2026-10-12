import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { someId, startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const bytes = (text: string) => new TextEncoder().encode(text);

describe('files', () => {
  it('upload once, and come back as they went', async () => {
    const { client, id } = await server.signUp();
    const file = someId();
    expect(await client.missingFiles([file])).toEqual([file]);
    await client.putFile(file, bytes('locked contents'));
    expect(await client.missingFiles([file, someId()])).toHaveLength(1);
    const other = await server.newSession(id);
    expect(await other.client.getFile(file)).toEqual(bytes('locked contents'));
    expect(await other.client.getFile(someId())).toBeNull();
  });

  it('keep one copy when the same contents upload twice', async () => {
    const { client, id } = await server.signUp();
    const file = someId();
    await client.putFile(file, bytes('locked'));
    await client.putFile(file, bytes('locked'));
    const { objects } = await server.env.FILES.list({ prefix: `users/${id}/files/` });
    expect(objects).toHaveLength(1);
    expect((await client.account()).usage).toMatchObject({ files: 1, bytes: 6 });
  });

  it('must be uploaded before a record points to them', async () => {
    const { client } = await server.signUp();
    const file = someId();
    const record = someId();
    const push = () => client.push([{ record, base: 0, data: 'locked', file, deleted: false }]);
    expect((await push()).results[0]).toMatchObject({ ok: false, reason: 'missing-file' });
    await client.putFile(file, bytes('locked'));
    expect((await push()).results[0]).toMatchObject({ ok: true, version: 1 });
    expect((await client.changes(0)).changes[0]?.file).toBe(file);
  });

  it('are refused under a name that isn’t an ID', async () => {
    const { client } = await server.signUp();
    await expect(client.putFile('../../escape', bytes('x'))).rejects.toMatchObject({
      kind: 'not-found',
    });
    await expect(client.missingFiles(['not-an-id'])).rejects.toMatchObject({ kind: 'refused' });
  });
});

describe('the account’s space', () => {
  let small: TestServer;

  beforeAll(async () => {
    small = await startServer({ STORAGE_LIMIT_MB: '1' });
  });

  afterAll(() => small?.close());

  it('runs out, and then files and records are refused, but deletions still go through', async () => {
    const { client } = await small.signUp();
    const big = new Uint8Array(700 * 1024);
    await client.putFile(someId(), big);
    await expect(client.putFile(someId(), big)).rejects.toMatchObject({ kind: 'full' });
    const record = someId();
    const full = 'x'.repeat(299_000);
    await client.push([{ record, base: 0, data: full, file: null, deleted: false }]);
    const { results } = await client.push([
      { record: someId(), base: 0, data: full, file: null, deleted: false },
    ]);
    expect(results[0]).toMatchObject({ ok: false, reason: 'full' });
    const deleted = await client.push([
      { record, base: 1, data: 'tombstone', file: null, deleted: true },
    ]);
    expect(deleted.results[0]).toMatchObject({ ok: true });
  });
});
