import { type Computer, DOWNLOAD_PAGES, fillDownloadPage, type Release } from './releases.ts';

/** The site's one address. www.factwright.com, and plain http, send visitors here. */
export const HOME = 'factwright.com';

/** The addresses the site answers on, as opposed to a local preview. */
const PUBLIC_HOSTS = new Set([HOME, `www.${HOME}`]);

/**
 * Every page runs only the site's own scripts and styles, connects nowhere, can't be shown inside
 * another site, and keeps to https.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** The newest release for a computer, or null when it can't be told. */
export type Releases = (computer: Computer) => Promise<Release | null>;

/**
 * Answers a request for a page, with the headers above. Built scripts, styles and the template
 * previews skip the Worker (see wrangler.jsonc) and get their headers from public/_headers. The
 * download pages get the newest release filled in.
 */
export async function respond(
  request: Request,
  assets: Pick<Fetcher, 'fetch'>,
  releases: Releases = async () => null,
): Promise<Response> {
  const url = new URL(request.url);
  if (PUBLIC_HOSTS.has(url.hostname) && (url.hostname !== HOME || url.protocol !== 'https:')) {
    url.protocol = 'https:';
    url.hostname = HOME;
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }
  const found = await assets.fetch(request);
  const computers = DOWNLOAD_PAGES.get(url.pathname);
  const response =
    computers && found.status === 200
      ? await downloadPage(found, computers, releases)
      : new Response(found.body, found);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

/**
 * A download page, with the newest release for each computer it offers. The version changes with
 * each release, so browsers ask for the page again each time rather than keep it.
 */
async function downloadPage(
  found: Response,
  computers: readonly Computer[],
  releases: Releases,
): Promise<Response> {
  const known = Object.fromEntries(
    await Promise.all(computers.map(async (computer) => [computer, await releases(computer)])),
  );
  const headers = new Headers(found.headers);
  for (const name of ['Content-Length', 'ETag', 'Last-Modified']) headers.delete(name);
  headers.set('Cache-Control', 'no-cache');
  return new Response(fillDownloadPage(await found.text(), known), {
    status: found.status,
    headers,
  });
}
