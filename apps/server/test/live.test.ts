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

  it('needs a ticket that’s locked with the server’s secret and still good', async () => {
    const secret = 'a-secret-for-locking-tickets';
    const ticket = await makeTicket(secret, 'account-1', 1_000);
    expect(await checkTicket(secret, ticket, 1_000)).toBe('account-1');
    expect(await checkTicket(secret, ticket, 1_000 + 61_000)).toBeNull();
    expect(await checkTicket('another-secret', ticket, 1_000)).toBeNull();
    const changed = ticket.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect(await checkTicket(secret, changed, 1_000)).toBeNull();
    expect(await checkTicket(secret, 'not.a.ticket', 1_000)).toBeNull();
    expect(await checkTicket(secret, '', 1_000)).toBeNull();
  });

  it('puts nothing readable about the account in the address it’s sent in', async () => {
    const account = 'kvP3dWq8ZtYb6RmN0aLx2FhE';
    const ticket = await makeTicket('a-secret', account, 1_000);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(ticket.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    );
    expect(ticket).not.toContain(account);
    expect(decoded).not.toContain(account);
    expect(decoded).not.toContain('expires');
    // Each ticket is different, even for the same account at the same moment.
    expect(await makeTicket('a-secret', account, 1_000)).not.toBe(ticket);
  });
});
