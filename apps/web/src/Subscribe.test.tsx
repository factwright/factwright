import type { AccountInfo, SyncAccess } from '@factwright/sync';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetKeys } from './keys.ts';
import { Subscribe, Subscribed, timing } from './Subscribe.tsx';
import { browser } from './Subscription.tsx';
import { fakeServer, LEGAL } from './testing.ts';

// The test browser has no IndexedDB, and what's kept there is the page's own business.
vi.mock('./keys.ts', () => ({ forgetKeys: vi.fn(async () => {}) }));

const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_test_1';

/** Sam's account, with sync as given, on a server that sells it unless told it doesn't. */
const infoWith = (access: SyncAccess | undefined): AccountInfo => ({
  user: { id: 'sam', email: 'sam@example.com', name: 'Sam Rivera', since: '2026-10-01T00:00:00Z' },
  devices: [],
  usage: { bytes: 0, limit: 1024 ** 3, records: 0, files: 0 },
  ...(access && { access }),
});

const NONE: SyncAccess = { allowed: false, gift: null, subscription: null };
const ACTIVE: SyncAccess = {
  allowed: true,
  gift: null,
  subscription: { state: 'active', renewsAt: '2026-11-17T12:00:00.000Z' },
};
const ENDED: SyncAccess = {
  allowed: false,
  gift: null,
  subscription: { state: 'ended', renewsAt: '2026-10-30T12:00:00.000Z' },
};

const onSignedOut = vi.fn();

/** The subscribe page, for Sam, signed in here, on a server with Factwright's terms. */
const subscribePage = () => (
  <Subscribe account="sam" email="sam@example.com" legal={LEGAL} onSignedOut={onSignedOut} />
);

let went: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  history.replaceState(null, '', '/subscribe');
  went = vi.fn();
  vi.spyOn(browser, 'go').mockImplementation(went);
  onSignedOut.mockClear();
});

afterEach(() => {
  timing.wait = (ms) => new Promise((done) => setTimeout(done, ms));
});

