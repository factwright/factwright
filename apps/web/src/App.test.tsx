import { accountKeys, newAccountKey, newLinkCode } from '@factwright/sync';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { forgetKeys, savedKeys } from './keys.ts';
import { fakeServer, LEGAL } from './testing.ts';

// The test browser has no IndexedDB, and what's kept there is the page's own business.
vi.mock('./keys.ts', () => ({
  savedKeys: vi.fn(async () => null),
  saveKeys: vi.fn(async () => {}),
  forgetKeys: vi.fn(async () => {}),
}));

const SESSION = {
  session: { id: 's1' },
  user: { id: 'sam', email: 'sam@example.com', name: 'Sam' },
};

/** What signing in for a device's code says it's for: the desktop app, or the extension. */
const DESKTOP_LEAD = 'Sign in to let Factwright on your computer sync your job hunt.';
const EXTENSION_LEAD =
  'Sign in with the account Factwright on your computer uses. Then the extension can save jobs to your job hunt.';

/** The server, with whoever's signed in, and an empty job hunt. */
function server(session: object | null) {
  return fakeServer({
    'GET /api/auth/get-session': () => session,
    'GET /api/sign-in-options': () => ({ providers: ['github'] }),
    'GET /api/sync/changes': () => ({ changes: [], cursor: 0, more: false }),
    'GET /api/auth/device': () => ({
      user_code: 'WDJBMJHT',
      status: 'pending',
      client_id: 'factwright-desktop',
    }),
    'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
  });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(savedKeys).mockResolvedValue(null);
});

