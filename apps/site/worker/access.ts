/**
 * Who's signed in to the ideas board's admin page. Cloudflare Access stands in front of it and
 * lets in only Steve, and the Worker checks for itself the token Access signs and sends with each
 * request it lets through (Cf-Access-Jwt-Assertion), so nothing reaches the admin page without it.
 */

/** Where the Access application is: its team's domain and its audience tag, both from its setup. */
export interface AccessSettings {
  /** Such as factwright.cloudflareaccess.com. */
  teamDomain?: string | undefined;
  /** The application's Application Audience (AUD) tag. */
  aud?: string | undefined;
  /**
   * For `pnpm serve` only, set in .dev.vars: lets the admin page in as this address on localhost,
   * where no Access stands in front of it. The Worker answers on factwright.com once deployed, so
   * it can never let anyone in there.
   */
  localAdmin?: string | undefined;
}

/** The keys an Access team signs its tokens with, by their IDs, fetched afresh when asked. */
export type AccessKeys = (teamDomain: string, fresh: boolean) => Promise<Map<string, CryptoKey>>;

/** The header Access sends the token in. */
const TOKEN_HEADER = 'Cf-Access-Jwt-Assertion';

/** An Access team's domain. Nothing else is asked for keys. */
const TEAM_DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/;

/** How far a token's times can be off from the Worker's clock, in seconds. */
const LEEWAY = 60;

/** The addresses a local preview answers on. */
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

/** RSA with SHA-256, which Access signs with. */
const RS256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

/**
 * The email address of whoever Access signed in, if the request carries a token Access signed
 * for this application that hasn't run out. Anything else is no one, as is everything before the
 * Access application's settings are in place.
 */
export async function signedIn(
  request: Request,
  settings: AccessSettings,
  keys: AccessKeys = accessKeys,
  now = Date.now(),
): Promise<string | null> {
  const local = settings.localAdmin?.trim();
  if (local && LOCAL.has(new URL(request.url).hostname)) return local;
  const team = settings.teamDomain
    ?.trim()
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '');
  const aud = settings.aud?.trim();
  const token = request.headers.get(TOKEN_HEADER);
  if (!team || !TEAM_DOMAIN.test(team) || !aud || !token) return null;
  const [head, body, signature, ...rest] = token.split('.');
  if (!head || !body || !signature || rest.length > 0) return null;
  const header = parsed(head);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  try {
    const key =
      (await keys(team, false)).get(header.kid) ?? (await keys(team, true)).get(header.kid);
    if (!key) return null;
    const signed = await crypto.subtle.verify(
      RS256,
      key,
      bytes(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!signed) return null;
  } catch {
    return null;
  }
  const claims = parsed(body);
  if (!claims) return null;
  const seconds = now / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const { exp, nbf, iat, email } = claims;
  if (
    claims.iss !== `https://${team}` ||
    !audiences.includes(aud) ||
    typeof exp !== 'number' ||
    exp + LEEWAY < seconds ||
    (typeof nbf === 'number' && nbf - LEEWAY > seconds) ||
    (typeof iat === 'number' && iat - LEEWAY > seconds) ||
    typeof email !== 'string' ||
    !email
  ) {
    return null;
  }
  return email;
}

/** A part of a token, as bytes. */
function bytes(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  return Uint8Array.from(binary, (letter) => letter.charCodeAt(0));
}

/** A part of a token that holds JSON, read, or null. */
function parsed(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes(part)));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** How long the team's keys are kept before they're fetched again. Access rotates them slowly. */
const KEEP_KEYS_MS = 10 * 60_000;

/** How soon after one fetch a token signed with a key the Worker doesn't have can fetch again. */
const REFETCH_MS = 30_000;

/** The team's keys, as last fetched, while this copy of the Worker runs. */
let kept: { team: string; at: number; keys: Map<string, CryptoKey> } | null = null;

/** The keys an Access team signs with, from its certs address, kept for a while. */
async function accessKeys(team: string, fresh: boolean): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (kept?.team === team && now - kept.at < (fresh ? REFETCH_MS : KEEP_KEYS_MS)) {
    return kept.keys;
  }
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access's keys answered ${response.status}`);
  const { keys = [] } = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const imported = new Map<string, CryptoKey>();
  for (const key of keys) {
    if (key.kty !== 'RSA' || !key.kid) continue;
    imported.set(key.kid, await crypto.subtle.importKey('jwk', key, RS256, false, ['verify']));
  }
  kept = { team, at: now, keys: imported };
  return imported;
}
