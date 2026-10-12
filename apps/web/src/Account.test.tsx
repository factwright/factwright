import { type AccountInfo, accountKeys, newAccountKey, sealFile, utf8 } from '@factwright/sync';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { Account } from './Account.tsx';
import { forgetKeys } from './keys.ts';
import { fakeServer, vaultOf } from './testing.ts';

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
  <Account email="sam@example.com" vault={null} keys={null} providers={['github']} />
);

describe('the account page', () => {
  it('lists the signed-in devices, and how much is stored', async () => {
    fakeServer({ 'GET /api/account': () => INFO });
    const { container } = render(page());
    expect(await screen.findByText('Factwright on Sam’s MacBook Pro')).toBeTruthy();
    expect(screen.getByText('This browser')).toBeTruthy();
    expect(screen.getByText('3.4 MB of 1 GB used, across 42 files.')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
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
    render(<Account email="sam@example.com" vault={vault} keys={keys} providers={['github']} />);
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
      'POST /api/auth/sign-in/social': () => ({ redirect: false }),
    });
    render(page());
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('To delete your account, sign in again first.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({ provider: 'github', callbackURL: '/account' });
  });
});