describe('the web view', () => {
  it('asks to sign in, to see the job hunt', async () => {
    history.replaceState(null, '', '/');
    server(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your job hunt, anywhere' })).toBeTruthy();
  });

  it('links to the terms and privacy policy the server names', async () => {
    history.replaceState(null, '', '/');
    fakeServer({
      'GET /api/auth/get-session': () => null,
      'GET /api/sign-in-options': () => ({ providers: ['github'], legal: LEGAL }),
    });
    render(<App />);
    const terms = await screen.findByRole('link', { name: 'terms of service' });
    expect(terms.getAttribute('href')).toBe(LEGAL.terms);
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe(
      LEGAL.privacy,
    );
  });

  it('names no terms when the server has none, or names pages that aren’t safe to link', async () => {
    const unsafe = { terms: 'javascript:alert(1)', privacy: 'https://example.com/privacy' };
    for (const legal of [undefined, unsafe]) {
      history.replaceState(null, '', '/');
      fakeServer({
        'GET /api/auth/get-session': () => null,
        'GET /api/sign-in-options': () => ({ providers: ['github'], legal }),
      });
      const { unmount } = render(<App />);
      expect(await screen.findByRole('heading', { name: 'Your job hunt, anywhere' })).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'terms of service' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'privacy policy' })).toBeNull();
      unmount();
    }
  });

  it('forgets this browser’s keys once the server says it’s signed out', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(forgetKeys).mockClear();
    server(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your job hunt, anywhere' })).toBeTruthy();
    expect(forgetKeys).toHaveBeenCalledOnce();
  });

  it('forgets what a page left open shows and keeps, once it’s signed out from elsewhere', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(forgetKeys).mockClear();
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    fakeServer({
      'GET /api/auth/get-session': () => SESSION,
      'GET /api/sign-in-options': () => ({ providers: ['github'] }),
      'GET /api/sync/changes': () =>
        Response.json({ error: 'signed-out', message: 'Sign in again.' }, { status: 401 }),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your job hunt, anywhere' })).toBeTruthy();
    expect(forgetKeys).toHaveBeenCalledOnce();
  });

  it('takes an address that names a company out of the history, once it matches no job', async () => {
    history.replaceState(null, '', '/jobs/acme--staff-engineer');
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    server(SESSION);
    render(<App />);
    expect(await screen.findByText('No jobs yet')).toBeTruthy();
    // The address changes just after the list first shows, once the job hunt is open.
    await waitFor(() => expect(location.pathname).toBe('/'));
  });

  it('says when Factwright can’t be reached, instead of waiting, with a way to try again', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(forgetKeys).mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Can’t reach Factwright right now' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(forgetKeys).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the keys when the server can’t say who’s signed in', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(forgetKeys).mockClear();
    fakeServer({
      'GET /api/auth/get-session': () => new Response('Busy', { status: 503 }),
      'GET /api/sign-in-options': () => ({ providers: ['github'] }),
    });
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Can’t reach Factwright right now' }),
    ).toBeTruthy();
    expect(forgetKeys).not.toHaveBeenCalled();
  });

  it('takes a QR code’s link code out of the address at once, and keeps it through signing in', async () => {
    const code = newLinkCode().text;
    history.replaceState(null, '', `/link#${code}`);
    const requests = server(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Link this phone' })).toBeTruthy();
    expect(location.hash).toBe('');
    expect(sessionStorage.getItem('factwright-link-code')).toBe(code);

    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/link',
      errorCallbackURL: '/link',
    });
  });

  it('once signed in, uses the code just once', async () => {
    sessionStorage.setItem('factwright-link-code', newLinkCode().text);
    history.replaceState(null, '', '/link');
    server(SESSION);
    render(<App />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(sessionStorage.getItem('factwright-link-code')).toBeNull();
  });

  it('asks a signed-in browser to link before it shows anything', async () => {
    history.replaceState(null, '', '/');
    server(SESSION);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Link this browser' })).toBeTruthy();
  });

  it('asks a computer to approve a browser that isn’t linked, when the server can', async () => {
    history.replaceState(null, '', '/');
    const requests = fakeServer({
      'GET /api/auth/get-session': () => SESSION,
      'GET /api/sign-in-options': () => ({ providers: ['github'], features: ['approve'] }),
      'POST /api/sync/requests': () => new Response(null, { status: 201 }),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Link this browser' })).toBeTruthy();
    await waitFor(() =>
      expect(requests.some((request) => request.path === '/api/sync/requests')).toBe(true),
    );
  });

  it('never asks from a browser that’s linked already, back on the link page', async () => {
    history.replaceState(null, '', '/link');
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    const requests = fakeServer({
      'GET /api/auth/get-session': () => SESSION,
      'GET /api/sign-in-options': () => ({ providers: ['github'], features: ['approve'] }),
      'GET /api/sync/changes': () => ({ changes: [], cursor: 0, more: false }),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Link this browser' })).toBeTruthy();
    expect(screen.queryByText('Waiting for your computer…')).toBeNull();
    expect(requests.some((request) => request.path.startsWith('/api/sync/requests'))).toBe(false);
  });

  it('opens the job hunt in a linked browser', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    server(SESSION);
    render(<App />);
    expect(await screen.findByText('No jobs yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBe('page');
  });

  it('signs in to let the desktop app sign in, and comes back to the code', async () => {
    history.replaceState(null, '', '/device?user_code=WDJBMJHT&for=desktop');
    const requests = server(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in to Factwright' })).toBeTruthy();
    expect(screen.getByText(DESKTOP_LEAD)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/device?user_code=WDJBMJHT&for=desktop',
      errorCallbackURL: '/device?user_code=WDJBMJHT&for=desktop',
    });
  });

  it('signs in to let the browser extension sign in, with the account the computer uses', async () => {
    history.replaceState(null, '', '/device?user_code=WDJBMJHT&for=extension');
    const requests = server(null);
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Sign in to set up the Factwright extension' }),
    ).toBeTruthy();
    expect(screen.getByText(EXTENSION_LEAD)).toBeTruthy();
    expect(screen.queryByText(DESKTOP_LEAD)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/device?user_code=WDJBMJHT&for=extension',
      errorCallbackURL: '/device?user_code=WDJBMJHT&for=extension',
    });
  });

  it('says it’s for the desktop app when the address doesn’t say who asked', async () => {
    // A code from before the server said, or an address someone changed.
    for (const search of [
      '?user_code=WDJBMJHT',
      '?user_code=WDJBMJHT&for=%3Cb%3Ephone%3C%2Fb%3E',
    ]) {
      history.replaceState(null, '', `/device${search}`);
      const requests = server(null);
      const { unmount } = render(<App />);
      expect(await screen.findByRole('heading', { name: 'Sign in to Factwright' })).toBeTruthy();
      expect(screen.getByText(DESKTOP_LEAD)).toBeTruthy();
      expect(screen.queryByText(/phone/)).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
      expect(requests.at(-1)?.body).toMatchObject({ callbackURL: `/device${search}` });
      unmount();
    }
  });

  it('asks about the code by what the server says asked, whatever the address says', async () => {
    history.replaceState(null, '', '/device?user_code=WDJBMJHT&for=extension');
    server(SESSION);
    render(<App />);
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Let your computer sign in?' })).toBeTruthy();
    expect(screen.getByText('Check that your computer shows this code:')).toBeTruthy();
  });

  it('asks a signed-in browser about the desktop app’s code, linked or not', async () => {
    history.replaceState(null, '', '/device?user_code=WDJBMJHT');
    server(SESSION);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Let your computer sign in?' })).toBeTruthy();
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
  });

  it('says who’s signed in with the code, and asks the account signed in next about the same one', async () => {
    history.replaceState(null, '', '/device?user_code=WDJBMJHT');
    vi.mocked(forgetKeys).mockClear();
    const requests = server(SESSION);
    const { unmount } = render(<App />);
    expect((await screen.findByText('sam@example.com')).closest('p')?.textContent).toMatch(
      /^Signed in as sam@example\.com\. /,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use another account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(requests.at(-1)?.path).toBe('/api/auth/sign-out'));
    expect(requests.find(({ path }) => path === '/api/auth/sign-in/social')?.body).toEqual({
      provider: 'github',
      callbackURL: '/device?user_code=WDJBMJHT',
      errorCallbackURL: '/device?user_code=WDJBMJHT',
    });
    expect(requests.find(({ path }) => path.endsWith('/release'))?.body).toEqual({
      userCode: 'WDJBMJHT',
    });
    expect(forgetKeys).toHaveBeenCalled();
    unmount();

    // GitHub brings the browser back to the same code, signed in to the other account.
    server({ ...SESSION, user: { id: 'alex', email: 'alex@example.com', name: 'Alex' } });
    render(<App />);
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
    expect(screen.getByText('alex@example.com')).toBeTruthy();
    expect(screen.queryByText('sam@example.com')).toBeNull();
  });
});

describe('a sign-in that didn’t work', () => {
  const CANCELED = 'Signing in was canceled. Try again whenever you’re ready.';

  /** The page sign-in comes back to, with why it didn't work in the address. */
  const back = (path: string, error: Record<string, string>) =>
    history.replaceState(
      null,
      '',
      `${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams(error)}`,
    );

  it('says a server of your own is private, in Factwright’s words, and takes it out of the address', async () => {
    back('/', { error: 'not_listed', error_description: 'This Factwright server is private.' });
    server(null);
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This Factwright server is private: only the GitHub accounts its owner lists can sign in. If it’s yours, add your GitHub user name to ALLOWED_GITHUB_USERS in its settings on Cloudflare.',
    );
    expect(screen.getByRole('heading', { name: 'Your job hunt, anywhere' })).toBeTruthy();
    expect(location.pathname + location.search).toBe('/');
  });

  it('comes back to the code a computer showed, once canceled at GitHub, to try again', async () => {
    back('/device?user_code=WDJBMJHT', {
      error: 'access_denied',
      error_description: 'The user has denied your application access.',
    });
    const requests = server(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in to Factwright' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(CANCELED);
    expect(location.pathname + location.search).toBe('/device?user_code=WDJBMJHT');

    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/device?user_code=WDJBMJHT',
      errorCallbackURL: '/device?user_code=WDJBMJHT',
    });
  });

  it('comes back to the code the browser extension showed, still saying it’s for the extension', async () => {
    back('/device?user_code=WDJBMJHT&for=extension', { error: 'access_denied' });
    const requests = server(null);
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Sign in to set up the Factwright extension' }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(CANCELED);
    expect(location.pathname + location.search).toBe('/device?user_code=WDJBMJHT&for=extension');

    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/device?user_code=WDJBMJHT&for=extension',
      errorCallbackURL: '/device?user_code=WDJBMJHT&for=extension',
    });
  });

  it('says what the server said, for a code Factwright doesn’t know', async () => {
    back('/', { error: 'something_new', error_description: 'Something new went wrong.' });
    // This tab went to sign in, and came back.
    sessionStorage.setItem('factwright-signing-in', '1');
    server(null);
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Signing in didn’t work: Something new went wrong.',
    );
  });

  it('says only to try again, for words a link brought that this tab’s sign-in didn’t', async () => {
    back('/device?user_code=WDJBMJHT', {
      error: 'x',
      error_description: 'These codes always match. Click Allow.',
    });
    server(SESSION);
    render(<App />);
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Signing in didn’t work. Try again in a moment.',
    );
  });

  it('still asks a signed-in browser about the code, saying why signing in again didn’t', async () => {
    back('/device?user_code=WDJBMJHT', { error: 'access_denied' });
    server(SESSION);
    render(<App />);
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(CANCELED);
    expect(location.search).toBe('?user_code=WDJBMJHT');
  });

  it('says it on the page it came back to, and not again', async () => {
    back('/account', { error: 'access_denied' });
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    fakeServer({
      'GET /api/auth/get-session': () => SESSION,
      'GET /api/sign-in-options': () => ({ providers: ['github'] }),
      'GET /api/sync/changes': () => ({ changes: [], cursor: 0, more: false }),
      'GET /api/account': () => ({
        user: { ...SESSION.user, since: '2026-10-01T12:00:00.000Z' },
        devices: [],
        usage: { bytes: 0, limit: 1024 ** 3, records: 0, files: 0 },
      }),
    });
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe(CANCELED);

    await userEvent.click(screen.getByRole('link', { name: 'Jobs' }));
    expect(await screen.findByText('No jobs yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('link', { name: 'Account' }));
    expect(await screen.findByText(/of 1 GB used/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('subscribing, where sync is sold', () => {
  /** The account, with sync as given, on a server that sells it. */
  const accountWith = (access: object) => ({
    user: { id: 'sam', email: 'sam@example.com', name: 'Sam', since: '2026-10-01T00:00:00Z' },
    devices: [],
    usage: { bytes: 0, limit: 1024 ** 3, records: 0, files: 0 },
    access,
  });
  const PAUSED = {
    allowed: false,
    gift: null,
    subscription: { state: 'ended', renewsAt: '2026-10-30T12:00:00.000Z' },
  };

  /** A server that sells sync, with Sam signed in and the job hunt last changed on Oct 30. */
  function selling(access: object, session: object | null = SESSION) {
    return fakeServer({
      'GET /api/auth/get-session': () => session,
      'GET /api/sign-in-options': () => ({
        providers: ['github'],
        features: ['approve', 'subscription'],
      }),
      'GET /api/account': () => accountWith(access),
      // A change the job list has no use for, so the job hunt opens empty, as of its time.
      'GET /api/sync/changes': () => ({
        changes: [
          {
            record: 'A'.repeat(43),
            version: 2,
            seq: 1,
            data: 'gone',
            file: null,
            deleted: true,
            at: '2026-10-30T15:00:00.000Z',
          },
        ],
        cursor: 1,
        more: false,
      }),
      'POST /api/sync/requests': () => new Response(null, { status: 201 }),
    });
  }

  it('signs in to subscribe, coming back with the account the app named', async () => {
    history.replaceState(null, '', '/subscribe?account=sam');
    const requests = selling(PAUSED, null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Subscribe to sync' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/subscribe?account=sam',
      errorCallbackURL: '/subscribe?account=sam',
    });
  });

  it('says to go back to Factwright after paying, even signed out here', async () => {
    history.replaceState(null, '', '/subscribe/done');
    selling(PAUSED, null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Thanks for subscribing' })).toBeTruthy();
    expect(
      screen.getByText(/Go back to Factwright: it’s finishing setting up sync\./),
    ).toBeTruthy();
  });

  it('subscribes from a browser that isn’t linked, as the app’s browser usually isn’t', async () => {
    history.replaceState(null, '', '/subscribe');
    selling({ allowed: false, gift: null, subscription: null });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Subscribe to sync' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Link this browser' })).toBeNull();
  });

  it('says sync is paused on the jobs page, and how up to date the job hunt is', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    selling(PAUSED);
    render(<App />);
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('Sync is paused');
    const day = new Date('2026-10-30T15:00:00.000Z').toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
    });
    expect(note.textContent).toContain(`What’s here is from ${day}.`);
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe again' }));
    expect(location.pathname).toBe('/subscribe');
  });

  it('says on the jobs page when a payment didn’t go through', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    selling({
      allowed: true,
      gift: null,
      subscription: { state: 'retrying', renewsAt: '2026-10-30T12:00:00.000Z' },
    });
    render(<App />);
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('Your card didn’t go through');
    expect(screen.getByRole('button', { name: 'Update your card' })).toBeTruthy();
  });

  it('shows no note while the account syncs as usual', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    const requests = selling({
      allowed: true,
      gift: null,
      subscription: { state: 'active', renewsAt: '2026-11-30T12:00:00.000Z' },
    });
    render(<App />);
    expect(await screen.findByText('No jobs yet')).toBeTruthy();
    await waitFor(() =>
      expect(requests.some((request) => request.path === '/api/account')).toBe(true),
    );
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('says a browser can’t link while sync is paused, with a way to subscribe again', async () => {
    history.replaceState(null, '', '/');
    const requests = selling(PAUSED);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sync is paused' })).toBeTruthy();
    // It never asks a computer to approve it, which the server would turn down.
    expect(requests.some((request) => request.path === '/api/sync/requests')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe again' }));
    expect(location.pathname).toBe('/subscribe');
  });

  it('asks a new account to subscribe, rather than saying a subscription ended', async () => {
    history.replaceState(null, '', '/');
    selling({ allowed: false, gift: null, subscription: null });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sync needs a subscription' })).toBeTruthy();
    expect(screen.queryByText(/ended/)).toBeNull();
  });

  it('says subscribe, not subscribe again, on the jobs page once free sync ended', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    selling({ allowed: false, gift: null, subscription: null });
    render(<App />);
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('Subscribe, and it catches up.');
    expect(within(note).getByRole('button', { name: 'Subscribe' })).toBeTruthy();
  });

  it('comes back to the account page after signing in there, as the app opens it', async () => {
    history.replaceState(null, '', '/account');
    const requests = selling(PAUSED, null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/account',
      errorCallbackURL: '/account',
    });
  });

  it('asks nothing about sync of a server that doesn’t sell it', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    const requests = server(SESSION);
    render(<App />);
    expect(await screen.findByText('No jobs yet')).toBeTruthy();
    expect(requests.some((request) => request.path === '/api/account')).toBe(false);
  });
});

