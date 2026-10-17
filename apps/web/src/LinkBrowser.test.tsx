import {
  accountKeys,
  LinkApproval,
  lockForLink,
  lockWithRecoveryKey,
  newAccountKey,
  newLinkCode,
  newRecoveryKey,
  SyncClient,
} from '@factwright/sync';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveKeys } from './keys.ts';
import { LinkBrowser } from './LinkBrowser.tsx';
import { fakeServer } from './testing.ts';

// The test browser has no IndexedDB, and what's kept there is the page's own business.
vi.mock('./keys.ts', () => ({ saveKeys: vi.fn(async () => {}) }));

/** An account with sync turned on: its key, as the server keeps it, locked with the recovery key. */
async function anAccount() {
  const accountKey = newAccountKey();
  const keys = await accountKeys(accountKey);
  const recovery = newRecoveryKey();
  const saved = {
    keyId: keys.id,
    recovery: await lockWithRecoveryKey(accountKey, recovery.bytes),
    savedAt: '2026-10-10T18:00:00.000Z',
  };
  return { accountKey, keys, recovery, saved };
}

beforeEach(() => {
  vi.mocked(saveKeys).mockClear();
});

describe('linking a phone', () => {
  it('links straight away with the code from a QR code', async () => {
    const { accountKey, keys, saved } = await anAccount();
    const code = newLinkCode();
    const link = await lockForLink(accountKey, code.bytes);
    const requests = fakeServer({
      [`POST /api/sync/links/${link.id}/take`]: () => ({ data: link.data }),
      'GET /api/sync/keys': () => ({ keys: saved }),
    });
    const onLinked = vi.fn();
    render(
      <LinkBrowser account="sam" email="sam@example.com" code={code.text} onLinked={onLinked} />,
    );
    expect(screen.getByRole('heading', { name: 'Linking this phone…' })).toBeTruthy();

    await waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    expect(onLinked.mock.calls[0]?.[0]).toMatchObject({ id: keys.id });
    expect(saveKeys).toHaveBeenCalledWith('sam', expect.objectContaining({ id: keys.id }));
    // The code itself never goes to the server, only the ID made from it.
    expect(JSON.stringify(requests)).not.toContain(code.text);
  });

  it('says when a QR code’s link has run out', async () => {
    fakeServer({});
    const onLinked = vi.fn();
    render(
      <LinkBrowser
        account="sam"
        email="sam@example.com"
        code={newLinkCode().text}
        onLinked={onLinked}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code didn’t work. It lasts 10 minutes: make a new one on your computer.',
    );
    expect(screen.getByRole('heading', { name: 'Link this browser' })).toBeTruthy();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('says sync is paused when a code can’t link, where sync is sold, and lets them try again', async () => {
    const code = newLinkCode();
    let answered = 0;
    // The server turns down taking the link: the account's subscription ended.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        answered += 1;
        return Response.json(
          {
            error: 'subscription-needed',
            message: 'Sync on Factwright’s server needs a subscription.',
          },
          { status: 402 },
        );
      }),
    );
    render(<LinkBrowser account="sam" email="sam@example.com" code={null} onLinked={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Code from your computer'), code.text);
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your subscription ended, so sync is paused, and this browser can’t link until you subscribe again.',
    );
    // The form isn't left waiting: it can be sent again.
    expect(screen.getByRole('button', { name: 'Link' })).toHaveProperty('disabled', false);
    expect(answered).toBe(1);
  });

  it('says sync is paused before anyone tries, once the page knows', async () => {
    fakeServer({});
    const { container } = render(
      <LinkBrowser account="sam" email="sam@example.com" code={null} paused onLinked={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { name: 'Sync is paused' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Subscribe again' })).toBeTruthy();
    expect(screen.queryByLabelText('Code from your computer')).toBeNull();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('won’t keep a key that belongs to another account', async () => {
    const { accountKey } = await anAccount();
    const other = await anAccount();
    const code = newLinkCode();
    const link = await lockForLink(accountKey, code.bytes);
    fakeServer({
      [`POST /api/sync/links/${link.id}/take`]: () => ({ data: link.data }),
      'GET /api/sync/keys': () => ({ keys: other.saved }),
    });
    const onLinked = vi.fn();
    render(
      <LinkBrowser account="sam" email="sam@example.com" code={code.text} onLinked={onLinked} />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That key belongs to a different account.',
    );
    expect(saveKeys).not.toHaveBeenCalled();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('takes a code typed in, and says when it isn’t one', async () => {
    fakeServer({});
    const { container } = render(
      <LinkBrowser account="sam" email="sam@example.com" code={null} onLinked={vi.fn()} />,
    );
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByText('Or type the code it shows'));
    const field = screen.getByRole('textbox', { name: 'Code from your computer' });
    const link = screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement;
    expect(link.disabled).toBe(true);
    await userEvent.type(field, 'this is not a link code, though long');
    await userEvent.click(link);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That isn’t a link code. It’s 32 letters and numbers.',
    );
  });

  it('unlocks with the recovery key, typed any way', async () => {
    const { keys, recovery, saved } = await anAccount();
    fakeServer({ 'GET /api/sync/keys': () => ({ keys: saved }) });
    const onLinked = vi.fn();
    render(<LinkBrowser account="sam" email="sam@example.com" code={null} onLinked={onLinked} />);
    await userEvent.click(screen.getByText('Lost your computers? Use your recovery key'));
    const field = screen.getByLabelText('Recovery key') as HTMLInputElement;
    // A password field under the account's email, so a password manager can fill it in.
    expect(field.type).toBe('password');
    expect(field.autocomplete).toBe('current-password');
    const username = field.form?.querySelector<HTMLInputElement>('input[autocomplete=username]');
    expect(username?.value).toBe('sam@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(field.type).toBe('text');
    await userEvent.type(field, recovery.text.toLowerCase().replaceAll('-', ' '));
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    expect(onLinked.mock.calls[0]?.[0]).toMatchObject({ id: keys.id });
  });

  it('says when a recovery key doesn’t open the account', async () => {
    const { saved } = await anAccount();
    fakeServer({ 'GET /api/sync/keys': () => ({ keys: saved }) });
    render(<LinkBrowser account="sam" email="sam@example.com" code={null} onLinked={vi.fn()} />);
    await userEvent.click(screen.getByText('Lost your computers? Use your recovery key'));
    await userEvent.type(screen.getByLabelText('Recovery key'), newRecoveryKey().text);
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That recovery key doesn’t open this account. Check it, and try again.',
    );
  });
});

/**
 * The server's requests to link, in memory, as each session sees them: the browser's own session
 * ("web", with no token) and a computer's ("mac"). Returns the fetch the computer uses.
 */
function requestServer(saved: object, { stale = false } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const seen: string[] = [];
  const view = (row: Record<string, unknown>, session: string) => ({
    id: row.id,
    device: 'Chrome on Windows',
    deviceId: String(row.session),
    asked: new Date().toISOString(),
    expires: new Date(Date.now() + 600_000).toISOString(),
    signedIn: new Date().toISOString(),
    commitment: row.commitment,
    key: row.key ?? null,
    approver: row.approverKey ? { device: 'Factwright on Sam’s Mac', key: row.approverKey } : null,
    state: row.denied ? 'denied' : row.linked ? 'linked' : row.sealed ? 'approved' : 'waiting',
    mine: row.session === session,
    approving: row.approver === session,
  });
  const handle = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), location.origin);
    const method = (init.method ?? 'GET').toUpperCase();
    const session = new Headers(init.headers).get('authorization') ? 'mac' : 'web';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    seen.push(`${session} ${method} ${url.pathname}${init.keepalive ? ' as the page goes' : ''}`);
    const json = (value: unknown) => Response.json(value);
    const gone = () => Response.json({ error: 'not-found', message: 'Gone.' }, { status: 404 });
    if (url.pathname === '/api/sync/keys') return json({ keys: saved });
    if (method === 'POST' && url.pathname === '/api/sync/requests') {
      if (stale) {
        return Response.json(
          { error: 'stale', message: 'This device signed in a while ago.' },
          { status: 403 },
        );
      }
      rows.set(body.id, { id: body.id, commitment: body.commitment, session });
      return new Response(null, { status: 201 });
    }
    const [, id, step] = /^\/api\/sync\/requests\/([^/]+)(?:\/(\w+))?$/.exec(url.pathname) ?? [];
    const row = id ? rows.get(id) : undefined;
    if (!row) return gone();
    if (method === 'GET') return json(view(row, session));
    if (method === 'DELETE') rows.delete(row.id as string);
    if (step === 'approver') Object.assign(row, { approver: session, approverKey: body.key });
    if (step === 'key') row.key = body.key;
    if (step === 'approve') row.sealed = body.sealed;
    if (step === 'deny') row.denied = true;
    if (step === 'take') {
      if (!row.sealed) return gone();
      const { sealed } = row;
      Object.assign(row, { sealed: null, linked: true });
      return json({ sealed });
    }
    return new Response(null, { status: 204 });
  };
  vi.stubGlobal('fetch', vi.fn(handle));
  const mac = new SyncClient({
    server: location.origin,
    token: () => 'mac',
    fetch: handle as typeof fetch,
  });
  return { rows, seen, mac };
}

describe('asking a computer to approve this browser', () => {
  afterEach(() => vi.useRealTimers());

  /** Moves fake time on, so each look at the other device happens at once. */
  const later = (ms = 1500) => act(() => vi.advanceTimersByTimeAsync(ms));

  async function asked(rows: Map<string, Record<string, unknown>>) {
    await waitFor(() => expect(rows.size).toBe(1));
    const [id] = [...rows.keys()];
    return id ?? '';
  }

  it('links once both say the emoji match, with the key sealed for this browser', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { accountKey, keys, saved } = await anAccount();
    const { rows, mac } = requestServer(saved);
    const onLinked = vi.fn();
    const { container } = render(
      <LinkBrowser
        account="sam"
        email="sam@example.com"
        canApprove
        code={null}
        onLinked={onLinked}
      />,
    );
    expect(screen.getByText('Waiting for your computer…')).toBeTruthy();
    const id = await asked(rows);
    const request = await mac.linkRequest(id);
    if (!request) throw new Error('No request.');
    const approval = await LinkApproval.start(mac, request, keys.id);
    await later();
    const shown = await screen.findByRole('list', { name: 'Check code' });
    expect(screen.getByText(/offered to approve this browser/)).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    const onMac = await approval.step();
    expect(onMac.state).toBe('check');
    const emoji = within(shown)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(emoji).toHaveLength(6);

    await user.click(screen.getByRole('button', { name: 'They match' }));
    expect(screen.getByText(/Now say they match on/)).toBeTruthy();
    await approval.approve(accountKey);
    await later();
    await waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    expect(onLinked.mock.calls[0]?.[0]).toMatchObject({ id: keys.id });
    expect(saveKeys).toHaveBeenCalledWith('sam', expect.objectContaining({ id: keys.id }));
    expect(await approval.step()).toEqual({ state: 'linked' });
  });

  it('links nothing when the emoji don’t match, and can ask again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { keys, saved } = await anAccount();
    const { rows, seen, mac } = requestServer(saved);
    render(
      <LinkBrowser
        account="sam"
        email="sam@example.com"
        canApprove
        code={null}
        onLinked={vi.fn()}
      />,
    );
    const id = await asked(rows);
    const request = await mac.linkRequest(id);
    if (!request) throw new Error('No request.');
    await LinkApproval.start(mac, request, keys.id);
    await later();
    await user.click(await screen.findByRole('button', { name: 'They don’t match' }));
    expect(seen).toContain(`web DELETE /api/sync/requests/${id}`);
    expect(screen.getByText(/Nothing was linked/)).toBeTruthy();
    // The emoji it showed stay, to compare with what the computer showed.
    expect(screen.getByRole('list', { name: 'Emoji this browser showed' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ask again' }));
    await waitFor(() => expect(rows.size).toBe(1));
    expect([...rows.keys()]).not.toContain(id);
  });

  it('calls its request off when the page goes', async () => {
    const { saved } = await anAccount();
    const { rows, seen } = requestServer(saved);
    const { unmount } = render(
      <LinkBrowser
        account="sam"
        email="sam@example.com"
        canApprove
        code={null}
        onLinked={vi.fn()}
      />,
    );
    const id = await asked(rows);
    unmount();
    await waitFor(() => expect(seen).toContain(`web DELETE /api/sync/requests/${id}`));
  });

  it('calls its request off when the tab closes', async () => {
    const { saved } = await anAccount();
    const { rows, seen } = requestServer(saved);
    render(
      <LinkBrowser
        account="sam"
        email="sam@example.com"
        canApprove
        code={null}
        onLinked={vi.fn()}
      />,
    );
    const id = await asked(rows);
    window.dispatchEvent(new Event('pagehide'));
    expect(seen).toContain(`web DELETE /api/sync/requests/${id} as the page goes`);
  });

  it('calls its request off when a try fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { saved } = await anAccount();
    const { rows, seen } = requestServer(saved);
    render(
      <LinkBrowser
        account="sam"
        email="sam@example.com"
        canApprove
        code={null}
        onLinked={vi.fn()}
      />,
    );
    const id = await asked(rows);
    // An approving key that isn't a point on the curve: the try can't go on.
    const row = rows.get(id);
    if (row) Object.assign(row, { approver: 'mac', approverKey: `B${'A'.repeat(86)}` });
    await later();
    expect(await screen.findByText(/Something changed the request/)).toBeTruthy();
    expect(seen).toContain(`web DELETE /api/sync/requests/${id}`);
  });

  it('leads with the code when it signed in too long ago to ask', async () => {
    const { saved } = await anAccount();
    requestServer(saved, { stale: true });
    render(
      <LinkBrowser
        account="sam"
        email="sam@example.com"
        canApprove
        code={null}
        onLinked={vi.fn()}
      />,
    );
    expect(await screen.findByText(/signed in a while ago/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy();
    expect(screen.getByText(/Then scan its QR code with your phone’s camera/)).toBeTruthy();
    expect(screen.queryByText('Waiting for your computer…')).toBeNull();
  });

  it('says what to do when nothing shows on the computer for a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { saved } = await anAccount();
    const { rows } = requestServer(saved);
    render(
      <LinkBrowser
        account="sam"
        email="sam@example.com"
        canApprove
        code={null}
        onLinked={vi.fn()}
      />,
    );
    await asked(rows);
    expect(screen.queryByText(/Nothing showing there/)).toBeNull();
    await later(30_000);
    expect(screen.getByText(/Nothing showing there\? Update Factwright/)).toBeTruthy();
  });

  it('only offers codes when the server can’t approve devices yet', async () => {
    const { saved } = await anAccount();
    const { seen } = requestServer(saved);
    render(<LinkBrowser account="sam" email="sam@example.com" code={null} onLinked={vi.fn()} />);
    expect(screen.getByText(/Then scan its QR code with your phone’s camera/)).toBeTruthy();
    expect(screen.queryByText('Waiting for your computer…')).toBeNull();
    expect(seen.filter((request) => request.includes('/requests'))).toEqual([]);
  });
});
