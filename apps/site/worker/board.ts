import {
  allIdeas,
  castVote,
  changeIdea,
  type Db,
  declineNew,
  deleteIdea,
  forgetEmail,
  ID,
  mergeIdea,
  readChange,
  readSuggestion,
  readVote,
  shownIdeas,
  suggest,
  WAITING_MAX,
} from './ideas.ts';
import { fillRoadmap } from './roadmap.ts';

/**
 * The ideas board's addresses: the roadmap page, which the Worker fills in, the API its script
 * sends suggestions and votes to, and the admin page and its API, for Steve alone.
 */

/** The roadmap page. */
export const ROADMAP = '/roadmap';

/** The admin page, and everything under it, which Cloudflare Access stands in front of. */
export const ADMIN = '/roadmap/admin';

/** The admin page's API. Under the admin page, so the same Access application covers it. */
const ADMIN_API = `${ADMIN}/api/ideas`;

/** The roadmap page's API. */
const API = '/api';
const SUGGESTIONS = `${API}/ideas`;

/** A vote's address: an idea's, then /vote. */
const VOTE = /^\/api\/ideas\/([^/]+)\/vote$/;

/** What the admin page does to one idea: change it, or merge, delete it or forget its email. */
const ADMIN_IDEA = /^\/roadmap\/admin\/api\/ideas\/([^/]+)(?:\/(merge|delete|forget-email))?$/;

/** Declining every new suggestion the admin page shows at once, as after a flood of them. */
const DECLINE_NEW = `${ADMIN}/api/decline-new`;

/** The most a request to the API can send, in bytes. A suggestion is well under it. */
const BODY_MAX = 16 * 1024;

/** A Workers Rate Limiting binding. Its key is the address a request came from, which it forgets. */
export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** What the board runs on. Each part can be missing, as in a preview without them. */
export interface Board {
  db?: Db | undefined;
  /** How often one address can suggest, and vote. */
  limits?: { suggest?: Limiter | undefined; vote?: Limiter | undefined };
  /** Whoever Cloudflare Access signed in to the admin page, or null (access.ts). */
  admin: (request: Request) => Promise<string | null>;
  now?: () => Date;
}

/** The site's built pages. */
interface Assets {
  fetch(request: Request): Promise<Response>;
}

/**
 * Answers a request for one of the board's addresses, or null to leave it to the site's pages.
 * Anything under the admin page needs Access's sign-in first, the page as much as its API.
 */
export async function answerBoard(
  request: Request,
  assets: Assets,
  board: Board,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === ROADMAP && ['GET', 'HEAD'].includes(request.method)) {
    return roadmapPage(request, assets, board);
  }
  if (pathname.startsWith(ADMIN)) return admin(request, assets, board);
  if (pathname === API || pathname.startsWith(`${API}/`)) return api(request, board);
  return null;
}

/**
 * The roadmap page, with its ideas filled in. The ideas change as people vote, so browsers ask
 * for it again each time rather than keep it. When the ideas can't be read, the page says so. A
 * HEAD gets the same headers, without reading the ideas.
 */
async function roadmapPage(request: Request, assets: Assets, board: Board): Promise<Response> {
  // The page as it's built, asked for plainly: a browser's own If-None-Match is for the filled-in
  // page, which has no ETag, never for the built one.
  const found = await assets.fetch(new Request(request.url, { method: request.method }));
  // An asset's headers can't be changed, and the site's security headers go on next.
  if (found.status !== 200) return new Response(found.body, found);
  const headers = new Headers(found.headers);
  for (const name of ['Content-Length', 'ETag', 'Last-Modified']) headers.delete(name);
  headers.set('Cache-Control', 'no-cache');
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  let ideas = null;
  try {
    if (board.db) ideas = await shownIdeas(board.db);
  } catch (error) {
    console.error('The roadmap couldn’t read its ideas:', String(error));
  }
  return new Response(fillRoadmap(await found.text(), ideas), { status: 200, headers });
}

