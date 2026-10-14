import { describe, expect, it, vi } from 'vitest';
import { utf8 } from './bytes.ts';
import { SyncClient, SyncError } from './client.ts';

/** A server that answers each request with the next response given. */
function fakeServer(...answers: Response[]) {
  const fetch = vi.fn(async (_url: URL, _init?: RequestInit) => {
    const answer = answers.shift();
    if (!answer) throw new TypeError('fetch failed');
    return answer;
  });
  const client = new SyncClient({
    server: 'https://app.example',
    token: () => 'session-token',
    headers: { 'user-agent': 'Factwright/1.0' },
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { client, fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('SyncClient', () => {
  it('signs each request with the session, and sends JSON', async () => {
    const { client, fetch } = fakeServer(json({ results: [] }));
    await client.push([]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://app.example/api/sync/changes');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer session-token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('Factwright/1.0');
    expect(init?.body).toBe('{"changes":[]}');
  });

  it('says why a request failed', async () => {
    const { client } = fakeServer(
      json({ error: 'signed-out', message: 'Sign in again.' }, 401),
      json({ error: 'full', message: 'Your account is full.' }, 507),
      new Response('slow down', { status: 429, headers: { 'retry-after': '30' } }),
      new Response('oops', { status: 500 }),
    );
    await expect(client.account()).rejects.toMatchObject({
      kind: 'signed-out',
      message: 'Sign in again.',
    });
    await expect(client.account()).rejects.toMatchObject({ kind: 'full', status: 507 });
    await expect(client.account()).rejects.toMatchObject({ kind: 'slow-down', retryAfter: 30 });
    await expect(client.account()).rejects.toMatchObject({ kind: 'server' });
    const offline = client.account();
    await expect(offline).rejects.toBeInstanceOf(SyncError);
    await expect(offline).rejects.toMatchObject({ kind: 'offline' });
  });

  it('takes an answer about the account or its key that doesn’t make sense as a server problem', async () => {
    const { client } = fakeServer(
      json({ keys: null }),
      json({ keys: { keyId: 'key-id', recovery: 'locked', savedAt: '2026-10-13T00:00:00Z' } }),
      json({}),
      json({ keys: { keyId: 7 } }),
      json({ devices: [] }),
    );
    expect(await client.keys()).toBeNull();
    expect(await client.keys()).toMatchObject({ keyId: 'key-id' });
    // Nothing about the key isn't the same as no key: only null says no device set up sync.
    await expect(client.keys()).rejects.toMatchObject({ kind: 'server' });
    await expect(client.keys()).rejects.toMatchObject({ kind: 'server' });
    await expect(client.account()).rejects.toMatchObject({ kind: 'server' });
  });

  it('tells when another device already set up the keys', async () => {
    const { client } = fakeServer(new Response(null, { status: 204 }), json({}, 409));
    expect(await client.saveKeys('key-id', 'locked')).toBe('saved');
    expect(await client.saveKeys('key-id', 'locked')).toBe('taken');
  });

  it('uploads and downloads files as bytes, with none for a missing one', async () => {
    const { client, fetch } = fakeServer(
      new Response(null, { status: 201 }),
      new Response(utf8('locked')),
      json({ error: 'not-found', message: 'No such file.' }, 404),
    );
    await client.putFile('file-id', utf8('locked'));
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/octet-stream');
    expect(await client.getFile('file-id')).toEqual(utf8('locked'));
    expect(await client.getFile('file-id')).toBeNull();
  });

  it('gives none for a link that’s gone', async () => {
    const { client } = fakeServer(json({ data: 'locked' }), json({}, 404));
    expect(await client.takeLink('link-id')).toBe('locked');
    expect(await client.takeLink('link-id')).toBeNull();
  });

  it('listens for changes over a secure WebSocket', () => {
    const { client } = fakeServer();
    expect(client.liveUrl('a b')).toBe('wss://app.example/api/sync/live?ticket=a+b');
    const local = new SyncClient({ server: 'http://localhost:8787' });
    expect(local.liveUrl('t')).toBe('ws://localhost:8787/api/sync/live?ticket=t');
  });
});
