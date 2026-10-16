import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { ApproveDevice } from './ApproveDevice.tsx';
import { fakeServer } from './testing.ts';

const pending = () => ({ user_code: 'WDJBMJHT', status: 'pending' });

describe('letting the desktop app sign in', () => {
  it('shows the code to compare, then lets the app sign in', async () => {
    const requests = fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/approve': () => ({ success: true }),
    });
    const { container } = render(<ApproveDevice userCode="WDJBMJHT" />);
    expect(await screen.findByText('WDJB-MJHT')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Your computer is signed in.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/auth/device',
      'POST /api/auth/device/approve',
    ]);
    expect(requests[0]?.query.get('user_code')).toBe('WDJBMJHT');
    expect(requests[1]?.body).toEqual({ userCode: 'WDJBMJHT' });
  });

  it('turns the app away', async () => {
    const requests = fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/deny': () => ({ success: true }),
    });
    render(<ApproveDevice userCode="WDJBMJHT" />);
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
    render(<ApproveDevice userCode="WDJBMJHT" />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code ran out. In Factwright, start signing in again.',
    );
  });

  it('says when a code is unknown', async () => {
    fakeServer({});
    render(<ApproveDevice userCode="NOTACODE" />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code didn’t work. In Factwright, start signing in again.',
    );
  });

  it('shows a code that was already answered as it was left', async () => {
    fakeServer({ 'GET /api/auth/device': () => ({ user_code: 'WDJBMJHT', status: 'approved' }) });
    render(<ApproveDevice userCode="WDJBMJHT" />);
    expect(await screen.findByText('Your computer is signed in.')).toBeTruthy();
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
    history.replaceState(null, '', '/device?user_code=WDJBMJHT');
    render(<ApproveDevice userCode="WDJBMJHT" providers={['github']} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByText(/sign in again here first/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    // GitHub brings the browser back to the same code.
    expect(requests.at(-1)?.body).toEqual({
      provider: 'github',
      callbackURL: '/device?user_code=WDJBMJHT',
    });
  });

  it('says when an answer didn’t go through', async () => {
    fakeServer({
      'GET /api/auth/device': pending,
      'POST /api/auth/device/approve': () => Response.json({}, { status: 500 }),
    });
    render(<ApproveDevice userCode="WDJBMJHT" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That didn’t go through. In Factwright, start signing in again.',
    );
  });
});

describe('letting the browser extension sign in', () => {
  it('names Save to Factwright, then lets it sign in', async () => {
    fakeServer({
      'GET /api/auth/device': () => ({ ...pending(), client_id: 'factwright-extension' }),
      'POST /api/auth/device/approve': () => ({ success: true }),
    });
    const { container } = render(<ApproveDevice userCode="WDJBMJHT" />);
    expect(
      await screen.findByRole('heading', { name: 'Let Save to Factwright sign in?' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Check that Save to Factwright’s setup page shows this code:'),
    ).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Save to Factwright is signed in.')).toBeTruthy();
    expect(
      screen.getByText('Go back to its setup page to link it with Factwright on your computer.'),
    ).toBeTruthy();
  });
});
