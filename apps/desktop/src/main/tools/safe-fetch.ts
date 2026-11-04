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
/** The most a POST may send: a job's title, and which page of the answers. */
const MAX_POST_BYTES = 1_000;
/** A company's own site on Workday, and where on it the site's own job search answers. */
const WORKDAY_SITE = /^[a-z0-9-]{1,63}\.wd\d{1,3}\.myworkdayjobs\.com$/;
const WORKDAY_SEARCH = /^\/wday\/cxs\/[a-z0-9-]{1,63}\/[\w-]{1,100}\/jobs$/;

/**
 * What a fetch was refused for: a site the app never reads (LinkedIn's, or another barred one),
 * the link itself, a site on a private network, an answer in Brotli or bigger than the app
 * reads, or a POST it never sends.
 */
export type Refusal =
  | 'linkedin'
  | 'barred'
  | 'link'
  | 'network'
  | 'brotli'
  | 'too-big'
  | 'file'
  | 'post';

/** A fetch the app won't make, with the reason in plain words. */
export class FetchRefused extends Error {
  readonly why: Refusal;
  /** A barred site's name, such as Indeed, or null. */
  readonly site: string | null;

  constructor(message: string, why: Refusal = 'link', site: string | null = null) {
    super(message);
    this.why = why;
    this.site = site;
  }
}

/** An answer bigger than the app reads, which it stopped reading. */
export class FetchTooBig extends FetchRefused {
  constructor() {
    super('That page is too big.', 'too-big');
  }
}

/** A site's answer that wasn't a page, such as a 404, with its status. */
export class FetchAnswered extends Error {
  readonly status: number;

  constructor(host: string, status: number) {
    super(`${host} answered ${status}`);
    this.status = status;
  }
}

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
      callback(
        new FetchRefused('That site is on a private network, which is off limits.', 'network'),
        '',
        4,
      );
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
};

/**
 * Sites whose terms forbid software reading them, or that turn it away, by their hosts. Search
 * results can still name their jobs, and the user can save a posting from their own browser.
 */
const OFF_LIMITS: readonly (readonly [RegExp, string])[] = [
  [/(^|\.)indeed\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/, 'Indeed'],
  [/(^|\.)governmentjobs\.com$/, 'GovernmentJobs'],
  [/^jobs\.chronicle\.com$/, 'The Chronicle’s job site'],
];

/** Why a link can't be fetched, or null when it can. The address itself is checked on connecting. */
export function linkProblem(url: URL): string | null {
  return linkRefusal(url)?.message ?? null;
}

/** The refusal a link gets before anything is fetched, or null for one that can be. */
export function linkRefusal(url: URL): FetchRefused | null {
  const refused = (message: string) => new FetchRefused(message);
  if (url.protocol !== 'https:') return refused('Only https links work.');
  if (url.username || url.password) return refused('Links with a sign-in in them are off limits.');
  const name = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // A name can end in a dot and mean the same site, so "indeed.com." is still Indeed.
  const host = name.endsWith('.') ? name.slice(0, -1) : name;
  if (isIP(host)) {
    return refused('Links to a bare network address are off limits. Use the site’s name.');
  }
  if (!host.includes('.') || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) {
    return refused('Links to this computer or a home network are off limits.');
  }
  if (isLinkedIn(url.href)) {
    return new FetchRefused(
      'Factwright never reads LinkedIn: its terms forbid software reading it. Find the job on the employer’s own site, use a posting the user saved from their browser, or ask the user to paste it.',
      'linkedin',
      'LinkedIn',
    );
  }
  const barred = OFF_LIMITS.find(([site]) => site.test(host))?.[1];
  if (barred) {
    return new FetchRefused(
      `Factwright doesn’t read ${barred}: it turns software away, or its terms forbid it. Find the job on the employer’s own site, use a posting the user saved from their browser, or ask the user to paste it.`,
      'barred',
      barred,
    );
  }
  return null;
}

/**
 * Why a POST can't be sent, or null when it can. The tools send only one: a search on a company's
 * Workday site, which takes it no other way, for a job's title. Everything else they read, they GET.
 */
export function postProblem(url: URL, body: string): string | null {
  const search =
    WORKDAY_SITE.test(url.hostname) && WORKDAY_SEARCH.test(url.pathname) && !url.search;
  if (!search) return 'Factwright sends a POST only to a company’s Workday site’s own job search.';
  return body.length > MAX_POST_BYTES ? 'That search is too long to send.' : null;
}

/**
 * Whether an answer is something the app reads: a page, text, JSON or XML, rather than a file such
 * as a PDF or a Word document, whose bytes read as nonsense. An answer that doesn't say is read.
 */
export function readableType(type: string | undefined): boolean {
  if (!type) return true;
  const [kind = '', sub = ''] = (type.split(';', 1)[0] ?? '').trim().toLowerCase().split('/');
  return kind === 'text' || /^(json|xml|html|javascript)$|\+(json|xml)$/.test(sub);
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

/** One request, a GET unless it has something to send, without following redirects, given up at the deadline. */
function send(
  url: URL,
  json: boolean,
  deadline: number,
  maxBytes: number,
  sending?: string,
): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: sending === undefined ? 'GET' : 'POST',
        lookup: publicLookup,
        headers: {
          'user-agent': 'Mozilla/5.0 (Factwright; saves job postings for the user)',
          accept: json ? 'application/json' : 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-encoding': 'gzip, deflate',
          ...(sending !== undefined && {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(sending),
          }),
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
        const type = response.headers['content-type'];
        if (status >= 200 && status < 300 && !readableType(type)) {
          fail(
            new FetchRefused(
              `That link is a file (${(type ?? '').split(';', 1)[0]}), not a page, so the app doesn’t read it. Ask the user to paste the posting.`,
              'file',
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = decoded(response);
        if (!stream) {
          fail(
            new FetchRefused(
              'That site sent the page compressed with Brotli, which the app never unpacks. Use a posting the user saved from their browser, or ask the user to paste it.',
              'brotli',
            ),
          );
          return;
        }
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) fail(new FetchTooBig());
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
    outgoing.end(sending);
  });
}

/**
 * Fetches a public https page or API, following up to five redirects and checking each one,
 * within a time and size limit, telling `onRedirect` each address a redirect sends it to before
 * it goes there. JSON answers come back parsed. With `sending`, it's the tools' one POST, which
 * postProblem checks, and which follows no redirect.
 */
export async function fetchPublic(
  address: string,
  json: boolean,
  limitMs = TIME_LIMIT_MS,
  maxBytes = MAX_BYTES,
  onRedirect?: (url: string) => void,
  sending?: string,
): Promise<unknown> {
  const deadline = Date.now() + Math.min(limitMs, TIME_LIMIT_MS);
  let url = new URL(address);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refusal = linkRefusal(url);
    if (refusal) throw refusal;
    const posting = sending === undefined ? null : postProblem(url, sending);
    if (posting) throw new FetchRefused(posting, 'post');
    if (hop > 0) onRedirect?.(url.href);
    const answer = await send(url, json, deadline, maxBytes, sending);
    if (answer.location !== undefined) {
      if (sending !== undefined) throw new FetchAnswered(url.hostname, answer.status);
      if (!answer.location) throw new Error(`${url.hostname} sent a redirect without an address`);
      url = new URL(answer.location, url);
      continue;
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new FetchAnswered(url.hostname, answer.status);
    }
    return json ? JSON.parse(answer.body) : answer.body;
  }
  throw new Error('the link redirected too many times');
}
