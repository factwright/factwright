import { join, normalize, resolve, sep } from 'node:path';
import type { TerminalSize } from '../shared/api.ts';

/** A panel size from the window, if it's whole numbers in a sensible range. */
export function parseTerminalSize(value: unknown): TerminalSize | null {
  if (typeof value !== 'object' || value === null) return null;
  const { cols, rows } = value as Record<string, unknown>;
  const fits = (n: unknown, max: number) =>
    Number.isInteger(n) && (n as number) >= 2 && (n as number) <= max;
  return fits(cols, 1000) && fits(rows, 500)
    ? { cols: cols as number, rows: rows as number }
    : null;
}

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

/** Only https and email links leave the app, opening in the user's own browser or mail app. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    // Email links open the user's mail app with a draft, which they still send themselves.
    return protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * A resume the window may open in the user's own app for it: a PDF or Word file inside the
 * workspace. Anything else, or a path that leads outside, is null.
 */
export function openableFile(workspace: string, path: string): string | null {
  if (!/\.(pdf|docx)$/i.test(path)) return null;
  const base = resolve(workspace);
  const file = resolve(base, path);
  return file.startsWith(base + sep) ? file : null;
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
