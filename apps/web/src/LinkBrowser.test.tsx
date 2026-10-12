import {
  accountKeys,
  lockForLink,
  lockWithRecoveryKey,
  newAccountKey,
  newLinkCode,
  newRecoveryKey,
} from '@factwright/sync';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    render(<LinkBrowser account="sam" code={code.text} onLinked={onLinked} />);
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
    render(<LinkBrowser account="sam" code={newLinkCode().text} onLinked={onLinked} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code didn’t work. It lasts 10 minutes: make a new one on your computer.',
    );
    expect(screen.getByRole('heading', { name: 'Link this phone' })).toBeTruthy();
    expect(onLinked).not.toHaveBeenCalled();
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
    render(<LinkBrowser account="sam" code={code.text} onLinked={onLinked} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That key belongs to a different account.',
    );
    expect(saveKeys).not.toHaveBeenCalled();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('takes a code typed in, and says when it isn’t one', async () => {
    fakeServer({});
    const { container } = render(<LinkBrowser account="sam" code={null} onLinked={vi.fn()} />);
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
    render(<LinkBrowser account="sam" code={null} onLinked={onLinked} />);
    await userEvent.click(screen.getByText('Lost your computers? Use your recovery key'));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Recovery key' }),
      recovery.text.toLowerCase().replaceAll('-', ' '),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    expect(onLinked.mock.calls[0]?.[0]).toMatchObject({ id: keys.id });
  });

  it('says when a recovery key doesn’t open the account', async () => {
    const { saved } = await anAccount();
    fakeServer({ 'GET /api/sync/keys': () => ({ keys: saved }) });
    render(<LinkBrowser account="sam" code={null} onLinked={vi.fn()} />);
    await userEvent.click(screen.getByText('Lost your computers? Use your recovery key'));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Recovery key' }),
      newRecoveryKey().text,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That recovery key doesn’t open this account. Check it, and try again.',
    );
  });
});
