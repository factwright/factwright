/** A link about a job, with a short label such as "Posting" or "Company site". */
export interface Link {
  url: string;
  label: string;
}

const isSpace = (character: string | undefined) => character !== undefined && /\s/.test(character);

/** Text without any of the given characters at its end, read from the end, once. */
function trimEndOf(text: string, characters: string): string {
  let end = text.length;
  while (end > 0 && characters.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/**
 * Query parameters that only track where a click came from, such as LinkedIn's refId and
 * trackingId, which differ on every copy of a link to the same job.
 */
const TRACKING_PARAM =
  /^(utm_|ref$|refid$|src$|source$|from$|tk$|trk|trackingid$|ebp$|lipi$|midtoken$|midsig$|rjptk|xpse|xfps|xkcb|gh_src|lever-)/i;

/**
 * A page's route after "#/" or "#!/", where some careers sites keep each job, without its own
 * tracking parameters or a trailing slash: "#/jobs/42?source=x" is "#/jobs/42". Any other "#" is
 * a place on the page, which names nothing.
 */
function routeOf(hash: string): string {
  if (!/^#!?\/./.test(hash)) return '';
  const [path = '', query = ''] = hash.split('?', 2);
  const kept = query.split('&').filter((pair) => {
    const name = pair.split('=', 1)[0] ?? '';
    return name !== '' && !TRACKING_PARAM.test(name);
  });
  return `${trimEndOf(path, '/')}${kept.length > 0 ? `?${kept.join('&')}` : ''}`;
}

/**
 * One form per address, for matching: no "www.", no trailing slash, no tracking parameters, and
 * lowercase. "https://www.acme.com/jobs/42/?utm_source=x" becomes "acme.com/jobs/42". A page's
 * route after "#/" or "#!/", where some careers sites keep each job, stays: it names the job.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
    }
    const host = parsed.hostname.replace(/^www\./, '');
    const path = trimEndOf(parsed.pathname, '/');
    return `${host}${path}${parsed.search}${routeOf(parsed.hash)}`.toLowerCase();
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
  // The site's name, without the "." a fully written-out one can end with.
  const host = trimEndOf(normal.split(/[/?#]/, 1)[0] ?? '', '.');
  // A company's own page, or a part of it, as LinkedIn's /company/acme/jobs is, lists its jobs;
  // a page further in, as SmartRecruiters' form at /company/acme/publication/<id>, is one job's.
  const companyPage =
    /\/(company|cmp)\/[^/?#]+(\/(jobs|about|life|people|posts|reviews|salaries|benefits|photos|faq|insights|videos))?\/?($|[?#])/;
  if (host === 'news.ycombinator.com' || companyPage.test(normal)) return false;
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

/**
 * The words before a link, as its label when they're short enough to be one: from the part's
 * first visible character to the link, less the spaces, ":" and "(" just before it. They're read
 * back from the link, and copied only when short, so a part with many links is read once.
 */
function labelBefore(part: string, from: number, to: number): string | null {
  let end = to;
  while (end > from && isSpace(part[end - 1])) end -= 1;
  while (end > from && (part[end - 1] === ':' || part[end - 1] === '(')) end -= 1;
  while (end > from && isSpace(part[end - 1])) end -= 1;
  return end > from && end - from <= 24 ? part.slice(from, end) : null;
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
    let from = 0;
    while (isSpace(part[from])) from += 1;
    for (const match of part.matchAll(/https?:\/\/[^\s)<>]+/g)) {
      const url = trimEndOf(match[0], '.,;:');
      const end = match.index + match[0].length;
      if (url.includes('…') || part[end] === '…') continue;
      const before = labelBefore(part, from, match.index);
      const label = before ? capitalize(before) : (fallbackLabel ?? hostOf(url));
      links.push({ url, label });
    }
    return links;
  });
}

/** LinkedIn's sites: its own, its short links and its files. */
const LINKEDIN = /(^|\.)(linkedin\.com|lnkd\.in|licdn\.com)$/;

/**
 * Whether a link is LinkedIn's. Factwright's own tools never read LinkedIn, whose terms forbid
 * software reading it. The browser extension can save a LinkedIn job the user is looking at.
 */
export function isLinkedIn(url: string): boolean {
  try {
    const host = new URL(url).hostname
      .replace(/^\[|\]$/g, '')
      .toLowerCase()
      .replace(/\.$/, '');
    return LINKEDIN.test(host);
  } catch {
    return false;
  }
}
