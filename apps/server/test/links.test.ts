import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { someId, startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const linkId = () => someId().slice(0, 22);

describe('link codes', () => {
  it('hand the locked account key to the new device once', async () => {
    const { client, id } = await server.signUp();
    const link = linkId();
    await client.saveLink(link, 'locked-with-code');
    const phone = await server.newSession(id, 'Mozilla/5.0 (iPhone) Safari/604.1');
    expect(await phone.client.takeLink(link)).toBe('locked-with-code');
    expect(await phone.client.takeLink(link)).toBeNull();
  });

  it('can be called off before they’re used', async () => {
    const { client } = await server.signUp();
    const link = linkId();
    await client.saveLink(link, 'locked');
    await client.cancelLink(link);
    expect(await client.takeLink(link)).toBeNull();
  });

  it('stop working once their time runs out', async () => {
    const { client, id } = await server.signUp();
    const link = linkId();
    await client.saveLink(link, 'locked');
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: id });
    await storage.exec('UPDATE links SET expires = ?', Date.now() - 1);
    expect(await client.takeLink(link)).toBeNull();
  });

  it('wait only a few at a time', async () => {
    const { client } = await server.signUp();
    for (let i = 0; i < 5; i++) await client.saveLink(linkId(), 'locked');
    await expect(client.saveLink(linkId(), 'locked')).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('Too many link codes'),
    });
  });

  it('are refused under an ID that isn’t one', async () => {
    const { client } = await server.signUp();
    await expect(client.saveLink('short', 'locked')).rejects.toMatchObject({ kind: 'refused' });
  });
});
