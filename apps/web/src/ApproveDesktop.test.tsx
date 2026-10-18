import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApproveDesktop, NOT_ASKED } from './ApproveDesktop.tsx';
import { forgetKeys } from './keys.ts';
import { leaveFor } from './route.ts';
import { fakeServer, type SeenRequest } from './testing.ts';

// The test browser has no IndexedDB, and what's kept there is the page's own business.
vi.mock('./keys.ts', () => ({ forgetKeys: vi.fn(async () => {}) }));
// Going back to the app's address on the computer is the browser's to do.
vi.mock('./route.ts', async (original) => ({
  ...(await original<typeof import('./route.ts')>()),
  leaveFor: vi.fn(),
}));

const EMAIL = 'sam@example.com';
const BACK = 'http://127.0.0.1:51004/signed-in';
const ASK = { redirect: BACK, challenge: 'c'.repeat(43), state: 's'.repeat(22) };
const HERE = '/sign-in/desktop?client_id=factwright-desktop&state=sssssssssssssssssssss';
const ANSWER = 'POST /api/auth/desktop/authorize';
const CODE = 'k'.repeat(43);

const sent = (requests: SeenRequest[]) => requests.map(({ method, path }) => `${method} ${path}`);

/** The line that says who's signed in here, as a whole. */
const accountLine = () => screen.getByText(EMAIL).closest('p')?.textContent;

beforeEach(() => {
  vi.mocked(forgetKeys).mockClear();
  vi.mocked(leaveFor).mockClear();
  history.replaceState(null, '', HERE);
});

describe('letting the desktop app sign in, back on its computer', () => {
  it('names the computer, this server and the account, with no code to compare, then lets it in', async () => {
    const requests = fakeServer({
      [ANSWER]: () => ({ url: `${BACK}?code=${CODE}&state=${ASK.state}` }),
    });
    const { container } = render(
      <ApproveDesktop ask={ASK} account="sam" email={EMAIL} providers={['github']} />,
    );
    expect(
      screen.getByRole('heading', { name: 'Let Factwright on your computer sign in?' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Factwright on your computer asks to sign in to ${location.host}, so it can sync your job hunt.`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Only allow it if you just started signing in from Factwright on this computer.',
      ),
    ).toBeTruthy();
    expect(accountLine()).toBe(
      'Signed in as sam@example.com. Your computer signs in to this account. Use another account',
    );
    expect(container.textContent).not.toMatch(/code/i);
    expect((await axe.run(container)).violations).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(leaveFor).toHaveBeenCalledOnce());
    expect(leaveFor).toHaveBeenCalledWith(`${BACK}?code=${CODE}&state=${ASK.state}`);
    expect(screen.getByRole('status').textContent).toBe('Going back to Factwright…');
    expect(screen.queryByRole('button')).toBeNull();
    expect(sent(requests)).toEqual([ANSWER]);
    expect(requests[0]?.body).toEqual({
      client_id: 'factwright-desktop',
      response_type: 'code',
      redirect_uri: BACK,
      code_challenge: ASK.challenge,
      code_challenge_method: 'S256',
      state: ASK.state,
      allow: true,
      account: 'sam',
    });
  });

  it('turns it away, which goes back to the app too, with no code', async () => {
    const requests = fakeServer({
      [ANSWER]: () => ({ url: `${BACK}?error=access_denied&state=${ASK.state}` }),
    });
    render(<ApproveDesktop ask={ASK} account="sam" email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Don’t allow' }));
    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith(`${BACK}?error=access_denied&state=${ASK.state}`),
    );
    expect(requests[0]?.body).toMatchObject({ allow: false });
  });

  it('goes nowhere but the app’s address it was asked for, with the answer where the app hears it', async () => {
    for (const url of [
      'https://evil.example/?code=planted',
      `http://127.0.0.1:51005/signed-in?code=${CODE}`,
      `${BACK}#code=${CODE}`,
    ]) {
      fakeServer({ [ANSWER]: () => ({ url }) });
      const { unmount } = render(<ApproveDesktop ask={ASK} account="sam" email={EMAIL} />);
      await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
      expect((await screen.findByRole('alert')).textContent, url).toBe(
        'That didn’t go through. In Factwright, start signing in again.',
      );
      unmount();
    }
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it('says it can’t go on when the app didn’t ask', () => {
    const requests = fakeServer({});
    render(<ApproveDesktop ask={null} account="sam" email={EMAIL} providers={['github']} />);
    expect(screen.getByRole('alert').textContent).toBe(NOT_ASKED);
    expect(screen.queryByRole('button')).toBeNull();
    expect(requests).toEqual([]);
  });

  it('asks for a sign-in here first once this browser is signed out, and comes back here', async () => {
    const requests = fakeServer({
      [ANSWER]: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
    });
    render(<ApproveDesktop ask={ASK} account="sam" email={EMAIL} providers={['github']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('To let it in, sign in again here first.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(requests.at(-1)?.path).toBe('/api/auth/sign-in/social'));
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: HERE,
      errorCallbackURL: HERE,
    });
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it('says so when this browser signed in to another account since the page opened', async () => {
    fakeServer({
      [ANSWER]: () => Response.json({ error: 'account_changed' }, { status: 409 }),
    });
    render(<ApproveDesktop ask={ASK} account="sam" email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This browser signed in to another account since this page opened. Reload the page to see which, then answer again.',
    );
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it('signs out here, signs in with another account, and comes back to this page', async () => {
    const requests = fakeServer({
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
      'POST /api/auth/sign-out': () => ({ success: true }),
    });
    const { container } = render(
      <ApproveDesktop ask={ASK} account="sam" email={EMAIL} providers={['github', 'google']} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use another account' }));
    expect(
      screen.getByText(
        'Sign in with the account you want your computer to use. Then you’ll come back here to allow it.',
      ),
    ).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(requests.at(-1)?.path).toBe('/api/auth/sign-out'));
    expect(sent(requests)).toEqual(['POST /api/auth/sign-in/social', 'POST /api/auth/sign-out']);
    expect(requests[0]?.body).toEqual({
      provider: 'google',
      callbackURL: HERE,
      errorCallbackURL: HERE,
    });
    expect(forgetKeys).toHaveBeenCalledOnce();
  });
});
