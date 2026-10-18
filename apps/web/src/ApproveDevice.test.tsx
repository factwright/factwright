import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApproveDevice } from './ApproveDevice.tsx';
import { forgetKeys } from './keys.ts';
import { fakeServer, type SeenRequest } from './testing.ts';

// The test browser has no IndexedDB, and what's kept there is the page's own business.
vi.mock('./keys.ts', () => ({ forgetKeys: vi.fn(async () => {}) }));

/** A code the desktop app shows, as sign-in tells the account it's tied to. */
const pending = () => ({
  user_code: 'WDJBMJHT',
  status: 'pending',
  client_id: 'factwright-desktop',
});
const fromExtension = () => ({ ...pending(), client_id: 'factwright-extension' });

const EMAIL = 'sam@example.com';
const HERE = '/device?user_code=WDJBMJHT';
const TAKEN = 'That code was opened with another account. In Factwright, start signing in again.';

const sent = (requests: SeenRequest[]) => requests.map(({ method, path }) => `${method} ${path}`);

/** The line that says who's signed in here, as a whole. */
const accountLine = () => screen.getByText(EMAIL).closest('p')?.textContent;

beforeEach(() => {
  vi.mocked(forgetKeys).mockClear();
  history.replaceState(null, '', HERE);
});

describe('letting the desktop app sign in', () => {
  it('shows the code to compare and the account, then lets the app sign in', async () => {
    const requests = fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/approve': () => ({ success: true }),
    });
    const { container } = render(
      <ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github']} />,
    );
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
    expect(accountLine()).toBe(
      'Signed in as sam@example.com. Your computer signs in to this account. Use another account',
    );
    // The app shows a code only for the server its copy was built for. A server of your own could
    // pass along one of this server's, and send the browser here: the computer shows no code then.
    expect(
      screen.getByText(
        'Only allow it if you just started signing in from Factwright. It lets that computer sync your job hunt. If Factwright on your computer shows no code, don’t allow it.',
      ),
    ).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Your computer is signed in.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(sent(requests)).toEqual(['GET /api/auth/device', 'POST /api/auth/device/approve']);
    expect(requests[0]?.query.get('user_code')).toBe('WDJBMJHT');
    expect(requests[1]?.body).toEqual({ userCode: 'WDJBMJHT' });
  });

  it('turns the app away', async () => {
    const requests = fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/deny': () => ({ success: true }),
    });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Don’t allow' }));
    expect(await screen.findByText(/^Turned away\./)).toBeTruthy();
    expect(requests.at(-1)?.path).toBe('/api/auth/device/deny');
  });

  it('says when the code ran out, or never worked', async () => {
    fakeServer({
      'GET /api/auth/device': () =>
        Response.json(
          { error: 'expired_token', error_description: 'Code expired' },
          { status: 400 },
        ),
    });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code ran out. In Factwright, start signing in again.',
    );
  });

  it('says when a code is unknown', async () => {
    fakeServer({});
    render(<ApproveDevice userCode="NOTACODE" email={EMAIL} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code didn’t work. In Factwright, start signing in again.',
    );
  });

  it('shows a code that was already answered as it was left', async () => {
    fakeServer({ 'GET /api/auth/device': () => ({ ...pending(), status: 'approved' }) });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} />);
    expect(await screen.findByText('Your computer is signed in.')).toBeTruthy();
  });

  it('says when another account opened the code first, which only it can answer', async () => {
    // Sign-in says who asked only to the account the code is tied to.
    fakeServer({ 'GET /api/auth/device': () => ({ user_code: 'WDJBMJHT', status: 'pending' }) });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github']} />);
    expect((await screen.findByRole('alert')).textContent).toBe(TAKEN);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says so when an answer finds the code is another account’s', async () => {
    fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/approve': () =>
        Response.json(
          {
            error: 'access_denied',
            error_description: 'You are not authorized to approve this device authorization',
          },
          { status: 403 },
        ),
    });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github']} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect((await screen.findByRole('alert')).textContent).toBe(TAKEN);
  });

  it('asks for a sign-in here first, when this browser’s session can’t let a computer in', async () => {
    const requests = fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/approve': () =>
        Response.json(
          { error: 'refused', message: 'Approve a code from a browser.' },
          { status: 403 },
        ),
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
    });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github']} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByText(/sign in again here first/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    // GitHub brings the browser back to the same code, whether signing in works or not.
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: HERE,
      errorCallbackURL: HERE,
    });
  });

  it('asks for a sign-in here once this browser is signed out', async () => {
    fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/approve': () =>
        Response.json({ error: 'unauthorized' }, { status: 401 }),
    });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github']} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByText(/sign in again here first/)).toBeTruthy();
  });

  it('says why signing in again didn’t work, with the code still to answer', async () => {
    fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/approve': () => ({ success: true }),
    });
    render(
      <ApproveDevice
        userCode="WDJBMJHT"
        email={EMAIL}
        providers={['github']}
        signInProblem="Signing in was canceled. Try again whenever you’re ready."
      />,
    );
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Signing in was canceled. Try again whenever you’re ready.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Your computer is signed in.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when an answer didn’t go through', async () => {
    fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/approve': () => Response.json({}, { status: 500 }),
    });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That didn’t go through. In Factwright, start signing in again.',
    );
  });
});

