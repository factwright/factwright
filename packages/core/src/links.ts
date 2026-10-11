/** A link about a job, with a short label such as "Posting" or "Company site". */
export interface Link {
  url: string;
  label: string;
}

/** Query parameters that only track where a click came from. */
const TRACKING_PARAM =
  /^(utm_|ref$|src$|source$|from$|tk$|trk|rjptk|xpse|xfps|xkcb|gh_src|lever-)/i;

/**
 * One form per address, for matching: no "www.", no trailing slash, no tracking parameters, and
 * lowercase. "https://www.acme.com/jobs/42/?utm_source=x" becomes "acme.com/jobs/42".
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
    }
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Whether a link points at one job. A job board, a careers page or a Hacker News thread can
 * cover several jobs; only deeper links, or ones with a query, name one.
 */
export function isJobLink(url: string): boolean {
  const normal = normalizeUrl(url);
  if (normal.startsWith('news.ycombinator.com') || /\/(company|cmp)\//.test(normal)) return false;
  const [path = '', query] = normal.split('?');
  return Boolean(query) || path.split('/').filter(Boolean).length >= 3;
}

/** The site's name, such as "acme.com" for "https://www.acme.com/jobs". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Reads the links in a field like "LinkedIn https://… · Ashby https://… · company https://…".
 * Text just before a link becomes its label. Links cut short with "…" are dropped, because
 * they no longer work.
 */
export function linksFrom(field: string | null | undefined, fallbackLabel?: string): Link[] {
  if (!field) return [];
  return field.split(/\s+·\s+|\s*;\s+/).flatMap((part) => {
    const links: Link[] = [];
    for (const match of part.matchAll(/https?:\/\/[^\s)<>]+/g)) {
      const url = match[0].replace(/[.,;:]+$/, '');
      const end = match.index + match[0].length;
      if (url.includes('…') || part[end] === '…') continue;
      const before = part
        .slice(0, match.index)
        .replace(/[:(]+\s*$/, '')
        .trim();
      const label =
        before && before.length <= 24 ? capitalize(before) : (fallbackLabel ?? hostOf(url));
      links.push({ url, label });
    }
    return links;
  });
}
