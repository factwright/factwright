import {
  type AccountInfo,
  accountKeys,
  newAccountKey,
  type SyncAccess,
  sealFile,
  utf8,
} from '@factwright/sync';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { Account } from './Account.tsx';
import { forgetKeys } from './keys.ts';
import { browser, dayOf } from './Subscription.tsx';
import { fakeServer, LEGAL, vaultOf } from './testing.ts';

// The test browser has no IndexedDB, and what's kept there is the page's own business.
vi.mock('./keys.ts', () => ({ forgetKeys: vi.fn(async () => {}) }));

const INFO: AccountInfo = {
  user: {
    id: 'sam',
    email: 'sam@example.com',
    name: 'Sam Rivera',
    since: '2026-10-01T12:00:00.000Z',
  },
  devices: [
    {
      id: 'mac',
      name: 'Factwright on Sam’s MacBook Pro',
      current: false,
      lastActive: '2026-10-10T17:00:00.000Z',
      since: '2026-10-01T12:00:00.000Z',
    },
    {
      id: 'phone',
      name: 'Safari on iPhone',
      current: true,
      lastActive: '2026-10-10T18:00:00.000Z',
      since: '2026-10-09T12:00:00.000Z',
    },
  ],
  usage: { bytes: 3_600_000, limit: 1024 ** 3, records: 120, files: 42 },
};

/** The page before the job hunt has loaded, which is all most of it needs. */
const page = () => (
  <Account email="sam@example.com" vault={null} keys={null} providers={['github']} legal={LEGAL} />
);

