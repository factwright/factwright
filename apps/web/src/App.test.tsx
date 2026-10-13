import { accountKeys, newAccountKey, newLinkCode } from '@factwright/sync';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { forgetKeys, savedKeys } from './keys.ts';
import { fakeServer } from './testing.ts';

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

/** The server, with whoever's signed in, and an empty job hunt. */
function server(session: object | null) {
  return fakeServer({
    'GET /api/auth/get-session': () => session,
    'GET /api/sign-in-options': () => ({ providers: ['github'] }),
    'GET /api/sync/changes': () => ({ changes: [], cursor: 0, more: false }),
    'GET /api/auth/device': () => ({ user_code: 'WDJBMJHT', status: 'pending' }),
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

  it('forgets this browser’s keys once the server says it’s signed out', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(forgetKeys).mockClear();
    server(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your job hunt, anywhere' })).toBeTruthy();
    expect(forgetKeys).toHaveBeenCalledOnce();
  });

  it('keeps the keys when the server can’t say who’s signed in', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(forgetKeys).mockClear();
    fakeServer({
      'GET /api/auth/get-session': () => new Response('Busy', { status: 503 }),
      'GET /api/sign-in-options': () => ({ providers: ['github'] }),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your job hunt, anywhere' })).toBeTruthy();
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
    expect(requests.at(-1)?.body).toEqual({ provider: 'github', callbackURL: '/link' });
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

  it('opens the job hunt in a linked browser', async () => {
    history.replaceState(null, '', '/');
    vi.mocked(savedKeys).mockResolvedValue(await accountKeys(newAccountKey()));
    server(SESSION);
    render(<App />);
    expect(await screen.findByText('No jobs yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBe('page');
  });

  it('signs in to let the desktop app sign in, and comes back to the code', async () => {
    history.replaceState(null, '', '/device?user_code=WDJBMJHT');
    const requests = server(null);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in to Factwright' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/device?user_code=WDJBMJHT',
    });
  });

  it('asks a signed-in browser about the desktop app’s code, linked or not', async () => {
    history.replaceState(null, '', '/device?user_code=WDJBMJHT');
    server(SESSION);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Let your computer sign in?' })).toBeTruthy();
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
  });
});
