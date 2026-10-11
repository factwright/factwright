import { join, normalize, sep } from 'node:path';

/**
 * What the window may load: only the app's own scripts, styles and images, and no outside
 * connections. During development the screens come from Vite's dev server, which is allowed too.
 */
export function contentSecurityPolicy(devUrl?: string): string {
  const dev = devUrl ? new URL(devUrl).origin : undefined;
  const sources = (base: string) => (dev ? `${base} ${dev}` : base);
  return [
    "default-src 'self'",
    `script-src ${sources("'self'")}`,
    // React and the theme set styles inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${sources("'self'")}${dev ? ` ${dev.replace(/^http/, 'ws')}` : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Only https links leave the app, and they open in the user's own browser. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The file a URL path names inside `root`, or null if it would reach outside it. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const base = normalize(root);
  const file = normalize(join(base, decoded === '/' ? 'index.html' : decoded));
  return file.startsWith(base + sep) ? file : null;
}
