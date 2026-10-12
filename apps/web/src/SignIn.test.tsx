import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { SignIn } from './SignIn.tsx';
import { fakeServer } from './testing.ts';

describe('signing in', () => {
  it('offers each way the server has set up', async () => {
    const { container } = render(<SignIn providers={['github', 'google']} returnTo="/" />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Continue with GitHub',
      'Continue with Google',
    ]);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('signs in, to come back to where the person was going', async () => {
    // No address to go to, so the page stays put for the test.
    const requests = fakeServer({ 'POST /api/auth/sign-in/social': () => ({ redirect: false }) });
    render(<SignIn providers={['github', 'google']} returnTo="/device?user_code=WDJBMJHT" />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));

    expect(requests[0]?.body).toEqual({
      provider: 'github',
      callbackURL: '/device?user_code=WDJBMJHT',
    });
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.map((button) => [button.textContent, button.disabled])).toEqual([
      ['Opening…', true],
      ['Continue with Google', true],
    ]);
  });

  it('says when this server has no way to sign in yet', () => {
    render(<SignIn providers={[]} returnTo="/" />);
    expect(screen.getByRole('alert').textContent).toBe(
      'Signing in isn’t set up on this server yet.',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