/** The roadmap page's API: a suggestion, or a vote. */
async function api(request: Request, board: Board): Promise<Response> {
  const { pathname } = new URL(request.url);
  const vote = VOTE.exec(pathname)?.[1];
  if (pathname !== SUGGESTIONS && vote === undefined) {
    return problem(404, 'not-found', 'There’s nothing here.');
  }
  if (request.method !== 'POST') {
    return problem(405, 'method', 'Send this with POST.', { Allow: 'POST' });
  }
  const refused = notFromThePage(request, false);
  if (refused) return refused;
  if (vote !== undefined && !ID.test(vote)) {
    return problem(
      404,
      'not-found',
      'That idea isn’t here anymore. Reload the page to see the latest.',
    );
  }
  const { db } = board;
  if (!db) return unavailable();
  if (!(await allowed(board.limits?.[vote === undefined ? 'suggest' : 'vote'], request))) {
    return problem(429, 'too-many', 'That’s a lot at once. Wait a minute, then try again.', {
      'Retry-After': '60',
    });
  }
  const body = await readBody(request);
  if (body === undefined) return problem(400, 'bad-request', 'That didn’t come through right.');
  try {
    return vote === undefined
      ? await suggestion(db, body, board)
      : await voting(db, vote, body, board);
  } catch (error) {
    console.error('The ideas board couldn’t save:', String(error));
    return unavailable();
  }
}

/** A new suggestion, which waits for Steve to read it. */
async function suggestion(db: Db, body: unknown, board: Board): Promise<Response> {
  const read = readSuggestion(body);
  if (!read.ok) return problem(400, 'bad-request', read.problem);
  const kept = await suggest(db, read.value, board.now?.());
  if (kept === 'busy') {
    return problem(
      503,
      'busy',
      'A lot of ideas are waiting to be read right now. Please try again in a few days.',
    );
  }
  return json(201, kept);
}

/** A vote, or taking one back. */
async function voting(db: Db, id: string, body: unknown, board: Board): Promise<Response> {
  const read = readVote(body);
  if (!read.ok) return problem(400, 'bad-request', read.problem);
  const voted = await castVote(db, id, read.value);
  if (voted === 'not-found') {
    return problem(
      404,
      'not-found',
      'That idea isn’t here anymore. Reload the page to see the latest.',
    );
  }
  if (voted === 'closed') return problem(409, 'closed', 'Voting has closed on this idea.');
  return json(200, voted);
}

/** Everything under the admin page, kept out of search engines and browsers' caches. */
async function admin(request: Request, assets: Assets, board: Board): Promise<Response> {
  const answer = await adminAnswer(request, assets, board);
  const headers = new Headers(answer.headers);
  for (const [name, value] of Object.entries(PRIVATE)) headers.set(name, value);
  return new Response(answer.body, { status: answer.status, headers });
}

