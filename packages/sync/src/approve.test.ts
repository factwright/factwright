import { describe, expect, it, vi } from 'vitest';
import { type ApproveClient, commitmentTo, LinkApproval, LinkAsk } from './approve.ts';
import { randomBytes, toBase64Url } from './bytes.ts';
import { CHECK_EMOJI, checkEmoji } from './emoji.ts';
import { accountKeys, newAccountKey } from './keys.ts';
import type { LinkRequest } from './protocol.ts';

interface Row {
  id: string;
  session: string;
  commitment: string;
  key: string | null;
  approver: { session: string; device: string; key: string } | null;
  sealed: string | null;
  denied: boolean;
  linked: boolean;
}

/** The sync server's part, kept in memory, with its rules about who may take each step. */
class FakeServer {
  readonly rows = new Map<string, Row>();
  /** The ID of the account key, as the account's key record says. */
  keyId = toBase64Url(randomBytes(16));

  view(row: Row, session: string): LinkRequest {
    return {
      id: row.id,
      device: 'Chrome on Windows',
      deviceId: row.session,
      asked: new Date().toISOString(),
      expires: new Date(Date.now() + 600_000).toISOString(),
      signedIn: new Date().toISOString(),
      commitment: row.commitment,
      key: row.key,
      approver: row.approver && { device: row.approver.device, key: row.approver.key },
      state: row.denied ? 'denied' : row.linked ? 'linked' : row.sealed ? 'approved' : 'waiting',
      mine: row.session === session,
      approving: row.approver?.session === session,
    };
  }

  /** What one session of the account sends it. */
  as(session: string, device = 'Factwright on Sam’s Mac'): ApproveClient {
    const row = (id: string) => {
      const found = this.rows.get(id);
      if (!found) throw new Error('not-found');
      return found;
    };
    return {
      keys: async () => ({ keyId: this.keyId, recovery: 'locked', savedAt: '2026-10-14' }),
      askToLink: async (id, commitment) => {
        this.rows.set(id, {
          id,
          session,
          commitment,
          key: null,
          approver: null,
          sealed: null,
          denied: false,
          linked: false,
        });
      },
      linkRequest: async (id) => {
        const found = this.rows.get(id);
        return found ? this.view(found, session) : null;
      },
      offerToApprove: async (id, key) => {
        const found = row(id);
        if (found.session === session) throw new Error('refused');
        if (found.approver?.session === session && found.approver.key === key) return;
        if (found.approver) throw new Error('refused');
        found.approver = { session, device, key };
      },
      showKey: async (id, key) => {
        const found = row(id);
        if (found.session !== session || !found.approver) throw new Error('refused');
        found.key = key;
      },
      approveRequest: async (id, sealed) => {
        const found = row(id);
        if (found.approver?.session !== session || !found.key) throw new Error('refused');
        if (found.sealed !== null && found.sealed !== sealed) throw new Error('refused');
        found.sealed = sealed;
      },
      denyRequest: async (id) => {
        row(id).denied = true;
      },
      takeApproval: async (id) => {
        const found = this.rows.get(id);
        if (found?.session !== session || !found.sealed || found.denied) return null;
        const { sealed } = found;
        found.sealed = null;
        found.linked = true;
        return sealed;
      },
      cancelRequest: async (id) => {
        this.rows.delete(id);
      },
    };
  }
}

/** A one-time public key of no one's, as a server in the middle would make. */
async function anotherKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
}

/** A request as the approver lists it. */
async function listed(server: FakeServer, id: string): Promise<LinkRequest> {
  const request = await server.as('mac').linkRequest(id);
  if (!request) throw new Error('No such request.');
  return request;
}

/** Runs both sides up to where each shows its emoji. */
async function upToTheCheck(server = new FakeServer()) {
  const ask = await LinkAsk.start(server.as('new'));
  expect(await ask.step()).toEqual({ state: 'waiting' });
  const approval = await LinkApproval.start(
    server.as('mac'),
    await listed(server, ask.id),
    server.keyId,
  );
  expect(await approval.step()).toEqual({ state: 'waiting' });
  const asked = await ask.step();
  const approving = await approval.step();
  return { server, ask, approval, asked, approving };
}