describe('the account page', () => {
  it('lists the signed-in devices, and how much is stored', async () => {
    fakeServer({ 'GET /api/account': () => INFO });
    const { container } = render(page());
    expect(await screen.findByText('Factwright on Sam’s MacBook Pro')).toBeTruthy();
    expect(screen.getByText('This browser')).toBeTruthy();
    expect(screen.getByText('3.4 MB of 1 GB used, across 42 files.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe(
      'https://factwright.com/privacy',
    );
    expect(screen.getByRole('link', { name: 'terms of service' }).getAttribute('href')).toBe(
      'https://factwright.com/terms',
    );
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('names no terms on a server of your own, which has none', async () => {
    fakeServer({ 'GET /api/account': () => INFO });
    render(
      <Account
        email="sam@example.com"
        vault={null}
        keys={null}
        providers={['github']}
        legal={null}
      />,
    );
    expect(await screen.findByText('3.4 MB of 1 GB used, across 42 files.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'terms of service' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'privacy policy' })).toBeNull();
  });

  it('signs another device out', async () => {
    const requests = fakeServer({
      'GET /api/account': () => INFO,
      'DELETE /api/account/devices/mac': () => undefined,
    });
    render(page());
    const mac = (await screen.findByText('Factwright on Sam’s MacBook Pro'))
      .parentElement as HTMLElement;
    await userEvent.click(within(mac).getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
        'GET /api/account',
        'DELETE /api/account/devices/mac',
        'GET /api/account',
      ]),
    );
  });

  it('downloads everything, opened, as one ZIP', async () => {
    const keys = await accountKeys(newAccountKey());
    const posting = await sealFile(keys, utf8('# Staff Engineer'));
    const missing = await sealFile(keys, utf8('Not on the server'));
    const vault = vaultOf([], {
      files: new Map([
        [
          'applications/acme/posting.md',
          { path: 'applications/acme/posting.md', id: posting.id, size: 16, modified: '' },
        ],
        ['facts/gone.md', { path: 'facts/gone.md', id: missing.id, size: 17, modified: '' }],
      ]),
      rows: { jobs: [{ id: 'acme--staff', company: 'Acme Robotics' }], status_log: [], calls: [] },
    });
    fakeServer({
      'GET /api/account': () => INFO,
      [`GET /api/sync/files/${posting.id}`]: () => new Response(posting.data),
    });
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:copy';
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <Account
        email="sam@example.com"
        vault={vault}
        keys={keys}
        providers={['github']}
        legal={LEGAL}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download a copy' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'One file couldn’t be opened, so it’s not in the copy.',
    );
    expect(click).toHaveBeenCalledOnce();
    const zip = unzipSync(new Uint8Array(await (blobs[0] as Blob).arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual([
      'README.txt',
      'tracker.json',
      'workspace/applications/acme/posting.md',
    ]);
    expect(strFromU8(zip['workspace/applications/acme/posting.md'] as Uint8Array)).toBe(
      '# Staff Engineer',
    );
    expect(JSON.parse(strFromU8(zip['tracker.json'] as Uint8Array))).toMatchObject({
      jobs: [{ id: 'acme--staff', company: 'Acme Robotics' }],
    });
  });

  it('deletes the account once the person is sure, and forgets its keys', async () => {
    const requests = fakeServer({
      'GET /api/account': () => INFO,
      'POST /api/auth/delete-user': () => ({ success: true, message: 'User deleted' }),
    });
    render(page());
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep my account' }));
    expect(requests.some(({ path }) => path === '/api/auth/delete-user')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(forgetKeys).toHaveBeenCalledOnce());
    expect(requests.at(-1)?.path).toBe('/api/auth/delete-user');
  });

  it('asks for a fresh sign-in before deleting, when it’s been a while', async () => {
    const requests = fakeServer({
      'GET /api/account': () => INFO,
      'POST /api/auth/delete-user': () =>
        Response.json(
          {
            code: 'SESSION_EXPIRED',
            message: 'Session expired. Re-authenticate to perform this action.',
          },
          { status: 400 },
        ),
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
    });
    render(page());
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('To delete your account, sign in again first.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/account',
      errorCallbackURL: '/account',
    });
  });

  it('says why that sign-in didn’t work, back on the page', async () => {
    fakeServer({ 'GET /api/account': () => INFO });
    render(
      <Account
        email="sam@example.com"
        vault={null}
        keys={null}
        providers={['github']}
        legal={LEGAL}
        signInProblem="Signing in was canceled. Try again whenever you’re ready."
      />,
    );
    expect(await screen.findByText('Factwright on Sam’s MacBook Pro')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Signing in was canceled. Try again whenever you’re ready.',
    );
  });
});

describe('the account page’s subscription, where sync is sold', () => {
  const RENEWS = '2026-11-17T12:00:00.000Z';
  const subscribed = (state: 'active' | 'ending' | 'retrying' | 'ended'): SyncAccess => ({
    allowed: state !== 'ended',
    gift: null,
    subscription: { state, renewsAt: RENEWS },
  });

  it.each([
    [subscribed('active'), `Subscribed. Renews ${dayOf(RENEWS)}.`, 'Manage subscription'],
    [
      subscribed('ending'),
      `Canceled. Sync keeps going until ${dayOf(RENEWS)}, then pauses.`,
      'Manage subscription',
    ],
    [
      subscribed('retrying'),
      'Your card didn’t go through. Update it to keep sync going.',
      'Update your card',
    ],
    [
      { allowed: true, gift: 'free', subscription: null },
      'Free sync, from Steve. Good luck with the search!',
      null,
    ],
    [
      { allowed: true, gift: 'early', subscription: null },
      'Free sync, for good. Thanks for being one of the first.',
      null,
    ],
  ] as [SyncAccess, string, string | null][])(
    'says how the account has sync, and manages a subscription at Stripe (%#)',
    async (access, line, button) => {
      const requests = fakeServer({
        'GET /api/account': () => ({ ...INFO, access }),
        'POST /api/billing/portal': () => ({ url: 'https://billing.stripe.com/p/session/test_1' }),
      });
      const went = vi.spyOn(browser, 'go').mockImplementation(() => {});
      const { container } = render(page());
      expect(await screen.findByRole('heading', { name: 'Your subscription' })).toBeTruthy();
      expect(screen.getByText(line)).toBeTruthy();
      expect((await axe.run(container)).violations).toEqual([]);
      if (!button) {
        expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
        return;
      }
      await userEvent.click(screen.getByRole('button', { name: button }));
      await waitFor(() =>
        expect(went).toHaveBeenCalledWith('https://billing.stripe.com/p/session/test_1'),
      );
      expect(requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/billing/portal' });
    },
  );

  it('offers subscribing to an account without sync, or again once it ended', async () => {
    for (const [access, line, button] of [
      [{ allowed: false, gift: null, subscription: null }, 'No subscription yet.', 'Subscribe'],
      [
        subscribed('ended'),
        'Your subscription ended, so sync is paused. The job hunt on your computers is safe.',
        'Subscribe again',
      ],
    ] as const) {
      history.replaceState(null, '', '/account');
      fakeServer({ 'GET /api/account': () => ({ ...INFO, access }) });
      const { unmount } = render(page());
      expect(await screen.findByText(line)).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: button }));
      expect(location.pathname).toBe('/subscribe');
      unmount();
    }
  });

  it('says a subscription renewed beside free sync can be canceled, as sync is free', async () => {
    fakeServer({
      'GET /api/account': () => ({
        ...INFO,
        access: {
          allowed: true,
          gift: 'free',
          subscription: { state: 'active', renewsAt: RENEWS },
        },
      }),
    });
    render(page());
    expect(
      await screen.findByText(
        `You also have a subscription, which renews ${dayOf(RENEWS)}. Sync is free for you, so you can cancel it.`,
      ),
    ).toBeTruthy();
  });

  it('says a free gift ends a subscription that was still running', async () => {
    fakeServer({
      'GET /api/account': () => ({
        ...INFO,
        access: {
          allowed: true,
          gift: 'free',
          subscription: { state: 'ending', renewsAt: RENEWS },
        },
      }),
    });
    render(page());
    expect(
      await screen.findByText(`Your subscription ends ${dayOf(RENEWS)}, and won’t renew.`),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy();
  });

  it('says why Stripe’s page couldn’t open', async () => {
    fakeServer({
      'GET /api/account': () => ({ ...INFO, access: subscribed('active') }),
      'POST /api/billing/portal': () =>
        Response.json(
          { error: 'not-found', message: 'This account has no subscription to manage.' },
          { status: 404 },
        ),
    });
    const went = vi.spyOn(browser, 'go').mockImplementation(() => {});
    render(page());
    await userEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'There’s no subscription to manage on this account.',
    );
    expect(went).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('has no subscription to show on a server that doesn’t sell sync', async () => {
    fakeServer({ 'GET /api/account': () => INFO });
    render(page());
    expect(await screen.findByText('3.4 MB of 1 GB used, across 42 files.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your subscription' })).toBeNull();
  });

  it('says deleting the account ends its subscription too', async () => {
    fakeServer({ 'GET /api/account': () => ({ ...INFO, access: subscribed('active') }) });
    render(page());
    await screen.findByRole('heading', { name: 'Your subscription' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    expect(
      screen.getByText(
        /Your subscription ends with it, straight away, and the time left on it isn’t refunded\./,
      ),
    ).toBeTruthy();
  });
});
