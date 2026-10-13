// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import type { SyncStatus } from '../../shared/sync.ts';
import { SyncCard } from './SyncCard.tsx';
import { SyncDialog } from './SyncDialog.tsx';
import { sampleSync } from './sample-sync.ts';
import { timeAgo } from './useSync.ts';

beforeAll(() => {
  // jsdom doesn't open dialogs on its own.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(cleanup);

const ON: SyncStatus = {
  state: 'on',
  email: 'sam@example.com',
  activity: 'idle',
  lastSynced: new Date().toISOString(),
  message: null,
  skipped: 0,
};

/** The window's API, with sample sync and spies for the rest it uses here. */
function apiFor(start: string) {
  const sync = sampleSync(start);
  const api = {
    ...sync,
    copyText: vi.fn(async () => ({ ok: true as const })),
    saveFile: vi.fn(async () => ({ ok: true as const, saved: true })),
  } as unknown as FactwrightApi;
  return api;
}

/** The dialog, following sync as it moves along, as the app shows it. */
async function openDialog(api: FactwrightApi) {
  let status = await api.syncStatus();
  const view = render(<SyncDialog api={api} status={status} onClose={vi.fn()} />);
  api.onSyncStatus((next) => {
    status = next;
    view.rerender(<SyncDialog api={api} status={status} onClose={vi.fn()} />);
  });
  return view;
}

describe('SyncCard', () => {
  it.each([
    ['checking', 'Checking…', null],
    [{ state: 'off' }, 'Off', 'Turn on…'],
    [{ state: 'signing-in', code: 'WDJB-MJHT', url: 'x' }, 'Finish signing in', 'Show'],
    [
      { state: 'setting-up', email: 'a', firstDevice: true },
      'Save your recovery key',
      'Finish setting up',
    ],
    [
      { state: 'setting-up', email: 'a', firstDevice: false },
      'Link this computer',
      'Finish setting up',
    ],
    [ON, 'Up to date', 'Manage'],
    [{ ...ON, activity: 'syncing' }, 'Syncing…', 'Manage'],
    [{ ...ON, activity: 'offline', message: 'Can’t reach the sync server.' }, 'Offline', 'Manage'],
    [{ state: 'signed-out', email: 'a' }, 'Sign in again', 'Sign in…'],
    [{ state: 'unavailable' }, 'Can’t turn on here', null],
  ] as [SyncStatus | 'checking', string, string | null][])(
    'says how sync stands, and what to do (%o)',
    async (status, line, action) => {
      const onOpen = vi.fn();
      const { container } = render(<SyncCard status={status} onOpen={onOpen} />);
      expect(screen.getByText(line)).toBeTruthy();
      if (action) {
        screen.getByRole('button', { name: action }).click();
        expect(onOpen).toHaveBeenCalledOnce();
      } else {
        expect(screen.queryByRole('button')).toBeNull();
      }
      expect((await axe.run(container)).violations).toEqual([]);
    },
  );
});

describe('SyncDialog', () => {
  it('turns sync on, from signing in to saving the recovery key', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = apiFor('off');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openDialog(api);
    expect(screen.getByRole('heading', { name: 'Sync your job hunt' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign in with your browser' }));
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('heading', { name: 'Save your recovery key' })).toBeTruthy();
    const shown = await screen.findByText(
      (_, element) =>
        element?.tagName === 'CODE' &&
        element.textContent === '7KQ2-M9XD-4RTB-HP0E-WN3C-8YVA-G5KS-21FJ',
    );
    const key = shown.parentElement as HTMLElement;
    const turnOn = screen.getByRole('button', { name: 'Turn on sync' }) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    await user.click(within(key).getByRole('button', { name: 'Copy' }));
    expect(api.copyText).toHaveBeenCalledWith('7KQ2-M9XD-4RTB-HP0E-WN3C-8YVA-G5KS-21FJ');
    await user.click(within(key).getByRole('button', { name: 'Save as a file…' }));
    expect(api.saveFile).toHaveBeenCalledWith(
      'Factwright recovery key.txt',
      expect.stringContaining('7KQ2-M9XD-4RTB-HP0E-WN3C-8YVA-G5KS-21FJ'),
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'I’ve saved my recovery key somewhere safe' }),
    );
    await user.click(turnOn);
    expect(await screen.findByRole('heading', { name: 'Sync' })).toBeTruthy();
    vi.useRealTimers();
  });

  it('says signing in agrees to the terms and privacy policy, with a link to each', async () => {
    await openDialog(apiFor('off'));
    const terms = screen.getByRole('link', { name: 'terms of service' });
    const privacy = screen.getByRole('link', { name: 'privacy policy' });
    expect(terms.getAttribute('href')).toBe('https://factwright.com/terms');
    expect(privacy.getAttribute('href')).toBe('https://factwright.com/privacy');
    // The window opens links in the browser, so neither leaves the app.
    expect([terms, privacy].map((link) => link.getAttribute('target'))).toEqual([
      '_blank',
      '_blank',
    ]);
  });

  it('says why a computer that synced before saves a new recovery key', async () => {
    const api = apiFor('off');
    render(
      <SyncDialog
        api={api}
        status={{ state: 'setting-up', email: 'sam@example.com', firstDevice: true, again: true }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Save a new recovery key' })).toBeTruthy();
    expect(screen.getByText(/a key you saved before won’t open it/)).toBeTruthy();
  });

  it('ends a sign-in with the wrong account, from either step', async () => {
    const user = userEvent.setup();
    for (const firstDevice of [true, false]) {
      const api = {
        ...apiFor('off'),
        useDifferentSyncAccount: vi.fn(async () => ({ ok: true as const })),
      };
      const { unmount } = render(
        <SyncDialog
          api={api}
          status={{ state: 'setting-up', email: 'work@example.com', firstDevice }}
          onClose={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Use a different account' }));
      expect(api.useDifferentSyncAccount).toHaveBeenCalledOnce();
      unmount();
    }
  });

  it('links a second computer with a code, and says what’s wrong with a bad one', async () => {
    const api = apiFor('link');
    const user = userEvent.setup();
    const { container } = await openDialog(api);
    const field = screen.getByRole('textbox', { name: 'Code from your other device' });
    const link = screen.getByRole('button', { name: 'Link this computer' }) as HTMLButtonElement;
    expect(link.disabled).toBe(true);
    await user.type(field, 'M4XP-2KQD-9TRB-HN0W-C3ZA-8YVG-5KSP-1FJ!');
    await user.click(link);
    expect((await screen.findByRole('alert')).textContent).toContain('isn’t a link code');
    expect((await axe.run(container)).violations).toEqual([]);
    await user.clear(field);
    await user.type(field, 'm4xp 2kqd 9trb hn0w c3za 8yvg 5ksp 1fj7');
    await user.click(link);
    expect(await screen.findByRole('heading', { name: 'Sync' })).toBeTruthy();
  });

  it('offers the recovery key for when every other device is lost', async () => {
    const api = apiFor('link');
    const user = userEvent.setup();
    await openDialog(api);
    await user.click(screen.getByText('Lost your other devices? Use your recovery key'));
    await user.type(
      screen.getByRole('textbox', { name: 'Recovery key' }),
      '7KQ2-M9XD-4RTB-HP0E-WN3C-8YVA-G5KS-21FJ',
    );
    await user.click(screen.getByRole('button', { name: 'Unlock with recovery key' }));
    expect(await screen.findByRole('heading', { name: 'Sync' })).toBeTruthy();
  });

  it('manages sync once it’s on: devices, a link code, and turning it off here', async () => {
    const api = apiFor('on');
    const user = userEvent.setup();
    const { container } = await openDialog(api);
    const devices = await screen.findByRole('region', { name: 'Signed-in devices' });
    expect(within(devices).getByText('This computer')).toBeTruthy();
    await user.click(
      within(devices).getAllByRole('button', { name: 'Sign out' })[0] as HTMLElement,
    );
    await waitFor(() => expect(within(devices).queryByText('Factwright on SAM-PC')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Link a phone or computer' }));
    expect(await screen.findByRole('img', { name: 'QR code to link a phone' })).toBeTruthy();
    expect(screen.getByText('It works once, for the next 10 minutes.')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Turn off on this computer' }));
    expect(screen.getByText(/Your job hunt stays here/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Turn off here' }));
    expect(await screen.findByRole('heading', { name: 'Sync your job hunt' })).toBeTruthy();
  });

  it('says how long ago sync last ran', () => {
    const now = new Date('2026-10-12T12:00:00');
    expect(timeAgo('2026-10-12T11:59:40', now)).toBe('just now');
    expect(timeAgo('2026-10-12T11:55:00', now)).toBe('5 minutes ago');
    expect(timeAgo('2026-10-12T11:59:00', now)).toBe('1 minute ago');
    expect(timeAgo('2026-10-12T09:00:00', now)).toBe('3 hours ago');
    expect(timeAgo('2026-10-10T09:00:00', now)).toMatch(/^on /);
  });
});
