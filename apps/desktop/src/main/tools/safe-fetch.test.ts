import { describe, expect, it } from 'vitest';
import { isPrivateAddress, linkProblem } from './safe-fetch.ts';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:192.168.1.1',
    '64:ff9b::a00:1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '151.101.1.69', '2606:4700::6810:84e5', '::ffff:8.8.8.8'])(
    'treats %s as public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('linkProblem', () => {
  it('lets public https links through', () => {
    expect(linkProblem(new URL('https://jobs.ashbyhq.com/acme/1'))).toBeNull();
  });

  it.each([
    ['http://acme.example/jobs', 'Only https links'],
    ['https://192.168.1.1/admin', 'bare network address'],
    ['https://[::1]/', 'bare network address'],
    ['https://localhost/jobs', 'this computer'],
    ['https://printer.local/', 'this computer'],
    ['https://router.home.arpa/', 'this computer'],
    ['file:///etc/passwd', 'Only https links'],
  ])('refuses %s', (address, reason) => {
    expect(linkProblem(new URL(address))).toContain(reason);
  });

  it('refuses links with a sign-in in them', () => {
    // Built rather than written out, so the secret scan doesn't take it for a real one.
    const url = new URL('https://acme.example/jobs');
    url.username = 'someone';
    expect(linkProblem(url)).toContain('sign-in');
    url.password = 'made-up';
    expect(linkProblem(url)).toContain('sign-in');
  });
});