describe('approving a new device', () => {
  it('shows the same emoji on both devices, and hands the account key over', async () => {
    const { ask, approval, asked, approving } = await upToTheCheck();
    expect(asked).toMatchObject({ state: 'check', approver: 'Factwright on Sam’s Mac' });
    expect(approving.state).toBe('check');
    const check = asked.state === 'check' ? asked.check : [];
    expect(approving).toEqual({ state: 'check', check });
    expect(check).toHaveLength(6);
    for (const value of check) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of check) expect(value).toBeLessThan(64);

    const accountKey = newAccountKey();
    await approval.approve(accountKey);
    expect(await ask.step()).toMatchObject({ state: 'check', approved: true });
    ask.confirm();
    expect(await ask.finish()).toEqual(accountKey);
    // Picked up once, and the approver can tell.
    expect(await ask.finish()).toBeNull();
    expect(await ask.step()).toEqual({ state: 'gone' });
    expect(await approval.step()).toEqual({ state: 'linked' });
  });

  it('makes different emoji each time', async () => {
    const first = await upToTheCheck();
    const second = await upToTheCheck();
    expect(first.asked).not.toEqual(second.asked);
  });

  it('picks nothing up until the person says the emoji match here too', async () => {
    const server = new FakeServer();
    const client = server.as('new');
    const take = vi.spyOn(client, 'takeApproval');
    const ask = await LinkAsk.start(client);
    const approval = await LinkApproval.start(
      server.as('mac'),
      await listed(server, ask.id),
      server.keyId,
    );
    await ask.step();
    await approval.step();
    await approval.approve(newAccountKey());
    expect(await ask.finish()).toBeNull();
    expect(take).not.toHaveBeenCalled();
    ask.confirm();
    expect(await ask.finish()).not.toBeNull();
  });

  it('won’t seal the key before both keys are in', async () => {
    const server = new FakeServer();
    const ask = await LinkAsk.start(server.as('new'));
    const approval = await LinkApproval.start(
      server.as('mac'),
      await listed(server, ask.id),
      server.keyId,
    );
    await expect(approval.approve(newAccountKey())).rejects.toThrow('Check the emoji');
  });

  it('says when the other device turned it down', async () => {
    const { ask, approval } = await upToTheCheck();
    await approval.deny();
    expect(await ask.step()).toEqual({ state: 'denied' });
    expect(await approval.step()).toEqual({ state: 'gone' });
  });

  it('lets only one device approve', async () => {
    const server = new FakeServer();
    const ask = await LinkAsk.start(server.as('new'));
    const request = await listed(server, ask.id);
    const approval = await LinkApproval.start(server.as('mac'), request, server.keyId);
    await expect(LinkApproval.start(server.as('pc'), request, server.keyId)).rejects.toThrow(
      'refused',
    );
    // Should the server hand it to another device after all, the first one stops.
    const row = server.rows.get(ask.id);
    if (row) row.approver = { session: 'pc', device: 'PC', key: await anotherKey() };
    expect(await approval.step()).toEqual({ state: 'taken' });
  });
});

describe('the account key’s ID', () => {
  it('is in the emoji, so an approver holding another key shows other emoji', async () => {
    const server = new FakeServer();
    const ask = await LinkAsk.start(server.as('new'));
    const stale = toBase64Url(randomBytes(16));
    const approval = await LinkApproval.start(
      server.as('mac'),
      await listed(server, ask.id),
      stale,
    );
    await approval.step();
    const asked = await ask.step();
    const approving = await approval.step();
    expect(asked.state).toBe('check');
    expect(approving.state).toBe('check');
    expect(asked.state === 'check' && asked.check).not.toEqual(
      approving.state === 'check' && approving.check,
    );
  });

  it('must be there for the new device to go on', async () => {
    const server = new FakeServer();
    const client = { ...server.as('new'), keys: async () => null };
    const ask = await LinkAsk.start(client);
    await LinkApproval.start(server.as('mac'), await listed(server, ask.id), server.keyId);
    expect(await ask.step()).toEqual({ state: 'failed' });
  });
});