describe('the extension’s sign-in, in the browser’s window', () => {
  const RETURN = 'https://gjhjddlohoonikgdbfcfnljeffilblai.chromiumapp.org/';
  /** The page's address, as the extension makes it, for a return address. */
  const asking = (redirect = RETURN) =>
    `/sign-in/extension?${new URLSearchParams({
      client_id: 'factwright-extension',
      response_type: 'code',
      redirect_uri: redirect,
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      state: 's'.repeat(22),
    })}`;
  const NOT_ASKED =
    'This isn’t a sign-in the Factwright extension can finish here. Close this window, and sign in again from the extension’s setup.';

  /** The server, with whoever's signed in, knowing the stores' Chrome copy alone. */
  const serving = (session: object | null) =>
    fakeServer({
      'GET /api/auth/get-session': () => session,
      'GET /api/sign-in-options': () => ({ providers: ['github'], extensionRedirects: [RETURN] }),
      'GET /api/sync/changes': () => ({ changes: [], cursor: 0, more: false }),
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
    });

  it('signs in there first, and comes back to what the extension asked', async () => {
    history.replaceState(null, '', asking());
    const requests = serving(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in to Factwright' })).toBeTruthy();
    expect(
      screen.getByText(
        'Sign in with the account Factwright on your computer uses, to let the Factwright extension save jobs to it.',
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: asking(),
      errorCallbackURL: asking(),
    });
  });

  it('asks a signed-in browser, with nothing to wander off to', async () => {
    history.replaceState(null, '', asking());
    serving(SESSION);
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Let the Factwright extension sign in?' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Jobs' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
  });

  it('won’t go on for a return address the server doesn’t know, signed in or not', async () => {
    for (const session of [null, SESSION]) {
      history.replaceState(
        null,
        '',
        asking('https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.chromiumapp.org/'),
      );
      serving(session);
      const { unmount } = render(<App />);
      expect((await screen.findByRole('alert')).textContent).toBe(NOT_ASKED);
      expect(screen.queryByRole('button')).toBeNull();
      unmount();
    }
  });

  it('comes back to what the extension asked, once canceled at GitHub, to try again', async () => {
    history.replaceState(null, '', `${asking()}&error=access_denied`);
    serving(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in to Factwright' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Signing in was canceled. Try again whenever you’re ready.',
    );
    expect(location.pathname + location.search).toBe(asking());
  });
});

describe('the desktop app’s sign-in to a server of your own, back on its computer', () => {
  const BACK = 'http://127.0.0.1:51004/signed-in';
  /** The page's address, as the desktop app makes it, for an address on the computer. */
  const asking = (redirect = BACK) =>
    `/sign-in/desktop?${new URLSearchParams({
      client_id: 'factwright-desktop',
      response_type: 'code',
      redirect_uri: redirect,
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      state: 's'.repeat(22),
    })}`;
  const NOT_ASKED =
    'This isn’t a sign-in Factwright on your computer can finish here. In Factwright, start signing in again.';

  it('signs in there first, and comes back to what the app asked', async () => {
    history.replaceState(null, '', asking());
    const requests = server(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in to Factwright' })).toBeTruthy();
    expect(screen.getByText(DESKTOP_LEAD)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: asking(),
      errorCallbackURL: asking(),
    });
  });

  it('asks a signed-in browser, linked or not, with nothing to wander off to', async () => {
    history.replaceState(null, '', asking());
    server(SESSION);
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Let Factwright on your computer sign in?' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Jobs' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
  });

  it('won’t go on for an address that isn’t the app’s on the computer, signed in or not', async () => {
    for (const session of [null, SESSION]) {
      for (const redirect of [
        'https://sync.evil.example/signed-in',
        'http://localhost:51004/signed-in',
      ]) {
        history.replaceState(null, '', asking(redirect));
        server(session);
        const { unmount } = render(<App />);
        expect((await screen.findByRole('alert')).textContent).toBe(NOT_ASKED);
        expect(screen.queryByRole('button')).toBeNull();
        unmount();
      }
    }
  });

  it('comes back to what the app asked, once canceled at GitHub, to try again', async () => {
    history.replaceState(null, '', `${asking()}&error=access_denied`);
    server(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in to Factwright' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Signing in was canceled. Try again whenever you’re ready.',
    );
    expect(location.pathname + location.search).toBe(asking());
  });
});
