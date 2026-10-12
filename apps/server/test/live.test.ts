import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkTicket, makeTicket } from '../src/live.ts';
import { someId, startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

describe('listening for changes', () => {
  it('hears where the account’s changes reach, and each new one as it happens', async () => {
    const { client, id } = await server.signUp();
    const socket = new WebSocket(client.liveUrl(await client.liveTicket()));
    const heard: unknown[] = [];
    socket.addEventListener('message', (event) => heard.push(String(event.data)));
    await new Promise((resolve) => socket.addEventListener('open', resolve));
    await vi.waitFor(() => expect(heard).toEqual(['{"cursor":0}']));

    const laptop = await server.newSession(id);
    await laptop.client.push([
      { record: someId(), base: 0, data: 'locked', file: null, deleted: false },
    ]);
    await vi.waitFor(() => expect(heard.at(-1)).toBe('{"cursor":1}'));

    // A ping keeps the connection open, and is answered without waking the store.
    socket.send('ping');
    await vi.waitFor(() => expect(heard.at(-1)).toBe('pong'));
    socket.close();
  });

  it('needs a ticket that’s signed and still good', async () => {
    const secret = 'a-secret-for-signing-tickets';
    const ticket = await makeTicket(secret, 'account-1', 1_000);
    expect(await checkTicket(secret, ticket, 1_000)).toBe('account-1');
    expect(await checkTicket(secret, ticket, 1_000 + 61_000)).toBeNull();
    expect(await checkTicket('another-secret', ticket, 1_000)).toBeNull();
    const [payload, signature] = ticket.split('.');
    const changed = `${payload?.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))}.${signature}`;
    expect(await checkTicket(secret, changed, 1_000)).toBeNull();
    expect(await checkTicket(secret, 'not.a.ticket', 1_000)).toBeNull();
  });
});