describe('a run', () => {
  it('ends after 10 minutes on each device, whatever the server says', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { ask, approval } = await upToTheCheck();
      ask.confirm();
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
      expect(await ask.step()).toEqual({ state: 'gone' });
      expect(await approval.step()).toEqual({ state: 'gone' });
      await expect(approval.approve(newAccountKey())).rejects.toThrow('ran out');
      expect(await ask.finish()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a server in the middle', () => {
  it('can’t make the emoji match by swapping in keys of its own', async () => {
    // The server plays approver to the new device, and new device to the approver.
    const server = new FakeServer();
    const ask = await LinkAsk.start(server.as('new'));
    const real = await listed(server, ask.id);
    const fakeApprover = await LinkApproval.start(
      server.as('server-as-approver'),
      real,
      server.keyId,
    );

    const relay = new FakeServer();
    // It tells each device the account's real key ID: that's no secret from the server.
    relay.keyId = server.keyId;
    const fakeAsk = await LinkAsk.start(relay.as('server-as-new'));
    const approval = await LinkApproval.start(
      relay.as('mac'),
      await listed(relay, fakeAsk.id),
      relay.keyId,
    );

    const onNew = await ask.step();
    expect(await fakeApprover.step()).toMatchObject({ state: 'check' });
    const fake = await fakeAsk.step();
    const onMac = await approval.step();
    expect(onNew.state).toBe('check');
    expect(onMac.state).toBe('check');
    // Each side's emoji come from a different secret, so they don't match.
    const shownNew = onNew.state === 'check' ? onNew.check : [];
    const shownMac = onMac.state === 'check' ? onMac.check : [];
    expect(shownNew).not.toEqual(shownMac);
    expect(fake).toMatchObject({ state: 'check' });
  });

  it('can’t show the approver a key other than the one the request committed to', async () => {
    const server = new FakeServer();
    const ask = await LinkAsk.start(server.as('new'));
    const approval = await LinkApproval.start(
      server.as('mac'),
      await listed(server, ask.id),
      server.keyId,
    );
    await ask.step();
    const row = server.rows.get(ask.id);
    if (row) row.key = await anotherKey();
    expect(await approval.step()).toEqual({ state: 'failed' });
  });

  it('can’t change the approver’s key once the new device has shown its own', async () => {
    const { server, ask } = await upToTheCheck();
    const row = server.rows.get(ask.id);
    if (row?.approver) row.approver.key = await anotherKey();
    expect(await ask.step()).toEqual({ state: 'failed' });
  });

  it('can’t slip the new device a key of its own unless the person says unmatched emoji match', async () => {
    // The server approves the new device with a key it made, and shows the person's computer a
    // request of its own making in place of the real one.
    const server = new FakeServer();
    const ask = await LinkAsk.start(server.as('new'));
    const fakeApprover = await LinkApproval.start(
      server.as('server-as-approver'),
      await listed(server, ask.id),
      server.keyId,
    );
    const relay = new FakeServer();
    relay.keyId = server.keyId;
    const fakeAsk = await LinkAsk.start(relay.as('server-as-new'));
    const mac = await LinkApproval.start(
      relay.as('mac'),
      await listed(relay, fakeAsk.id),
      relay.keyId,
    );
    const onNew = await ask.step();
    await fakeApprover.step();
    await fakeAsk.step();
    const onMac = await mac.step();
    // The two screens disagree, so the person says no, and nothing is picked up.
    expect(onNew.state === 'check' && onNew.check).not.toEqual(
      onMac.state === 'check' && onMac.check,
    );
    const serversKey = newAccountKey();
    await fakeApprover.approve(serversKey);
    expect(await ask.finish()).toBeNull();
    // Said to match anyway, the server's key would open. Its ID differs from the account's key
    // record here, which the apps check before using a key, but a server in the middle controls
    // that record too: against one, it's the person comparing the emoji that protects them.
    ask.confirm();
    const taken = await ask.finish();
    if (!taken) throw new Error('Nothing was picked up.');
    expect(taken).toEqual(serversKey);
    expect((await accountKeys(taken)).id).not.toBe(server.keyId);
  });

  it('offers the same key again when the first answer was lost', async () => {
    const server = new FakeServer();
    const ask = await LinkAsk.start(server.as('new'));
    const approval = await LinkApproval.prepare(
      server.as('mac'),
      await listed(server, ask.id),
      server.keyId,
    );
    await approval.offer();
    await ask.step();
    // The new device has shown its key since: the same offer is still taken.
    await approval.offer();
    expect(await approval.step()).toMatchObject({ state: 'check' });
  });

  it('seals the same thing again when the first answer was lost', async () => {
    const { server, ask, approval } = await upToTheCheck();
    const accountKey = newAccountKey();
    await approval.approve(accountKey);
    const first = server.rows.get(ask.id)?.sealed;
    // The server keeps the first, and takes the same again without a fuss.
    await approval.approve(accountKey);
    expect(server.rows.get(ask.id)?.sealed).toBe(first);
  });

  it('refuses keys that aren’t points on the curve', async () => {
    const server = new FakeServer();
    const ask = await LinkAsk.start(server.as('new'));
    const row = server.rows.get(ask.id);
    if (row) row.approver = { session: 'mac', device: 'Mac', key: `B${'A'.repeat(86)}` };
    expect(await ask.step()).toEqual({ state: 'failed' });
  });

  it('can’t open a key sealed for another request', async () => {
    const first = await upToTheCheck();
    const second = await upToTheCheck();
    await first.approval.approve(newAccountKey());
    // The second request's row is handed the first one's sealed key.
    const sealed = first.server.rows.get(first.ask.id)?.sealed ?? null;
    const row = second.server.rows.get(second.ask.id);
    if (row) row.sealed = sealed;
    second.ask.confirm();
    expect(await second.ask.finish()).toBeNull();
  });
});

describe('commitments', () => {
  it('are a hash of the request and its key, and nothing else', async () => {
    const id = toBase64Url(randomBytes(16));
    const ask = await LinkAsk.start(new FakeServer().as('new'));
    expect(await commitmentTo(id, 'not a key')).toBeNull();
    expect(await commitmentTo('short', `B${'A'.repeat(86)}`)).toBeNull();
    const key = `B${'A'.repeat(86)}`;
    const commitment = await commitmentTo(id, key);
    expect(commitment).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await commitmentTo(id, key)).toBe(commitment);
    expect(await commitmentTo(ask.id, key)).not.toBe(commitment);
  });
});

describe('check emoji', () => {
  it('are 64, each with a name, none twice', () => {
    expect(CHECK_EMOJI).toHaveLength(64);
    expect(new Set(CHECK_EMOJI.map((each) => each.emoji)).size).toBe(64);
    expect(new Set(CHECK_EMOJI.map((each) => each.name)).size).toBe(64);
    expect(checkEmoji([0, 63])).toEqual([
      { emoji: '🐶', name: 'Dog' },
      { emoji: '📌', name: 'Pin' },
    ]);
  });
});
