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

/**
 * Answers a request for a page, with the headers above. Built scripts, styles and the template
 * previews skip the Worker (see wrangler.jsonc) and get their headers from public/_headers.
 */
export async function respond(request: Request, assets: Pick<Fetcher, 'fetch'>): Promise<Response> {
  const url = new URL(request.url);
  if (PUBLIC_HOSTS.has(url.hostname) && (url.hostname !== HOME || url.protocol !== 'https:')) {
    url.protocol = 'https:';
    url.hostname = HOME;
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }
  const found = await assets.fetch(request);
  const response = new Response(found.body, found);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}