/** The admin page and its API, once Access has signed Steve in. */
async function adminAnswer(request: Request, assets: Assets, board: Board): Promise<Response> {
  const { pathname } = new URL(request.url);
  const api = pathname === ADMIN_API || pathname.startsWith(`${ADMIN}/api/`);
  const you = await board.admin(request);
  if (!you) {
    return api
      ? problem(403, 'signed-out', 'Sign in through Cloudflare Access to use this.')
      : new Response('This page is only for Factwright’s maker, through Cloudflare Access.', {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
  }
  if (!api) return assets.fetch(request);
  const { db } = board;
  const idea = ADMIN_IDEA.exec(pathname);
  if (pathname !== ADMIN_API && pathname !== DECLINE_NEW && !idea) {
    return problem(404, 'not-found', 'There’s nothing here.');
  }
  if (pathname === ADMIN_API) {
    if (request.method !== 'GET') {
      return problem(405, 'method', 'Ask for this with GET.', { Allow: 'GET' });
    }
    if (!db) return unavailable();
    return everything(db, you);
  }
  if (request.method !== 'POST') {
    return problem(405, 'method', 'Send this with POST.', { Allow: 'POST' });
  }
  const refused = notFromThePage(request, true);
  if (refused) return refused;
  const [, id = '', action] = idea ?? [];
  if (idea && !ID.test(id)) return problem(404, 'not-found', 'That idea isn’t here anymore.');
  if (!db) return unavailable();
  const body = await readBody(request);
  if (body === undefined) return problem(400, 'bad-request', 'That didn’t come through right.');
  try {
    const done = idea
      ? await adminChange(db, id, action, body, board.now?.() ?? new Date())
      : await declineAll(db, body);
    if (done === 'not-found') return problem(404, 'not-found', 'That idea isn’t here anymore.');
    if (typeof done === 'object') return problem(400, 'bad-request', done.problem);
    return everything(db, you);
  } catch (error) {
    console.error('The admin page couldn’t save:', String(error));
    return unavailable();
  }
}

/** Does what the admin page asked to one idea. */
async function adminChange(
  db: Db,
  id: string,
  action: string | undefined,
  body: unknown,
  at: Date,
): Promise<string | { problem: string }> {
  if (action === 'delete') return deleteIdea(db, id);
  if (action === 'forget-email') return forgetEmail(db, id, at);
  if (action === 'merge') {
    const into = (body as { into?: unknown } | null)?.into;
    if (typeof into !== 'string' || !ID.test(into)) {
      return { problem: 'Choose the idea to merge it into.' };
    }
    return mergeIdea(db, id, into, at);
  }
  const read = readChange(body);
  if (!read.ok) return { problem: read.problem };
  return changeIdea(db, id, read.value, at);
}

/** Declines the new suggestions the admin page lists, by their IDs. */
async function declineAll(db: Db, body: unknown): Promise<string | { problem: string }> {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > WAITING_MAX ||
    !ids.every((each) => typeof each === 'string' && ID.test(each))
  ) {
    return { problem: 'Those didn’t come through right. Reload the page and try again.' };
  }
  await declineNew(db, [...new Set(ids as string[])]);
  return 'declined';
}

/** Every idea, for the admin page, after each change too, with who's signed in. */
async function everything(db: Db, you: string): Promise<Response> {
  try {
    return json(200, { you, ideas: await allIdeas(db) });
  } catch (error) {
    console.error('The admin page couldn’t read the ideas:', String(error));
    return unavailable();
  }
}

/** Headers that keep the admin page and its answers out of caches and search engines. */
const PRIVATE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } as const;

/**
 * Turns away a request the site's own pages didn't send: one that isn't JSON, which another
 * site's page can't send without asking first, or one that says it came from another site. The
 * admin page's changes must also say they came from this one, as every browser does.
 */
function notFromThePage(request: Request, strict: boolean): Response | null {
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') ?? '')) {
    return problem(415, 'bad-request', 'Send this as JSON.');
  }
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (
    (origin === null ? strict : origin !== new URL(request.url).origin) ||
    (site !== null && site !== 'same-origin')
  ) {
    return problem(403, 'other-site', 'Send this from factwright.com.');
  }
  return null;
}

/**
 * A request's JSON, or undefined when there's too much of it or it isn't JSON. It reads no more
 * than it takes, so a body sent in pieces, with no length to check first, is turned away too.
 */
async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('Content-Length') ?? 0) > BODY_MAX) return undefined;
  const reader = request.body?.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_MAX) {
      await reader.cancel();
      return undefined;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Whether the address a request came from can send another, by its limit. Without the limit, as
 * in a preview, or when it can't be told, it can: a vote or a suggestion matters more.
 */
async function allowed(limiter: Limiter | undefined, request: Request): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({
      key: limitKey(request.headers.get('CF-Connecting-IP')),
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * What a limit counts a request by: its IPv4 address, or for IPv6, the first half of it, which
 * one home or phone usually has to itself, and can pick a new address within at will.
 */
export function limitKey(address: string | null): string {
  if (!address) return 'unknown';
  if (!address.includes(':')) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return mapped;
  const [head = '', tail] = address.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** An answer in JSON, which nothing keeps. */
function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

/** What went wrong, for the page's script to say: a code, and words to show. */
function problem(
  status: number,
  error: string,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return json(status, { error, message }, headers);
}

/** The ideas can't be read or saved just now. */
const unavailable = () =>
  problem(503, 'unavailable', 'Ideas can’t be saved just now. Try again in a minute.');
