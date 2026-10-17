import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { SignIn } from './SignIn.tsx';
import { fakeServer, LEGAL } from './testing.ts';

describe('signing in', () => {
  it('offers each way the server has set up', async () => {
    const { container } = render(
      <SignIn providers={['github', 'google']} legal={LEGAL} returnTo="/" />,
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Continue with GitHub',
      'Continue with Google',
    ]);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('says signing in agrees to the terms and privacy policy, with a link to each', () => {
    render(<SignIn providers={['github']} legal={LEGAL} returnTo="/" />);
    expect(screen.getByRole('link', { name: 'terms of service' }).getAttribute('href')).toBe(
      'https://factwright.com/terms',
    );
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe(
      'https://factwright.com/privacy',
    );
  });

  it('names no terms on a server of your own, which has none', () => {
    render(<SignIn providers={['github']} legal={null} returnTo="/" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/terms of service/)).toBeNull();
  });

  it('signs in, to come back to where the person was going', async () => {
    // GitHub's address stands in as this page's own, so the test browser stays put.
    const requests = fakeServer({
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
    });
    render(
      <SignIn
        providers={['github', 'google']}
        legal={LEGAL}
        returnTo="/device?user_code=WDJBMJHT"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));

    expect(requests[0]?.body).toEqual({
      provider: 'github',
      callbackURL: '/device?user_code=WDJBMJHT',
      errorCallbackURL: '/device?user_code=WDJBMJHT',
    });
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.map((button) => [button.textContent, button.disabled])).toEqual([
      ['Opening…', true],
      ['Continue with Google', true],
    ]);
  });

  it('says why when signing in can’t start, and lets the person try again', async () => {
    fakeServer({
      'POST /api/auth/sign-in/social': () =>
        Response.json({ message: 'Too many requests. Please try again later.' }, { status: 429 }),
    });
    render(<SignIn providers={['github']} legal={LEGAL} returnTo="/" />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That’s a lot of tries in a row. Wait a minute, then try again.',
    );
    const again = screen.getByRole('button', { name: 'Continue with GitHub' }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
  });

  it('says when Factwright can’t be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<SignIn providers={['github']} legal={LEGAL} returnTo="/" />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Can’t reach Factwright right now. Check your connection.',
    );
  });

  it('says why signing in from here didn’t work, until the person tries again', async () => {
    fakeServer({
      'POST /api/auth/sign-in/social': () => ({ url: location.href, redirect: true }),
    });
    const { container } = render(
      <SignIn
        providers={['github']}
        legal={LEGAL}
        returnTo="/"
        signInProblem="Signing in was canceled. Try again whenever you’re ready."
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'Signing in was canceled. Try again whenever you’re ready.',
    );
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when this server has no way to sign in yet', () => {
    render(<SignIn providers={[]} legal={LEGAL} returnTo="/" />);
    expect(screen.getByRole('alert').textContent).toBe(
      'Signing in isn’t set up on this server yet.',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
