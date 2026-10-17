/**
 * What to say when signing in didn't work, for the codes it comes back with, in our own words.
 * Undefined for a code it doesn't know.
 */
function words(code: string, origin: string): string | undefined {
  switch (code) {
    // A server of your own that lists who may sign in, and doesn't list this GitHub account. The
    // server gives the same words.
    case 'not_listed':
      return 'This Factwright server is private: only the GitHub accounts its owner lists can sign in. If it’s yours, add your GitHub user name to ALLOWED_GITHUB_USERS in its settings on Cloudflare.';
    // Cancel, at GitHub or Google.
    case 'access_denied':
      return 'Signing in was canceled. Try again whenever you’re ready.';
    // Sign-in's step ran out after 10 minutes, ended in another browser, or was used already.
    case 'state_mismatch':
    case 'state_not_found':
    case 'state_invalid':
      return 'That sign-in ran out, or finished in another browser. Try again in this one.';
    // GitHub or Google didn't take the server's word for who it is, such as with a wrong secret.
    case 'invalid_code':
      return 'Signing in couldn’t be finished. Try again in a moment. If this is your own server, check that its GitHub app’s Client ID and secret are the ones you gave Cloudflare.';
    // The GitHub app's callback URL isn't this server's.
    case 'redirect_uri_mismatch':
      return `This server’s GitHub app has a different Authorization callback URL. If the server is yours, set it to ${origin}/api/auth/callback/github in the app’s settings on GitHub.`;
    // The email already has an account, made with the other way to sign in.
    case 'account_not_linked':
      return 'That email already has an account here, made by signing in another way. Sign in that way instead.';
    case 'internal_server_error':
      return 'The server couldn’t finish signing you in. Try again in a moment.';
    default:
      return undefined;
  }
}

/** The most of a description the page shows. */
const DESCRIPTION_LIMIT = 300;

/**
 * Why signing in didn't work, from the address it came back to, or null when it says nothing.
 * Sign-in sends the browser back to the page that started it, with a code for what went wrong,
 * and sometimes a description: GitHub's or Google's, such as when someone cancels there, or the
 * server's, such as when a server of your own turns someone away. A code we know gets our own
 * words, whatever the description says. Any other gets the description, as it came.
 */
export function signInError(search: string, origin: string): string | null {
  const query = new URLSearchParams(search);
  const code = query.get('error');
  if (!code) return null;
  const known = words(code, origin);
  if (known) return known;
  const description = query.get('error_description')?.trim().slice(0, DESCRIPTION_LIMIT);
  return description
    ? `Signing in didn’t work: ${description}`
    : 'Signing in didn’t work. Try again in a moment.';
}

/**
 * Takes why signing in didn't work out of the address, so it isn't kept in the browser's history,
 * or sent along when signing in again. The rest stays, such as the code a computer showed.
 */
export function forgetSignInError(): void {
  const query = new URLSearchParams(location.search);
  if (!query.has('error') && !query.has('error_description')) return;
  query.delete('error');
  query.delete('error_description');
  const rest = query.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
}