describe('using another account', () => {
  it('signs out here, signs in with the other account, and comes back to the same code', async () => {
    const requests = fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
      'POST /api/account/device-codes/release': () => undefined,
      'POST /api/auth/sign-out': () => ({ success: true }),
    });
    const { container } = render(
      <ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github', 'google']} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Use another account' }));
    expect(
      screen.getByText(
        'Sign in with the account you want your computer to use. Then you’ll see this code again.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This signs sam@example.com out of this browser. To use another GitHub or Google account, switch to it there first.',
      ),
    ).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    // Nothing has changed yet.
    expect(sent(requests)).toEqual(['GET /api/auth/device']);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(requests.at(-1)?.path).toBe('/api/auth/sign-out'));
    // Signing in with Google starts first, so nothing changes if it can't. Then this account lets
    // go of the code, so the account signed in next can open it, and this browser signs out.
    expect(sent(requests)).toEqual([
      'GET /api/auth/device',
      'POST /api/auth/sign-in/social',
      'POST /api/account/device-codes/release',
      'POST /api/auth/sign-out',
    ]);
    // Google brings the browser back to the same code, whether signing in works or not.
    expect(requests[1]?.body).toEqual({
      provider: 'google',
      callbackURL: HERE,
      errorCallbackURL: HERE,
    });
    expect(requests[2]?.body).toEqual({ userCode: 'WDJBMJHT' });
    expect(forgetKeys).toHaveBeenCalledOnce();
  });

  it('goes back to the code with nothing changed', async () => {
    const requests = fakeServer({ 'GET /api/auth/device': pending });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github']} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Use another account' }));
    expect(
      screen.getByText(
        'This signs sam@example.com out of this browser. To use another GitHub account, switch to it there first.',
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('WDJB-MJHT')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
    expect(sent(requests)).toEqual(['GET /api/auth/device']);
  });

  it('stays signed in as it was when the other sign-in can’t start', async () => {
    const requests = fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/sign-in/social': () => Response.json({}, { status: 429 }),
    });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github']} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Use another account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That’s a lot of tries in a row. Wait a minute, then try again.',
    );
    expect(sent(requests)).toEqual(['GET /api/auth/device', 'POST /api/auth/sign-in/social']);
    expect(forgetKeys).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(accountLine()).toContain('Signed in as sam@example.com.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('isn’t offered where there’s no way to sign in', async () => {
    fakeServer({ 'GET /api/auth/device': pending });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} />);
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
    expect(accountLine()).toBe(
      'Signed in as sam@example.com. Your computer signs in to this account.',
    );
    expect(screen.queryByRole('button', { name: 'Use another account' })).toBeNull();
  });
});

describe('letting the browser extension sign in', () => {
  it('names Save to Factwright, its tab, and the account it needs, then lets it sign in', async () => {
    fakeServer({
      'GET /api/auth/device': fromExtension,
      'POST /api/auth/device/approve': () => ({ success: true }),
    });
    const { container } = render(
      <ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github']} />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Let Save to Factwright sign in?' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Check that the Set up Save to Factwright tab, the one you came from, shows this code:',
      ),
    ).toBeTruthy();
    // Its tab shows a code only for this server, so a code it doesn't show is someone else's.
    expect(
      screen.getByText(
        `Only allow it if you just started setting up Save to Factwright, the browser extension. It lets the extension save jobs to your job hunt from this browser. If that tab shows no code, or names a server other than ${location.host}, don’t allow it.`,
      ),
    ).toBeTruthy();
    expect(accountLine()).toBe(
      'Signed in as sam@example.com. Save to Factwright signs in to this account, so it needs to be the one Factwright on your computer uses. Use another account',
    );
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Save to Factwright is signed in.')).toBeTruthy();
    expect(
      screen.getByText(
        'Go back to the Set up Save to Factwright tab to link it with Factwright on your computer.',
      ),
    ).toBeTruthy();
  });

  it('signs in with the account Factwright on the computer uses, and comes back to the code', async () => {
    const requests = fakeServer({
      'GET /api/auth/device': fromExtension,
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
      'POST /api/account/device-codes/release': () => undefined,
      'POST /api/auth/sign-out': () => ({ success: true }),
    });
    render(<ApproveDevice userCode="WDJBMJHT" email={EMAIL} providers={['github']} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Use another account' }));
    expect(screen.getByRole('heading', { name: 'Let Save to Factwright sign in?' })).toBeTruthy();
    expect(
      screen.getByText(
        'Sign in with the account Factwright on your computer uses. Then you’ll see this code again.',
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(requests.at(-1)?.path).toBe('/api/auth/sign-out'));
    expect(requests.find(({ path }) => path === '/api/auth/sign-in/social')?.body).toEqual({
      provider: 'github',
      callbackURL: HERE,
      errorCallbackURL: HERE,
    });
    expect(requests.find(({ path }) => path.endsWith('/release'))?.body).toEqual({
      userCode: 'WDJBMJHT',
    });
  });
});