describe('the subscribe page', () => {
  it('offers paying monthly or yearly, then goes to Stripe’s checkout for the one picked', async () => {
    const requests = fakeServer({
      'GET /api/account': () => infoWith(NONE),
      'POST /api/billing/checkout': () => ({ url: CHECKOUT }),
    });
    const { container } = render(subscribePage());
    expect(await screen.findByRole('heading', { name: 'Subscribe to sync' })).toBeTruthy();
    expect(screen.getByText('Signed in as sam@example.com.')).toBeTruthy();
    const monthly = screen.getByRole('radio', { name: '$5 a month' }) as HTMLInputElement;
    expect(monthly.checked).toBe(true);
    expect(screen.getByText('Saves $10 a year')).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);

    await userEvent.click(screen.getByRole('radio', { name: /\$50 a year/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(went).toHaveBeenCalledWith(CHECKOUT));
    expect(requests.at(-1)).toMatchObject({
      method: 'POST',
      path: '/api/billing/checkout',
      body: { period: 'year' },
    });
    expect(screen.getByRole('button', { name: 'Opening checkout…' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('says before checkout what’s paid, that it renews until canceled, and how to cancel', async () => {
    fakeServer({ 'GET /api/account': () => infoWith(NONE) });
    render(subscribePage());
    const terms = await screen.findByRole('link', { name: 'terms of service' });
    expect(terms.getAttribute('href')).toBe('https://factwright.com/terms#paying');
    expect(terms.parentElement?.textContent).toBe(
      'You pay $5 now, and it renews automatically at $5 a month until you cancel. Cancel anytime from your account page, and sync keeps going to the end of what you paid for. Prices are in US dollars, plus any sales tax or VAT where you live. Checkout may offer your own currency, at Stripe’s exchange rate, which includes a fee of a few percent. The terms of service say more.',
    );
    await userEvent.click(screen.getByRole('radio', { name: /\$50 a year/ }));
    expect(terms.parentElement?.textContent).toMatch(
      /^You pay \$50 now, and it renews automatically at \$50 a year until you cancel\. /,
    );
  });

  it('names no terms where the server has none', async () => {
    fakeServer({ 'GET /api/account': () => infoWith(NONE) });
    render(
      <Subscribe account="sam" email="sam@example.com" legal={null} onSignedOut={onSignedOut} />,
    );
    expect(await screen.findByText(/renews automatically at \$5 a month/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'terms of service' })).toBeNull();
  });

  it('keeps the money’s tight line and the way to run your own server', async () => {
    fakeServer({ 'GET /api/account': () => infoWith(NONE) });
    render(subscribePage());
    const ask = await screen.findByRole('link', { name: 'steve@factwright.com' });
    expect(ask.getAttribute('href')).toBe('mailto:steve@factwright.com');
    expect(screen.getByRole('link', { name: 'How to set one up' }).getAttribute('href')).toBe(
      'https://factwright.com/own-server',
    );
  });

  it('says subscribing again picks up where sync left off, once a subscription ended', async () => {
    fakeServer({ 'GET /api/account': () => infoWith(ENDED) });
    render(subscribePage());
    expect(await screen.findByRole('heading', { name: 'Subscribe to sync again' })).toBeTruthy();
    expect(screen.getByText(/picks up where it left off/)).toBeTruthy();
  });

  it.each([
    [ACTIVE, 'You’re subscribed', 'Go back to Factwright: it carries on by itself.'],
    [
      { allowed: true, gift: 'free', subscription: null },
      'You have free sync',
      'Steve turned on sync for you, for free. Go back to Factwright: it carries on by itself.',
    ],
    [
      { allowed: true, gift: 'early', subscription: null },
      'You have free sync',
      'Your account has sync for good, as one of the first. Go back to Factwright: it carries on by itself.',
    ],
    [
      undefined,
      'Sync is free here',
      'This server doesn’t charge for sync, so there’s nothing to pay. Go back to Factwright: it carries on by itself.',
    ],
  ] as [SyncAccess | undefined, string, string][])(
    'has nothing to pay when the account has sync already, or the server doesn’t sell it (%#)',
    async (access, title, lead) => {
      fakeServer({ 'GET /api/account': () => infoWith(access) });
      const { container } = render(subscribePage());
      expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
      expect(screen.getByText(lead)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Continue to payment' })).toBeNull();
      expect((await axe.run(container)).violations).toEqual([]);
    },
  );

  it('says when a checkout just started, or Factwright can’t be reached, and lets them try again', async () => {
    let answer: () => Response = () =>
      Response.json(
        {
          error: 'slow-down',
          message: 'A checkout just started. Wait a moment, then try again.',
        },
        { status: 429, headers: { 'retry-after': '10' } },
      );
    fakeServer({
      'GET /api/account': () => infoWith(NONE),
      'POST /api/billing/checkout': () => answer(),
    });
    render(subscribePage());
    await userEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A checkout just started. Wait a few seconds, then try again.',
    );
    answer = () => new Response('oops', { status: 500 });
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Stripe’s checkout couldn’t open. Try again in a moment.',
      ),
    );
    expect(went).not.toHaveBeenCalled();
  });

  it('shows the account has sync, once it came through since the page asked', async () => {
    let access = NONE;
    fakeServer({
      'GET /api/account': () => infoWith(access),
      'POST /api/billing/checkout': () => {
        access = ACTIVE;
        return Response.json(
          { error: 'has-sync', message: 'This account has sync already.' },
          { status: 409 },
        );
      },
    });
    render(subscribePage());
    await userEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByRole('heading', { name: 'You’re subscribed' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns before paying when this browser uses another account than the app', async () => {
    history.replaceState(null, '', '/subscribe?account=dana');
    const requests = fakeServer({
      'GET /api/account': () => infoWith(NONE),
      'POST /api/auth/sign-out': () => ({ success: true }),
    });
    vi.mocked(forgetKeys).mockClear();
    const { container } = render(subscribePage());
    expect(
      await screen.findByRole('heading', { name: 'This browser uses another account' }),
    ).toBeTruthy();
    expect(screen.getByText(/It’s signed in as sam@example\.com/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).toBeNull();
    expect((await axe.run(container)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out, then sign in again' }));
    await waitFor(() => expect(requests.at(-1)?.path).toBe('/api/auth/sign-out'));
    expect(forgetKeys).toHaveBeenCalledOnce();
  });

  it('goes on as usual when the app names this browser’s own account', async () => {
    history.replaceState(null, '', '/subscribe?account=sam');
    fakeServer({ 'GET /api/account': () => infoWith(NONE) });
    render(subscribePage());
    expect(await screen.findByRole('heading', { name: 'Subscribe to sync' })).toBeTruthy();
  });

  it('says when the account can’t be checked, with a way to try again', async () => {
    let up = false;
    fakeServer({
      'GET /api/account': () => (up ? infoWith(NONE) : new Response('busy', { status: 503 })),
    });
    render(subscribePage());
    expect(
      await screen.findByRole('heading', { name: 'Your account couldn’t be checked' }),
    ).toBeTruthy();
    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Subscribe to sync' })).toBeTruthy();
  });

  it('hands over when the server says this browser is signed out', async () => {
    fakeServer({
      'GET /api/account': () =>
        Response.json({ error: 'signed-out', message: 'Sign in again.' }, { status: 401 }),
    });
    render(subscribePage());
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });
});

describe('the page checkout comes back to', () => {
  /** A clock that moves only as the page waits between looks. */
  function clock() {
    let now = Date.parse('2026-10-17T12:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    timing.wait = async (ms) => {
      now += ms;
    };
  }

  it('checks the subscription came through, then says to go back to Factwright', async () => {
    clock();
    let looks = 0;
    fakeServer({
      // Stripe tells the server a moment after the checkout comes back.
      'GET /api/account': () => infoWith(++looks < 3 ? NONE : ACTIVE),
    });
    const { container } = render(<Subscribed onSignedOut={onSignedOut} />);
    expect(screen.getByRole('heading', { name: 'Finishing up…' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'You’re subscribed' })).toBeTruthy();
    expect(screen.getByText('Go back to Factwright: it’s finishing setting up sync.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'account page' }).getAttribute('href')).toBe(
      '/account',
    );
    expect(looks).toBe(3);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('says when Stripe is taking a while, with a way to check again', async () => {
    clock();
    let access = NONE;
    fakeServer({ 'GET /api/account': () => infoWith(access) });
    render(<Subscribed onSignedOut={onSignedOut} />);
    expect(await screen.findByRole('heading', { name: 'Almost there' })).toBeTruthy();
    expect(screen.getByText(/It can take a few minutes/)).toBeTruthy();
    access = ACTIVE;
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('heading', { name: 'You’re subscribed' })).toBeTruthy();
  });

  it('keeps looking while Factwright can’t be reached', async () => {
    clock();
    let looks = 0;
    fakeServer({
      'GET /api/account': () =>
        ++looks < 3 ? new Response('busy', { status: 503 }) : infoWith(ACTIVE),
    });
    render(<Subscribed onSignedOut={onSignedOut} />);
    expect(await screen.findByRole('heading', { name: 'You’re subscribed' })).toBeTruthy();
  });

  it('hands over when the server says this browser is signed out', async () => {
    clock();
    fakeServer({
      'GET /api/account': () =>
        Response.json({ error: 'signed-out', message: 'Sign in again.' }, { status: 401 }),
    });
    render(<Subscribed onSignedOut={onSignedOut} />);
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });
});
