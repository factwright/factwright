import { describe, expect, it } from 'vitest';
import { checkAuth } from './auth.ts';

// What Claude Code 2.1.296 prints when signed in, with made-up personal values.
const SIGNED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  analyticsDisabled: false,
  projectsDirectory: '/Users/someone/.claude/projects',
  configDirectory: '/Users/someone/.claude',
  email: 'someone@example.com',
  orgId: '00000000-0000-0000-0000-000000000000',
  orgName: "someone@example.com's Organization",
  subscriptionType: 'max',
});

describe('checkAuth', () => {
  it('reads a sign-in with a Claude plan', () => {
    expect(checkAuth(SIGNED_IN)).toEqual({
      status: 'signed-in',
      method: 'subscription',
      plan: 'max',
    });
  });

  it('never returns the email or organization', () => {
    const result = JSON.stringify(checkAuth(SIGNED_IN));
    expect(result).not.toMatch(/someone@example\.com|00000000|Organization/);
  });

  it('keeps any other method as Claude Code names it', () => {
    const output = JSON.stringify({ loggedIn: true, authMethod: 'api_key' });
    expect(checkAuth(output)).toEqual({ status: 'signed-in', method: 'api_key' });
  });

  it('reads a sign-in with no method or plan', () => {
    expect(checkAuth('{"loggedIn":true}')).toEqual({ status: 'signed-in' });
  });

  it('reads loggedIn false as signed out', () => {
    const output = JSON.stringify({
      loggedIn: false,
      authMethod: 'none',
      apiProvider: 'firstParty',
    });
    expect(checkAuth(output)).toEqual({ status: 'signed-out' });
  });

  it.each(['', 'Not logged in', '{"loggedIn":', 'null', '[]', '42', '{}', '{"loggedIn":"yes"}'])(
    'cannot read %j',
    (output) => {
      expect(checkAuth(output)).toEqual({ status: 'unreadable' });
    },
  );
});
