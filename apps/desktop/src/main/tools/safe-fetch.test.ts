import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decoded, isPrivateAddress, linkProblem } from './safe-fetch.ts';

/** A site's answer, as the fetcher gets it. */
function answer(body: Buffer, encoding?: string): IncomingMessage {
  return Object.assign(Readable.from([body]), {
    headers: encoding ? { 'content-encoding': encoding } : {},
  }) as unknown as IncomingMessage;
}

async function text(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) throw new Error('The page was turned away');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

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

  it('never reads LinkedIn, whose terms forbid software reading it', () => {
    for (const address of [
      'https://www.linkedin.com/jobs/view/4012345678',
      'https://linkedin.com/company/acme',
      'https://de.linkedin.com/in/someone',
      'https://lnkd.in/abc123',
      'https://media.licdn.com/dms/image/x.png',
    ]) {
      expect(linkProblem(new URL(address))).toContain('never reads LinkedIn');
    }
    expect(linkProblem(new URL('https://notlinkedin.com/jobs'))).toBeNull();
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

describe('decoded', () => {
  const page = '<h1>Staff Engineer</h1><p>Remote, $180k–$210k</p>';

  it('unpacks gzip and deflate, and reads a page that came as it is', async () => {
    expect(await text(decoded(answer(gzipSync(page), 'gzip')))).toBe(page);
    expect(await text(decoded(answer(deflateSync(page), 'deflate')))).toBe(page);
    expect(await text(decoded(answer(Buffer.from(page))))).toBe(page);
  });

  it.each(['br', 'BR', 'gzip, br'])('never unpacks a page sent in Brotli (%s)', (encoding) => {
    expect(decoded(answer(brotliCompressSync(page), encoding))).toBeNull();
  });
});
