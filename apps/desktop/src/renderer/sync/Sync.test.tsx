// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi } from '../../shared/api.ts';
import type { ApprovalsView, SyncStatus } from '../../shared/sync.ts';
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

/** Stops each open dialog following sync, so nothing updates it once it's gone. */
const following: (() => void)[] = [];

afterEach(() => {
  for (const stop of following.splice(0)) stop();
  cleanup();
});

const ON: SyncStatus = {
  state: 'on',
  email: 'sam@example.com',
  activity: 'idle',
  lastSynced: new Date().toISOString(),
  message: null,
  skipped: 0,
};

/** What a sync server too old to approve devices says: only codes work. */
const OLD_SERVER: ApprovalsView = {
  supported: false,
  asking: null,
  requests: [],
  approving: null,
  turnedDown: null,
};

/** The window's API, with sample sync and spies for the rest it uses here. */
function apiFor(start: string, approve: string | null = 'old') {
  const sync = sampleSync(start, approve);
  const api = {
    ...sync,
    copyText: vi.fn(async () => ({ ok: true as const })),
    saveFile: vi.fn(async () => ({ ok: true as const, saved: true })),
  } as unknown as FactwrightApi;
  return api;
}

/** The dialog, following sync and linking by approval as they move along, as the app shows it. */
async function openDialog(api: FactwrightApi) {
  let status = await api.syncStatus();
  let approvals = await api.linkApprovals();
  const dialog = () => (
    <SyncDialog api={api} status={status} approvals={approvals} onClose={vi.fn()} />
  );
  // Listening first, so what the dialog sets off as it opens shows.
  let view: ReturnType<typeof render> | null = null;
  following.push(
    api.onSyncStatus((next) => {
      status = next;
      view?.rerender(dialog());
    }),
    api.onLinkApprovals((next) => {
      approvals = next;
      view?.rerender(dialog());
    }),
  );
  view = render(dialog());
  // Anything that changed while it first rendered shows too.
  view.rerender(dialog());
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
    [{ state: 'no-server' }, 'Not in this copy', null],
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
        status={{
          state: 'setting-up',
          email: 'sam@example.com',
          firstDevice: true,
          again: 'remade',
        }}
        approvals={OLD_SERVER}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Save a new recovery key' })).toBeTruthy();
    expect(screen.getByText(/a key you saved before won’t open it/)).toBeTruthy();
  });

  it('says why a computer that was syncing stopped, and links again', async () => {
    render(
      <SyncDialog
        api={apiFor('off')}
        status={{
          state: 'setting-up',
          email: 'sam@example.com',
          firstDevice: false,
          again: 'changed',
        }}
        approvals={OLD_SERVER}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Link this computer again' })).toBeTruthy();
    expect(screen.getByText(/Another device set up a new key/)).toBeTruthy();
  });

  it('says which recovery key to keep when another device turned on sync first', async () => {
    render(
      <SyncDialog
        api={apiFor('off')}
        status={{
          state: 'setting-up',
          email: 'sam@example.com',
          firstDevice: false,
          again: 'taken',
        }}
        approvals={OLD_SERVER}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Link this computer' })).toBeTruthy();
    expect(screen.getByText(/the recovery key shown here won’t open it/)).toBeTruthy();
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
          approvals={OLD_SERVER}
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
    const field = screen.getByLabelText('Recovery key') as HTMLInputElement;
    // A password field, so a password manager can fill it, with a way to see what's typed.
    expect(field.type).toBe('password');
    expect(field.autocomplete).toBe('current-password');
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(field.type).toBe('text');
    await user.type(field, '7KQ2-M9XD-4RTB-HP0E-WN3C-8YVA-G5KS-21FJ');
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

  it('says a copy built without a sync server can’t sync, with nothing to sign in to', async () => {
    const onClose = vi.fn();
    const api = apiFor('no-server');
    render(
      <SyncDialog
        api={api}
        status={await api.syncStatus()}
        approvals={OLD_SERVER}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Sync isn’t in this copy' })).toBeTruthy();
    expect(screen.getByText(/built from its code without a sync server/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with your browser' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledOnce();
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

describe('linking by approval', () => {
  afterEach(() => vi.useRealTimers());

  /** Fake time, moved on by hand, so the sample's waits pass at once. */
  function fakeTime() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    return {
      user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }),
      later: (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms)),
    };
  }

  it('asks a device that’s set up, and says what to do there', async () => {
    const api = apiFor('link', null);
    const { container } = await openDialog(api);
    expect(await screen.findByText(/On your other computer, open Factwright/)).toBeTruthy();
    expect(screen.getByText('Waiting for your other device…')).toBeTruthy();
    // The code and the recovery key are still there, out of the way.
    expect(screen.getByText('Or type a code from your other device')).toBeTruthy();
    expect(screen.getByText('Lost your other devices? Use your recovery key')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('links once the person says the emoji match here too', async () => {
    const { user, later } = fakeTime();
    const api = apiFor('link', null);
    const { container } = await openDialog(api);
    await later(3000);
    const code = await screen.findByRole('list', { name: 'Check code' });
    expect(
      within(code)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['🐶Dog', '🔑Key', '🚀Rocket', '🍕Pizza', '🎸Guitar', '⚓Anchor']);
    expect(screen.getByText(/offered to approve this computer/)).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'They match' }));
    expect(screen.getByText(/Now say they match on/)).toBeTruthy();
    await later(2500);
    expect(await screen.findByRole('heading', { name: 'Sync' })).toBeTruthy();
  });

  it('links nothing when the emoji don’t match, and can ask again', async () => {
    const api = apiFor('link', 'check');
    const user = userEvent.setup();
    await openDialog(api);
    await user.click(await screen.findByRole('button', { name: 'They don’t match' }));
    expect(await screen.findByText(/Nothing was linked/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ask again' }));
    expect(await screen.findByRole('button', { name: 'They match' })).toBeTruthy();
  });

  it('still takes a code', async () => {
    const api = apiFor('link', null);
    const user = userEvent.setup();
    await openDialog(api);
    await user.click(screen.getByText('Or type a code from your other device'));
    await user.type(
      screen.getByRole('textbox', { name: 'Code from your other device' }),
      'M4XP—2KQD—9TRB—HN0W—C3ZA—8YVG—5KSP—1FJ7',
    );
    await user.click(screen.getByRole('button', { name: 'Link this computer' }));
    expect(await screen.findByRole('heading', { name: 'Sync' })).toBeTruthy();
  });

  it('approves another device once the person says the emoji match', async () => {
    const { user, later } = fakeTime();
    const api = apiFor('on', 'request');
    const { container } = await openDialog(api);
    const panel = await screen.findByRole('region', { name: 'A new device wants to link' });
    expect(within(panel).getByText('Chrome on Windows')).toBeTruthy();
    expect(within(panel).getByText(/signed in 2 minutes ago/)).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(within(panel).getByRole('button', { name: 'Approve…' }));
    expect(await screen.findByText('Waiting for Chrome on Windows…')).toBeTruthy();
    await later(1500);
    const asking = await screen.findByRole('region', { name: 'Approve Chrome on Windows?' });
    expect(within(asking).getByRole('list', { name: 'Check code' })).toBeTruthy();
    expect(within(asking).getByText(/Only link a device that’s in front of you/)).toBeTruthy();
    expect(within(asking).getByText(/Nobody from Factwright will ever ask you/)).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(within(asking).getByRole('button', { name: 'They match, link it' }));
    expect(await screen.findByText(/Approved\. Chrome on Windows links once/)).toBeTruthy();
    await later(2500);
    expect(await screen.findByText('Chrome on Windows is linked.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('region', { name: /link/i })).toBeNull();
  });

  it('won’t approve while more than one device is asking', async () => {
    const api = apiFor('on', 'two');
    await openDialog(api);
    const panel = await screen.findByRole('region', { name: 'New devices want to link' });
    expect(within(panel).getByText(/More than one device is asking/)).toBeTruthy();
    expect(within(panel).getByText(/signed in 4 minutes ago/)).toBeTruthy();
    for (const button of within(panel).getAllByRole('button', { name: 'Approve…' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('keeps the emoji this computer showed once it’s over, to compare', async () => {
    const api = apiFor('link', 'check');
    const user = userEvent.setup();
    await openDialog(api);
    await user.click(await screen.findByRole('button', { name: 'They don’t match' }));
    expect(await screen.findByRole('list', { name: 'Emoji this computer showed' })).toBeTruthy();
  });

  it('turns a request down, then signs that device out if it isn’t the person’s', async () => {
    const api = apiFor('on', 'request');
    const user = userEvent.setup();
    const { container } = await openDialog(api);
    const panel = await screen.findByRole('region', { name: 'A new device wants to link' });
    await user.click(within(panel).getByRole('button', { name: 'Turn down' }));
    const done = await screen.findByRole('region', { name: 'Turned down' });
    expect(within(done).getByText(/If Chrome on Windows isn’t yours, sign it out/)).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(within(done).getByRole('button', { name: 'Sign it out' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Turned down' })).toBeNull());
  });

  it('won’t link while another device asks meanwhile', async () => {
    const api = apiFor('on', 'check');
    const user = userEvent.setup();
    const view = await openDialog(api);
    // Another device asks while the person checks the emoji.
    view.rerender(
      <SyncDialog
        api={api}
        status={ON}
        approvals={{
          ...(await api.linkApprovals()),
          requests: [
            {
              id: 'other',
              device: 'Factwright on Sam’s MacBook',
              asked: new Date().toISOString(),
              signedIn: new Date().toISOString(),
              elsewhere: false,
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    );
    const asking = screen.getByRole('region', { name: 'Approve Chrome on Windows?' });
    expect(within(asking).getByRole('alert').textContent).toContain('Another device asked');
    const link = within(asking).getByRole('button', { name: 'They match, link it' });
    expect((link as HTMLButtonElement).disabled).toBe(true);
    expect(within(asking).getByRole('button', { name: 'Turn down' })).toBeTruthy();
    expect(within(asking).queryByRole('button', { name: 'Approve…' })).toBeNull();
    await user.click(within(asking).getByRole('button', { name: 'They don’t match' }));
  });

  it('says when this computer signed in too long ago to ask, with a way to sign in again', async () => {
    const api = {
      ...apiFor('link', 'stale'),
      useDifferentSyncAccount: vi.fn(async () => ({ ok: true as const })),
    };
    const user = userEvent.setup();
    await openDialog(api);
    expect(await screen.findByText(/signed in a while ago/)).toBeTruthy();
    // The code is what's left, so it's open.
    expect(screen.getByRole('textbox', { name: 'Code from your other device' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(api.useDifferentSyncAccount).toHaveBeenCalledOnce();
  });

  it('says what to do when nothing shows on the other device for a while', async () => {
    const { later } = fakeTime();
    await openDialog(apiFor('link', 'quiet'));
    expect(await screen.findByText('Waiting for your other device…')).toBeTruthy();
    expect(screen.queryByText(/Nothing showing there/)).toBeNull();
    await later(30_000);
    expect(screen.getByText(/Nothing showing there\? Update Factwright/)).toBeTruthy();
  });

  it('asks on the Sync card to check the emoji, with the dialog closed', () => {
    render(
      <SyncCard
        status={{ state: 'setting-up', email: 'sam@example.com', firstDevice: false }}
        asking={{
          step: 'check',
          approver: 'Factwright on Sam’s Mac',
          check: [0, 1, 2, 3, 4, 5],
          confirmed: false,
        }}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Check the emoji')).toBeTruthy();
    expect(
      screen.getByText('Factwright on Sam’s Mac offered to approve this computer.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy();
  });

  it('says on the Sync card when a device wants to link', () => {
    render(
      <SyncCard
        status={ON}
        requests={[
          {
            id: 'r',
            device: 'Chrome on Windows',
            asked: new Date().toISOString(),
            signedIn: new Date().toISOString(),
            elsewhere: false,
          },
        ]}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('A device wants to link')).toBeTruthy();
    expect(screen.getByText('Chrome on Windows asked to sync your job hunt.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
  });
});
