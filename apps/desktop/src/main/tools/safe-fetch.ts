import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { createGunzip, createInflate } from 'node:zlib';
import { isLinkedIn } from '@factwright/core';

/** The most a fetched page may weigh, unless the caller allows more, so a huge or endless answer can't fill memory. */
const MAX_BYTES = 5_000_000;
/** How long a fetch may take, redirects and all, unless the caller gives less time. */
const TIME_LIMIT_MS = 20_000;
const MAX_REDIRECTS = 5;

/** A fetch the app won't make, with the reason in plain words. */
export class FetchRefused extends Error {}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split('.').map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

/**
 * Whether an address is this computer, a private network, or otherwise not the public
 * internet. The tools never fetch those, so a job post can't steer them at the user's network.
 */
export function isPrivateAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const v4 = ipv4Parts(mapped ?? address);
  if (v4) {
    const [a = 0, b = 0] = v4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return (
    v6 === '::' ||
    v6 === '::1' ||
    /^f[cd]/.test(v6) ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith('ff') ||
    v6.startsWith('64:ff9b:')
  );
}

/** Looks up a site's addresses, and refuses the connection if any of them is private. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, found) => {
    if (error) {
      callback(error, '', 4);
      return;
    }
    const addresses = found as LookupAddress[];
    const first = addresses[0];
    if (!first || addresses.some(({ address }) => isPrivateAddress(address))) {
      callback(new FetchRefused('That site is on a private network, which is off limits.'), '', 4);
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
};

/** Why a link can't be fetched, or null when it can. The address itself is checked on connecting. */
export function linkProblem(url: URL): string | null {
  if (url.protocol !== 'https:') return 'Only https links work.';
  if (url.username || url.password) return 'Links with a sign-in in them are off limits.';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) return 'Links to a bare network address are off limits. Use the site’s name.';
  if (!host.includes('.') || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) {
    return 'Links to this computer or a home network are off limits.';
  }
  if (isLinkedIn(url.href)) {
    return 'Factwright never reads LinkedIn: its terms forbid software reading it. Find the job on the employer’s own site, use a posting the user saved from their browser, or ask the user to paste it.';
  }
  return null;
}

/**
 * The page as it came, unpacked from gzip or deflate, or null when it came in Brotli. The app
 * never asks for Brotli or unpacks it, so a page can't reach a flaw like the one Node.js's
 * Brotli decoder had (CVE-2026-111497), which let a page made for it run code.
 */
export function decoded(response: IncomingMessage): NodeJS.ReadableStream | null {
  const encoding = response.headers['content-encoding'] ?? '';
  if (/\bbr\b/i.test(encoding)) return null;
  switch (encoding) {
    case 'gzip':
      return response.pipe(createGunzip());
    case 'deflate':
      return response.pipe(createInflate());
    default:
      return response;
  }
}

/** One GET, without following redirects, given up at the deadline. */
function get(
  url: URL,
  json: boolean,
  deadline: number,
  maxBytes: number,
): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: 'GET',
        lookup: publicLookup,
        headers: {
          'user-agent': 'Mozilla/5.0 (Factwright; saves job postings for the user)',
          accept: json ? 'application/json' : 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-encoding': 'gzip, deflate',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          clearTimeout(timer);
          response.resume();
          resolve({ status, location: response.headers.location ?? '', body: '' });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = decoded(response);
        if (!stream) {
          fail(
            new FetchRefused(
              'That site sent the page compressed with Brotli, which the app never unpacks. Use a posting the user saved from their browser, or ask the user to paste it.',
            ),
          );
          return;
        }
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) fail(new FetchRefused('That page is too big.'));
          else chunks.push(chunk);
        });
        stream.on('end', () => {
          clearTimeout(timer);
          resolve({ status, body: Buffer.concat(chunks).toString('utf8') });
        });
        stream.on('error', fail);
        response.on('error', fail);
      },
    );
    const fail = (error: Error) => {
      clearTimeout(timer);
      outgoing.destroy();
      reject(error);
    };
    // A whole-request limit, so a site that answers a byte at a time can't hold the tool open.
    const timer = setTimeout(
      () => fail(new Error('the site took too long to answer')),
      Math.max(0, deadline - Date.now()),
    );
    outgoing.on('error', fail);
    outgoing.end();
  });
}

/**
 * Fetches a public https page or API, following up to five redirects and checking each one,
 * within a time and size limit, telling `onRedirect` each address a redirect sends it to before
 * it goes there. JSON answers come back parsed.
 */
export async function fetchPublic(
  address: string,
  json: boolean,
  limitMs = TIME_LIMIT_MS,
  maxBytes = MAX_BYTES,
  onRedirect?: (url: string) => void,
): Promise<unknown> {
  const deadline = Date.now() + Math.min(limitMs, TIME_LIMIT_MS);
  let url = new URL(address);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = linkProblem(url);
    if (problem) throw new FetchRefused(problem);
    if (hop > 0) onRedirect?.(url.href);
    const answer = await get(url, json, deadline, maxBytes);
    if (answer.location !== undefined) {
      if (!answer.location) throw new Error(`${url.hostname} sent a redirect without an address`);
      url = new URL(answer.location, url);
      continue;
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new Error(`${url.hostname} answered ${answer.status}`);
    }
    return json ? JSON.parse(answer.body) : answer.body;
  }
  throw new Error('the link redirected too many times');
}
