import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApproveExtension, NOT_ASKED } from './ApproveExtension.tsx';
import { forgetKeys } from './keys.ts';
import { leaveFor } from './route.ts';
import { fakeServer, type SeenRequest } from './testing.ts';

// The test browser has no IndexedDB, and what's kept there is the page's own business.
vi.mock('./keys.ts', () => ({ forgetKeys: vi.fn(async () => {}) }));
// Leaving for the extension's return address is the browser's to do.
vi.mock('./route.ts', async (original) => ({
  ...(await original<typeof import('./route.ts')>()),
  leaveFor: vi.fn(),
}));

const EMAIL = 'sam@example.com';
const RETURN = 'https://gjhjddlohoonikgdbfcfnljeffilblai.chromiumapp.org/';
const ASK = { redirect: RETURN, challenge: 'c'.repeat(43), state: 's'.repeat(22) };
const HERE = '/sign-in/extension?client_id=factwright-extension&state=sssssssssssssssssssss';
const ANSWER = 'POST /api/auth/extension/authorize';

const sent = (requests: SeenRequest[]) => requests.map(({ method, path }) => `${method} ${path}`);

/** The line that says who's signed in here, as a whole. */
const accountLine = () => screen.getByText(EMAIL).closest('p')?.textContent;

beforeEach(() => {
  vi.mocked(forgetKeys).mockClear();
  vi.mocked(leaveFor).mockClear();
  history.replaceState(null, '', HERE);
});

describe('letting the extension sign in from the browser’s window', () => {
  it('names the extension and the account it needs, with no code to compare, then lets it in', async () => {
    const requests = fakeServer({
      [ANSWER]: () => ({ url: `${RETURN}#code=${'k'.repeat(43)}&state=${ASK.state}` }),
    });
    const { container } = render(
      <ApproveExtension ask={ASK} account="sam" email={EMAIL} providers={['github']} />,
    );
    expect(
      screen.getByRole('heading', { name: 'Let the Factwright extension sign in?' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'The Factwright extension asks to sign in to sync, so it can save jobs to your job hunt from this browser.',
      ),
    ).toBeTruthy();
    expect(accountLine()).toBe(
      'Signed in as sam@example.com. The extension signs in to this account, so it needs to be the one Factwright on your computer uses. Use another account',
    );
    expect(
      screen.getByText(
        'Only allow it if you just clicked Sign in to sync in the extension’s setup.',
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(/code/i);
    expect((await axe.run(container)).violations).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(leaveFor).toHaveBeenCalledOnce());
    expect(leaveFor).toHaveBeenCalledWith(`${RETURN}#code=${'k'.repeat(43)}&state=${ASK.state}`);
    expect(screen.getByRole('status').textContent).toBe('Going back to the extension…');
    expect(screen.queryByRole('button')).toBeNull();
    expect(sent(requests)).toEqual([ANSWER]);
    expect(requests[0]?.body).toEqual({
      client_id: 'factwright-extension',
      response_type: 'code',
      redirect_uri: RETURN,
      code_challenge: ASK.challenge,
      code_challenge_method: 'S256',
      state: ASK.state,
      allow: true,
      account: 'sam',
    });
  });

  it('turns it away, which goes back to the extension too, with no code', async () => {
    const requests = fakeServer({
      [ANSWER]: () => ({ url: `${RETURN}#error=access_denied&state=${ASK.state}` }),
    });
    render(<ApproveExtension ask={ASK} account="sam" email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Don’t allow' }));
    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith(`${RETURN}#error=access_denied&state=${ASK.state}`),
    );
    expect(requests[0]?.body).toMatchObject({ allow: false });
  });

  it('goes nowhere but the return address it was asked for', async () => {
    fakeServer({ [ANSWER]: () => ({ url: 'https://evil.example/#code=planted' }) });
    render(<ApproveExtension ask={ASK} account="sam" email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/^That didn’t go through\./);
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it('says it can’t go on when the extension didn’t ask, or can’t be answered here', () => {
    const requests = fakeServer({});
    render(<ApproveExtension ask={null} account="sam" email={EMAIL} providers={['github']} />);
    expect(screen.getByRole('alert').textContent).toBe(NOT_ASKED);
    expect(screen.queryByRole('button')).toBeNull();
    expect(requests).toEqual([]);
  });

  it('asks for a sign-in here first once this browser is signed out, and comes back here', async () => {
    const requests = fakeServer({
      [ANSWER]: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
    });
    render(<ApproveExtension ask={ASK} account="sam" email={EMAIL} providers={['github']} />);
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
      [ANSWER]: () =>
        Response.json(
          { error: 'account_changed', error_description: 'Another account now.' },
          { status: 409 },
        ),
    });
    render(<ApproveExtension ask={ASK} account="sam" email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This browser signed in to another account since this page opened. Reload the page to see which, then answer again.',
    );
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it('says when an answer didn’t go through', async () => {
    fakeServer({ [ANSWER]: () => Response.json({}, { status: 429 }) });
    render(<ApproveExtension ask={ASK} account="sam" email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That’s a lot of tries in a row. Wait a minute, then try again.',
    );
  });

  it('says why signing in again didn’t work, with the question still to answer', async () => {
    fakeServer({});
    render(
      <ApproveExtension
        ask={ASK}
        account="sam"
        email={EMAIL}
        providers={['github']}
        signInProblem="Signing in was canceled. Try again whenever you’re ready."
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'Signing in was canceled. Try again whenever you’re ready.',
    );
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
  });
});

describe('using another account, from the browser’s window', () => {
  it('signs out here, signs in with the other account, and comes back to this page', async () => {
    const requests = fakeServer({
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
      'POST /api/auth/sign-out': () => ({ success: true }),
    });
    const { container } = render(
      <ApproveExtension ask={ASK} account="sam" email={EMAIL} providers={['github', 'google']} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use another account' }));
    expect(
      screen.getByText(
        'Sign in with the account Factwright on your computer uses. Then you’ll come back here to allow it.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This signs sam@example.com out of this browser. To use another GitHub or Google account, switch to it there first.',
      ),
    ).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    expect(requests).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(requests.at(-1)?.path).toBe('/api/auth/sign-out'));
    // Signing in with Google starts first, so nothing changes if it can't.
    expect(sent(requests)).toEqual(['POST /api/auth/sign-in/social', 'POST /api/auth/sign-out']);
    expect(requests[0]?.body).toEqual({
      provider: 'google',
      callbackURL: HERE,
      errorCallbackURL: HERE,
    });
    expect(forgetKeys).toHaveBeenCalledOnce();
  });

  it('goes back to the question with nothing changed', async () => {
    const requests = fakeServer({});
    render(<ApproveExtension ask={ASK} account="sam" email={EMAIL} providers={['github']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use another account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it('isn’t offered where there’s no way to sign in', () => {
    fakeServer({});
    render(<ApproveExtension ask={ASK} account="sam" email={EMAIL} />);
    expect(screen.queryByRole('button', { name: 'Use another account' })).toBeNull();
  });
});
