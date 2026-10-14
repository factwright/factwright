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
  const host = normal.split(/[/?#]/, 1)[0];
  if (host === 'news.ycombinator.com' || /\/(company|cmp)\//.test(normal)) return false;
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

const isSpace = (character: string | undefined) => character !== undefined && /\s/.test(character);

/**
 * A field's parts, split at each "·" with space on each side and each ";" with space after, each
 * taking the spaces around it, as /\s+·\s+|\s*;\s+/ would split them. It's read in one pass,
 * where that pattern reads a long run of spaces again from each space in it.
 */
function fieldParts(field: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let at = 0; at < field.length; at += 1) {
    const character = field[at];
    if (character !== '·' && character !== ';') continue;
    let before = at;
    while (before > start && isSpace(field[before - 1])) before -= 1;
    let after = at + 1;
    while (isSpace(field[after])) after += 1;
    if (after > at + 1 && (character === ';' || before < at)) {
      parts.push(field.slice(start, before));
      start = after;
      at = after - 1;
    }
  }
  parts.push(field.slice(start));
  return parts;
}

/** Text without any of the given characters at its end, read from the end, once. */
function trimEndOf(text: string, characters: string): string {
  let end = text.length;
  while (end > 0 && characters.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/**
 * Reads the links in a field like "LinkedIn https://… · Ashby https://… · company https://…".
 * Text just before a link becomes its label. Links cut short with "…" are dropped, because
 * they no longer work.
 */
export function linksFrom(field: string | null | undefined, fallbackLabel?: string): Link[] {
  if (!field) return [];
  return fieldParts(field).flatMap((part) => {
    const links: Link[] = [];
    for (const match of part.matchAll(/https?:\/\/[^\s)<>]+/g)) {
      const url = trimEndOf(match[0], '.,;:');
      const end = match.index + match[0].length;
      if (url.includes('…') || part[end] === '…') continue;
      const before = trimEndOf(part.slice(0, match.index).trimEnd(), ':(').trim();
      const label =
        before && before.length <= 24 ? capitalize(before) : (fallbackLabel ?? hostOf(url));
      links.push({ url, label });
    }
    return links;
  });
}
