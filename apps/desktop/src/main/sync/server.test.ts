import { describe, expect, it } from 'vitest';
import { readServerAddress, readSignInOptions } from './server.ts';

const ALONE =
  'Type the address alone, with nothing after it, like https://factwright-sync.yourname.workers.dev.';

describe('a server of your own’s address', () => {
  it('is an https address, as an origin', () => {
    for (const [typed, server] of [
      ['https://factwright-sync.sam.workers.dev', 'https://factwright-sync.sam.workers.dev'],
      ['  https://factwright-sync.sam.workers.dev/  ', 'https://factwright-sync.sam.workers.dev'],
      ['https://Sync.Example.com:8443', 'https://sync.example.com:8443'],
      // Typed without https://, it's taken as one.
      ['factwright-sync.sam.workers.dev', 'https://factwright-sync.sam.workers.dev'],
    ]) {
      expect(readServerAddress(typed as string)).toEqual({ ok: true, server });
    }
  });

  it('may use http only on this computer, for testing', () => {
    expect(readServerAddress('http://localhost:8787')).toEqual({
      ok: true,
      server: 'http://localhost:8787',
    });
    expect(readServerAddress('http://127.0.0.1:8787/')).toEqual({
      ok: true,
      server: 'http://127.0.0.1:8787',
    });
    for (const typed of [
      'http://factwright-sync.sam.workers.dev',
      'http://192.168.1.20:8787',
      'http://[::1]:8787',
      'ftp://factwright-sync.sam.workers.dev',
      'file:///Users/sam/server',
    ]) {
      expect(readServerAddress(typed)).toEqual({
        ok: false,
        message: 'Use your server’s address that starts with https://.',
      });
    }
  });

  it('is the address alone, with no path, query, user name or password', () => {
    for (const typed of [
      'https://factwright-sync.sam.workers.dev/api',
      'https://factwright-sync.sam.workers.dev/?next=/account',
      'https://factwright-sync.sam.workers.dev/#link',
    ]) {
      expect(readServerAddress(typed)).toEqual({ ok: false, message: ALONE });
    }
    // Made as it runs, so the code holds no address with a password in it for scanners to flag.
    const withPassword = new URL('https://factwright-sync.sam.workers.dev');
    withPassword.username = 'sam';
    withPassword.password = 'not-a-real-password';
    for (const typed of [withPassword.href, 'https://sam@factwright-sync.sam.workers.dev']) {
      expect(readServerAddress(typed)).toEqual({
        ok: false,
        message: 'Leave out the user name and password: type the address alone.',
      });
    }
  });

  it('says what to type when it isn’t an address', () => {
    expect(readServerAddress('   ')).toEqual({ ok: false, message: 'Type your server’s address.' });
    for (const typed of [
      'https://',
      'not an address',
      'https://exa mple.com',
      'javascript:alert(1)',
    ]) {
      expect(readServerAddress(typed)).toEqual({
        ok: false,
        message:
          'That isn’t an address. It looks like https://factwright-sync.yourname.workers.dev.',
      });
    }
  });
});

describe('a server’s sign-in options', () => {
  it('are a Factwright sync server’s when they list its ways to sign in', () => {
    expect(
      readSignInOptions({
        providers: ['github', 7],
        features: ['approve', 'subscription', 'teleport'],
        legal: { terms: 'https://factwright.com/terms', privacy: 'https://factwright.com/privacy' },
      }),
    ).toEqual({
      providers: ['github'],
      features: ['approve', 'subscription'],
      legal: { terms: 'https://factwright.com/terms', privacy: 'https://factwright.com/privacy' },
    });
    // A server from before it listed features, or legal pages, lists none.
    expect(readSignInOptions({ providers: [] })).toEqual({
      providers: [],
      features: [],
      legal: null,
    });
  });

  it('keep only legal pages a link can safely open', () => {
    expect(
      readSignInOptions({
        providers: ['github'],
        legal: { terms: 'javascript:alert(1)', privacy: 'https://example.com/privacy' },
      })?.legal,
    ).toBeNull();
  });

  it('aren’t a Factwright sync server’s otherwise', () => {
    for (const answer of [null, 'ok', [], { features: ['approve'] }, { providers: 'github' }]) {
      expect(readSignInOptions(answer)).toBeNull();
    }
  });
});
