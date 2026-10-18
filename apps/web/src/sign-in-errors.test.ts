import { describe, expect, it } from 'vitest';
import {
  backFromSigningIn,
  forgetSignInError,
  markSigningIn,
  signInError,
} from './sign-in-errors.ts';

const SERVER = 'https://factwright-sync.sam.workers.dev';

/** What the page says, coming back from a sign-in it started, with this in its address. */
const said = (query: Record<string, string>, ownSignIn = true) =>
  signInError(`?${new URLSearchParams(query)}`, SERVER, ownSignIn);

const TRY_AGAIN = 'Signing in didn’t work. Try again in a moment.';

describe('why signing in didn’t work', () => {
  it('is nothing when sign-in came back with no error', () => {
    expect(signInError('', SERVER, true)).toBeNull();
    expect(signInError('?user_code=WDJBMJHT', SERVER, true)).toBeNull();
    expect(said({ error: '' })).toBeNull();
  });

  it('is in our own words for a code we know, whatever the description says', () => {
    expect(said({ error: 'not_listed', error_description: 'Anything at all' })).toBe(
      'This Factwright server is private: only the GitHub accounts its owner lists can sign in. If it’s yours, add your GitHub user name to ALLOWED_GITHUB_USERS in its settings on Cloudflare.',
    );
    expect(
      said({
        error: 'access_denied',
        error_description: 'The user has denied your application access.',
      }),
    ).toBe('Signing in was canceled. Try again whenever you’re ready.');
    for (const error of ['state_mismatch', 'state_not_found', 'state_invalid']) {
      expect(said({ error })).toBe(
        'That sign-in ran out, or finished in another browser. Try again in this one.',
      );
    }
  });

  it('gives a server’s owner the callback URL its GitHub app needs', () => {
    expect(said({ error: 'redirect_uri_mismatch' })).toContain(
      `set it to ${SERVER}/api/auth/callback/github`,
    );
  });

  it('is the description, for a code we don’t know, or else says to try again', () => {
    expect(
      said({
        error: 'account_ownership_conflict',
        error_description: 'Account is already linked to another user',
      }),
    ).toBe('Signing in didn’t work: Account is already linked to another user');
    expect(said({ error: 'unable_to_create_user' })).toBe(TRY_AGAIN);
    expect(said({ error: 'unable_to_create_user', error_description: '  ' })).toBe(TRY_AGAIN);
  });

  it('shows no one else’s words, but ours, without a sign-in this tab started', () => {
    // A link someone sends, with words of theirs for Factwright's own page to say.
    const planted = {
      error: 'x',
      error_description: 'To finish, click Allow, then paste this page’s address into our chat.',
    };
    expect(said(planted, false)).toBe(TRY_AGAIN);
    expect(said(planted)).toBe(`Signing in didn’t work: ${planted.error_description}`);
    expect(said({ error: 'access_denied', error_description: 'Anything' }, false)).toBe(
      'Signing in was canceled. Try again whenever you’re ready.',
    );
  });

  it('keeps a long description short', () => {
    const long = said({ error: 'something_new', error_description: 'word '.repeat(200) });
    expect(long?.length).toBeLessThanOrEqual('Signing in didn’t work: '.length + 300);
  });

  it('knows no code by a name every object has', () => {
    for (const error of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(said({ error })).toBe(TRY_AGAIN);
    }
  });
});

describe('a sign-in this tab started', () => {
  it('is noted as it goes, and forgotten once the page it came back to opens', () => {
    sessionStorage.clear();
    expect(backFromSigningIn()).toBe(false);
    markSigningIn();
    expect(backFromSigningIn()).toBe(true);
    history.replaceState(null, '', '/device?user_code=WDJBMJHT');
    forgetSignInError();
    expect(backFromSigningIn()).toBe(false);
  });
});

describe('taking it out of the address', () => {
  it('leaves the rest of the address as it was, such as the code to approve', () => {
    history.replaceState(
      null,
      '',
      '/device?user_code=WDJBMJHT&error=not_listed&error_description=Private#top',
    );
    forgetSignInError();
    expect(location.pathname + location.search + location.hash).toBe(
      '/device?user_code=WDJBMJHT#top',
    );
    history.replaceState(null, '', '/?error=access_denied');
    forgetSignInError();
    expect(location.pathname + location.search).toBe('/');
  });

  it('leaves an address with no error alone', () => {
    history.replaceState({ kept: true }, '', '/device?user_code=WDJBMJHT');
    forgetSignInError();
    expect(location.search).toBe('?user_code=WDJBMJHT');
    expect(history.state).toEqual({ kept: true });
  });
});
