import { oneLine } from './answered.ts';
import { decodeEntities, htmlToText, ORACLE_DEFAULT_SITE, ORACLE_HOST } from './posting.ts';
import { readSitemap } from './sitemaps.ts';

/**
 * A company's job board on an applicant system, by the board's name there. Workday and Oracle give
 * each company a site of its own, with its boards on it. Every address a request goes to is built
 * from these, and each is checked first, so a link can't steer a request anywhere else.
 */
export interface BoardSource {
  kind:
    | 'greenhouse'
    | 'lever'
    | 'ashby'
    | 'gem'
    | 'smartrecruiters'
    | 'recruitee'
    | 'workable'
    | 'jazzhr'
    | 'paylocity'
    | 'oracle'
    | 'workday'
    | 'icims';
  board: string;
  /** The company's own site on Workday or Oracle. */
  site?: string;
}

/** One open job on a board. */
export interface BoardJob {
  /** The applicant system's ID for the posting, which its links carry. */
  id: string | null;
  title: string;
  location: string | null;
  /** Remote, hybrid or on-site, when the board says. */
  workplace: string | null;
  team: string | null;
  pay: string | null;
  link: string;
  /** When it was posted, as YYYY-MM-DD, when the board says. */
  posted: string | null;
  /** The posting, as plain text, or what the board gives of it. */
  text: string;
  /** Who's hiring, for a source with more than one employer. */
  company?: string;
  /** When it closes, as YYYY-MM-DD, when the source says. */
  closes?: string;
  /** When its entry last changed, as YYYY-MM-DD, for a source that gives only that. */
  changed?: string;
  /** Anything else a listing should say, such as who may apply. */
  note?: string;
}

const BOARD_NAMES: Readonly<Record<BoardSource['kind'], string>> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  gem: 'Gem',
  smartrecruiters: 'SmartRecruiters',
  recruitee: 'Recruitee',
  workable: 'Workable',
  jazzhr: 'JazzHR',
  paylocity: 'Paylocity',
  oracle: 'Oracle',
  workday: 'Workday',
  icims: 'iCIMS',
};

/** The applicant system's name, such as "Greenhouse". */
export const boardSystem = (source: BoardSource) => BOARD_NAMES[source.kind];

/**
 * A board's name to show and to name its file by. A board on a company's own site goes by that
 * site's name too, as many companies' Oracle boards are all "CX_1" and Workday's all "Careers".
 */
export const boardName = (source: BoardSource) =>
  source.site ? `${source.site.split('.')[0]}/${source.board}` : source.board;

/** The systems whose whole board comes with each posting's text, so it's one answer's worth. */
const WITH_FULL_TEXT: ReadonlySet<BoardSource['kind']> = new Set([
  'greenhouse',
  'lever',
  'ashby',
  'gem',
  'recruitee',
  'workable',
]);

/** Whether reading a board gives each posting's full text, or only what lists it. */
export const boardHasText = (source: BoardSource) => WITH_FULL_TEXT.has(source.kind);

/**
 * Whether a board is read from its sitemap, which lists links and little else. Workday's search
 * could list these boards in full, with a POST the app doesn't make, so it's left out for now: it
 * would be one more way to fill in these same jobs.
 */
export const boardFromSitemap = (source: BoardSource) =>
  source.kind === 'workday' || source.kind === 'icims';

/** Whether a board's answer is JSON, or a page or a sitemap. */
export const boardAnswersJson = (source: BoardSource) =>
  !boardFromSitemap(source) && source.kind !== 'jazzhr' && source.kind !== 'paylocity';

/** How many jobs each request for a long board brings, for the systems that page. */
export const BOARD_PAGE_SIZE = 100;

/** Whether a board comes a page at a time, or all at once. */
export const boardPages = (source: BoardSource) =>
  source.kind === 'smartrecruiters' || source.kind === 'oracle';

/** One label of a host name, as a company's name at its applicant system can be. */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** A company's or a site's name in a path. */
const PATH_NAME = /^[\w-]{1,100}$/;
const WORKDAY_HOST = /^[a-z0-9-]{1,63}\.wd\d{1,3}\.myworkdayjobs\.com$/;
const WORKDAY_SITE_HOST = /^wd\d{1,3}\.myworkdaysite\.com$/;
/** iCIMS's career sites all start with what they're for, such as "careers-" or "jobs-". */
const ICIMS_HOST = /^[a-z0-9]+-[a-z0-9-]{1,62}\.icims\.com$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What sits at a system's own domain, rather than a company's board. */
const NOT_A_COMPANY: ReadonlySet<string> = new Set(['www', 'app', 'api', 'apply', 'jobs', 'help']);

/** The company's name in a host of the form <company>.<domain>, when it can be one. */
function companyAt(host: string, domain: string): string | null {
  if (!host.endsWith(`.${domain}`)) return null;
  const name = host.slice(0, -domain.length - 1);
  return HOST_LABEL.test(name) && !NOT_A_COMPANY.has(name) ? name : null;
}

/** A path's parts without the language some systems put first, as "en-US" in Workday's. */
const withoutLanguage = (parts: readonly string[]) =>
  /^[a-z]{2}-[a-z]{2}$/i.test(parts[0] ?? '') ? parts.slice(1) : parts;

/** The site and board in a link to a company's Workday site. */
function workdayBoard(host: string, parts: readonly string[]): BoardSource | null {
  const path = withoutLanguage(parts);
  if (WORKDAY_HOST.test(host)) {
    const board = path[0];
    return board && PATH_NAME.test(board) ? { kind: 'workday', board, site: host } : null;
  }
  // wd1.myworkdaysite.com/recruiting/acme/Careers is acme.wd1.myworkdayjobs.com/Careers.
  if (!WORKDAY_SITE_HOST.test(host) || path[0] !== 'recruiting') return null;
  const tenant = path[1]?.toLowerCase();
  const board = path[2];
  if (!tenant || !HOST_LABEL.test(tenant) || !board || !PATH_NAME.test(board)) return null;
  const site = `${tenant}.${host.split('.')[0]}.myworkdayjobs.com`;
  return { kind: 'workday', board, site };
}

/** The site and board in a link to a company's Oracle career site. */
function oracleBoard(host: string, parts: readonly string[]): BoardSource | null {
  if (!ORACLE_HOST.test(host) || parts[0]?.toLowerCase() !== 'hcmui') return null;
  const at = parts.indexOf('sites');
  const board = at < 0 ? ORACLE_DEFAULT_SITE : parts[at + 1];
  return board && PATH_NAME.test(board) ? { kind: 'oracle', board, site: host } : null;
}

/** The first board name in a Paylocity link: the GUID after ".../jobs/all/". */
function paylocityBoard(parts: readonly string[]): BoardSource | null {
  const [one, two, three, board] = parts.map((part) => part.toLowerCase());
  return one === 'recruiting' && two === 'jobs' && three === 'all' && board && GUID.test(board)
    ? { kind: 'paylocity', board }
    : null;
}

/**
 * The board a link is on: a board's own page, or one of its postings. Null for a link that
 * isn't on an applicant system `job_board` reads, or that doesn't say which board.
 */
export function boardSource(address: string): BoardSource | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const parts = segments(url);
  const first = parts[0];
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // An embedded board names itself in ?for=.
    const board = url.searchParams.get('for') ?? (first === 'embed' ? null : first);
    return board ? { kind: 'greenhouse', board } : null;
  }
  if (WORKDAY_HOST.test(host) || WORKDAY_SITE_HOST.test(host)) return workdayBoard(host, parts);
  if (ORACLE_HOST.test(host)) return oracleBoard(host, parts);
  if (ICIMS_HOST.test(host)) return { kind: 'icims', board: host.split('.')[0] ?? '' };
  const recruitee = companyAt(host, 'recruitee.com');
  if (recruitee) return { kind: 'recruitee', board: recruitee };
  const jazzhr = companyAt(host, 'applytojob.com');
  if (jazzhr) return { kind: 'jazzhr', board: jazzhr };
  const workable = companyAt(host, 'workable.com');
  if (workable) return { kind: 'workable', board: workable };
  if (host === 'recruiting.paylocity.com') return paylocityBoard(parts);
  if (!first) return null;
  if (host === 'jobs.lever.co') return { kind: 'lever', board: first };
  if (host === 'jobs.ashbyhq.com') return { kind: 'ashby', board: first };
  if (host === 'jobs.gem.com') return { kind: 'gem', board: first };
  if (!PATH_NAME.test(first)) return null;
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') {
    return { kind: 'smartrecruiters', board: first };
  }
  // "j" is Workable's short link to a posting, which names no company.
  if (host === 'apply.workable.com' && first !== 'j') return { kind: 'workable', board: first };
  return null;
}

/** A link's path, split at its slashes and decoded. */
function segments(url: URL): string[] {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

/**
 * The ID of the one posting a link is to, such as Greenhouse's job number or Lever's posting
 * UUID. Null for a link to a whole board, or one that isn't on an applicant system.
 */
export function boardPostingId(address: string): string | null {
  const source = boardSource(address);
  if (!source) return null;
  const url = new URL(address);
  const parts = segments(url);
  switch (source.kind) {
    case 'greenhouse': {
      // Embedded postings name themselves in ?token=, and company sites in ?gh_jid=.
      const query = url.searchParams.get('gh_jid') ?? url.searchParams.get('token');
      return query ?? url.pathname.match(/\/jobs\/(\d+)/)?.[1] ?? null;
    }
    case 'smartrecruiters':
      return parts[1]?.match(/^\d+/)?.[0] ?? null;
    case 'recruitee':
      return parts[0] === 'o' ? (parts[1] ?? null) : null;
    case 'workable':
      return workablePostingId(address);
    case 'jazzhr':
      return parts[0] === 'apply' ? (parts[1] ?? null) : null;
    case 'paylocity':
      return null;
    case 'oracle': {
      const at = parts.indexOf('job');
      return at < 0 ? null : (parts[at + 1] ?? null);
    }
    case 'workday':
      return workdayPostingPart(parts)?.id ?? null;
    case 'icims':
      return parts[0] === 'jobs' && /^\d+$/.test(parts[1] ?? '') ? (parts[1] ?? null) : null;
    default:
      return parts[1] ?? null;
  }
}

/**
 * The parts of a Workday posting's address after "job": the place when it has one, then the job's
 * words and its ID after the last "_", as "Columbus-Campus/Staff-Nurse_R154613-1" gives. Applying
 * goes on after them, as ".../Staff-Nurse_R154613-1/apply".
 */
function workdayPostingPart(
  parts: readonly string[],
): { place: string | null; words: string; id: string } | null {
  const job = parts.indexOf('job');
  if (job < 0) return null;
  const after = parts.slice(job + 1);
  const ends = after.indexOf('apply');
  const own = ends < 0 ? after : after.slice(0, ends);
  const posting = own.at(-1) ?? '';
  const mark = posting.lastIndexOf('_');
  if (mark < 0) return null;
  const id = posting.slice(mark + 1);
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) return null;
  return { place: own.length > 1 ? (own.at(-2) ?? null) : null, words: posting.slice(0, mark), id };
}

/** A Paylocity posting's number, in a link to the posting, which doesn't name the company's board. */
export function paylocityJobId(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== 'recruiting.paylocity.com') return null;
  const [one, two, three, id] = segments(url);
  return one?.toLowerCase() === 'recruiting' &&
    two?.toLowerCase() === 'jobs' &&
    three?.toLowerCase() === 'details' &&
    id &&
    /^\d{1,12}$/.test(id)
    ? id
    : null;
}

/** Where a Paylocity posting's own page is, which names the company's board. */
export const paylocityJobPage = (id: string) =>
  `https://recruiting.paylocity.com/Recruiting/Jobs/Details/${encodeURIComponent(id)}`;

/** The company's board a Paylocity posting's page links to, or null for one that has closed. */
export function paylocityBoardOf(html: string): BoardSource | null {
  const marker = '/Recruiting/Jobs/All/';
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const board = html.slice(at + marker.length, at + marker.length + 36);
  return GUID.test(board) ? { kind: 'paylocity', board } : null;
}

/**
 * A Workable posting's ID, its shortcode, which names it across Workable, the same on its
 * application: "apply.workable.com/acme/j/1B6E0A1710/" and "…/j/1B6E0A1710/apply" alike, Workable's
 * short link, "apply.workable.com/j/1B6E0A1710", and a company's own name at workable.com, as
 * "acme.workable.com/j/1B6E0A1710". Null for a company's whole board, as "apply.workable.com/acme",
 * or a link that isn't on Workable.
 */
export function workablePostingId(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (!/(^|\.)workable\.com$/.test(url.hostname.toLowerCase())) return null;
  const parts = segments(url);
  // "j" first, or after the company's name.
  const at = parts.indexOf('j');
  const id = at === 0 || at === 1 ? parts[at + 1] : undefined;
  return id && /^[A-Za-z0-9]{1,40}$/.test(id) ? id : null;
}

/**
 * Where the applicant system lists the open jobs on the board: as JSON, or as a page or a sitemap
 * for the systems that give only those. For a board that pages, `offset` is how far along.
 */
export function boardRequest(source: BoardSource, offset = 0): string {
  const board = encodeURIComponent(source.board);
  switch (source.kind) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;
    case 'lever':
      return `https://api.lever.co/v0/postings/${board}?mode=json`;
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`;
    case 'gem':
      return `https://api.gem.com/job_board/v0/${board}/job_posts/`;
    case 'smartrecruiters':
      return `https://api.smartrecruiters.com/v1/companies/${board}/postings?limit=${BOARD_PAGE_SIZE}&offset=${offset}`;
    case 'recruitee':
      return `https://${board}.recruitee.com/api/offers/`;
    case 'workable':
      return `https://apply.workable.com/api/v1/widget/accounts/${board}?details=true`;
    case 'jazzhr':
      return `https://${board}.applytojob.com/apply`;
    case 'paylocity':
      return `https://recruiting.paylocity.com/recruiting/jobs/All/${board}`;
    case 'oracle':
      return `https://${source.site}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${board},limit=${BOARD_PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`;
    case 'workday':
      return `https://${source.site}/${board}/siteMap.xml`;
    case 'icims':
      return `https://${board}.icims.com/sitemap.xml`;
  }
}

/** How many jobs a board that pages says it has in all, when it says. */
export function boardTotal(source: BoardSource, answer: unknown): number | null {
  const total =
    source.kind === 'oracle'
      ? field(list(field(answer, 'items'))[0], 'TotalJobsCount')
      : field(answer, 'totalFound');
  return typeof total === 'number' ? total : null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const id = (value: unknown) => (typeof value === 'number' ? String(value) : text(value));
const field = (value: unknown, key: string) => (isObject(value) ? value[key] : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** How the systems spell remote, hybrid and on-site, such as Lever's "onsite" and Gem's "in_office". */
const WORKPLACES: ReadonlyMap<string, string | null> = new Map([
  ['remote', 'Remote'],
  ['hybrid', 'Hybrid'],
  ['onsite', 'On-site'],
  ['inoffice', 'On-site'],
  ['unspecified', null],
]);
const workplace = (value: unknown) => {
  const found = text(value);
  const known = WORKPLACES.get(found?.toLowerCase().replace(/[^a-z]/g, '') ?? '');
  return known === undefined ? found : known;
};
const day = (value: unknown) => {
  if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
  return text(value)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
};
const lines = (...parts: (string | null | undefined)[]) =>
  parts.filter((part) => part !== null && part !== undefined).join('\n');

/** Lever's salary range, such as "$150,000–$190,000 a year". */
function leverPay(range: unknown): string | null {
  const min = field(range, 'min');
  const max = field(range, 'max');
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  const currency = text(field(range, 'currency')) ?? 'USD';
  const money = (n: number) =>
    `${currency === 'USD' ? '$' : `${currency} `}${n.toLocaleString('en-US')}`;
  const per = text(field(range, 'interval'))?.replace(/^per-/, '');
  return `${money(min)}–${money(max)}${per ? ` a ${per.replace(/-/g, ' ')}` : ''}`;
}

/** A range of pay from the parts Recruitee and Workable give, such as "EUR 53,000–76,000 a year". */
function payRange(from: unknown, to: unknown, currency: unknown, period: unknown): string | null {
  const money = (value: unknown) => {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n.toLocaleString('en-US') : null;
  };
  const range = [money(from), money(to)].filter(Boolean).join('–');
  if (!range) return null;
  const unit = text(currency);
  const per = text(period);
  return `${unit === 'USD' || !unit ? '$' : `${unit} `}${range}${per ? ` a ${per}` : ''}`;
}

/** A job from what a source gave, or null for one with no title or no link. */
export function job(
  found: Partial<Omit<BoardJob, 'title' | 'link'>> & { title: string | null; link: string | null },
): BoardJob | null {
  if (!found.title || !found.link) return null;
  return {
    id: found.id ?? null,
    title: found.title,
    location: found.location ?? null,
    workplace: found.workplace ?? null,
    team: found.team ?? null,
    pay: found.pay ?? null,
    link: found.link,
    posted: found.posted ?? null,
    text: found.text ?? '',
    ...(found.company && { company: found.company }),
    ...(found.closes && { closes: found.closes }),
    ...(found.changed && { changed: found.changed }),
    ...(found.note && { note: found.note }),
  };
}

/** Words for a line of a list, such as a title, which a hostile feed could fill with anything. */
export const listLine = (value: string | null | undefined) =>
  (value && oneLine(value).slice(0, 300)) || null;

/** A place, without the blanks SmartRecruiters leaves in, as "Queensland, , Australia". */
const placeWords = (value: string | null) =>
  value
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ') || null;

/** A link's words, as "Staff-Nurse--ICU" reads: "Staff Nurse ICU". */
const linkWords = (value: string) => listLine(value.replace(/[-_+]+/g, ' ')) ?? '';

/** A link on the board's own site, as https, or null for one anywhere else. */
function linkOn(site: string, address: unknown): URL | null {
  try {
    const url = new URL(text(address) ?? '');
    return url.protocol === 'https:' && url.hostname.toLowerCase() === site ? url : null;
  } catch {
    return null;
  }
}

/** Each posting in a Workday site's sitemap, by the words in its link. */
function workdayJobs(source: BoardSource, xml: unknown): BoardJob[] {
  if (typeof xml !== 'string') return [];
  return readSitemap(xml).links.flatMap(({ link, changed }) => {
    const url = linkOn(source.site ?? '', link);
    const posting = url && workdayPostingPart(segments(url));
    if (!url || !posting) return [];
    return (
      job({
        id: posting.id,
        title: linkWords(posting.words) || null,
        location: posting.place ? linkWords(posting.place) : null,
        link: url.href,
        changed: changed ?? undefined,
      }) ?? []
    );
  });
}

/** Each posting in an iCIMS site's sitemap, by the words in its link, as ".../jobs/12/nurse/job". */
function icimsJobs(source: BoardSource, xml: unknown): BoardJob[] {
  if (typeof xml !== 'string') return [];
  return readSitemap(xml).links.flatMap(({ link, changed }) => {
    const url = linkOn(`${source.board}.icims.com`, link);
    const [one, id, words, end] = url ? segments(url) : [];
    if (!url || one !== 'jobs' || !id || !/^\d{1,12}$/.test(id) || !words || end !== 'job') {
      return [];
    }
    return (
      job({ id, title: linkWords(words) || null, link: url.href, changed: changed ?? undefined }) ??
      []
    );
  });
}

/** Each job listed on a company's JazzHR page: its heading links to it, and its place follows. */
function jazzhrJobs(source: BoardSource, html: unknown): BoardJob[] {
  if (typeof html !== 'string') return [];
  const site = `${source.board}.applytojob.com`;
  const mark = 'list-group-item-heading';
  const found: BoardJob[] = [];
  let at = html.indexOf(mark);
  while (at >= 0) {
    const next = html.indexOf(mark, at + mark.length);
    const item = html.slice(at, next < 0 ? html.length : next);
    at = next;
    const open = item.indexOf('href="');
    const close = open < 0 ? -1 : item.indexOf('"', open + 6);
    const end = close < 0 ? -1 : item.indexOf('</a>', close);
    if (end < 0) continue;
    const url = linkOn(site, decodeEntities(item.slice(open + 6, close)));
    const [one, id] = url ? segments(url) : [];
    if (!url || one !== 'apply' || !id || !/^[A-Za-z0-9]{1,40}$/.test(id)) continue;
    const after = (icon: string) => {
      const from = item.indexOf(icon, end);
      const start = from < 0 ? -1 : item.indexOf('</i>', from);
      const stop = start < 0 ? -1 : item.indexOf('</li>', start);
      return stop < 0 ? null : htmlToText(item.slice(start + 4, stop));
    };
    const each = job({
      id,
      title: listLine(htmlToText(item.slice(item.indexOf('>', close) + 1, end))),
      location: listLine(after('fa-map-marker')),
      team: listLine(after('fa-sitemap')),
      link: url.href,
    });
    if (each) found.push(each);
  }
  return found;
}

/**
 * The value of a page's "window.pageData = {...}", read to where its outer braces close, without
 * looking at any character twice. Null for a page without one, or one that doesn't parse.
 */
function pageData(html: string): unknown {
  const mark = html.indexOf('window.pageData');
  const start = mark < 0 ? -1 : html.indexOf('{', mark);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Every open job a board's API answered with. */
export function readBoard(source: BoardSource, answer: unknown): BoardJob[] {
  switch (source.kind) {
    case 'greenhouse':
      return list(field(answer, 'jobs')).flatMap(
        (each) =>
          job({
            id: id(field(each, 'id')),
            title: text(field(each, 'title')),
            location: text(field(field(each, 'location'), 'name')),
            team: text(field(list(field(each, 'departments'))[0], 'name')),
            link: text(field(each, 'absolute_url')),
            posted: day(field(each, 'first_published')) ?? day(field(each, 'updated_at')),
            text: htmlToText(decodeEntities(text(field(each, 'content')) ?? '')),
          }) ?? [],
      );
    case 'lever':
      return list(answer).flatMap((each) => {
        const categories = field(each, 'categories');
        const sections = list(field(each, 'lists')).flatMap((section) => [
          '',
          `## ${text(field(section, 'text')) ?? ''}`,
          htmlToText(text(field(section, 'content')) ?? ''),
        ]);
        return (
          job({
            id: id(field(each, 'id')),
            title: text(field(each, 'text')),
            location: text(field(categories, 'location')),
            workplace: workplace(field(each, 'workplaceType')),
            team: text(field(categories, 'team')) ?? text(field(categories, 'department')),
            pay: leverPay(field(each, 'salaryRange')),
            link: text(field(each, 'hostedUrl')),
            posted: day(field(each, 'createdAt')),
            text: lines(
              text(field(each, 'descriptionPlain')),
              ...sections,
              '',
              text(field(each, 'additionalPlain')),
            ),
          }) ?? []
        );
      });
    case 'ashby':
      return list(field(answer, 'jobs')).flatMap((each) => {
        if (field(each, 'isListed') === false) return [];
        const compensation = field(each, 'compensation');
        return (
          job({
            id: id(field(each, 'id')),
            title: text(field(each, 'title')),
            location: text(field(each, 'location')),
            workplace:
              workplace(field(each, 'workplaceType')) ??
              (field(each, 'isRemote') === true ? 'Remote' : null),
            team: text(field(each, 'team')) ?? text(field(each, 'department')),
            pay:
              text(field(compensation, 'compensationTierSummary')) ??
              text(field(compensation, 'scrapeableCompensationSalarySummary')),
            link: text(field(each, 'jobUrl')),
            posted: day(field(each, 'publishedAt')),
            text:
              text(field(each, 'descriptionPlain')) ??
              htmlToText(text(field(each, 'descriptionHtml')) ?? ''),
          }) ?? []
        );
      });
    case 'gem':
      return list(answer).flatMap(
        (each) =>
          job({
            id: id(field(each, 'id')),
            title: text(field(each, 'title')),
            location: text(field(field(each, 'location'), 'name')),
            workplace: workplace(field(each, 'location_type')),
            team: text(field(list(field(each, 'departments'))[0], 'name')),
            link: text(field(each, 'absolute_url')),
            posted: day(field(each, 'first_published_at')) ?? day(field(each, 'updated_at')),
            // Its plain text breaks lines at every link, so the HTML reads better.
            text:
              htmlToText(text(field(each, 'content')) ?? '') ||
              (text(field(each, 'content_plain')) ?? ''),
          }) ?? [],
      );
    case 'smartrecruiters':
      return list(field(answer, 'content')).flatMap((each) => {
        const posting = id(field(each, 'id'));
        const place = field(each, 'location');
        const link =
          posting &&
          `https://jobs.smartrecruiters.com/${encodeURIComponent(source.board)}/${encodeURIComponent(posting)}`;
        return (
          job({
            id: posting,
            title: listLine(text(field(each, 'name'))),
            location: listLine(placeWords(text(field(place, 'fullLocation')))),
            workplace:
              field(place, 'remote') === true
                ? 'Remote'
                : field(place, 'hybrid') === true
                  ? 'Hybrid'
                  : null,
            team: listLine(
              text(field(field(each, 'department'), 'label')) ??
                text(field(field(each, 'function'), 'label')),
            ),
            link,
            posted: day(field(each, 'releasedDate')),
          }) ?? []
        );
      });
    case 'recruitee':
      return list(field(answer, 'offers')).flatMap((each) => {
        const slug = text(field(each, 'slug'));
        const salary = field(each, 'salary');
        const status = text(field(each, 'status'));
        if (status && status !== 'published') return [];
        return (
          job({
            id: slug,
            title: listLine(text(field(each, 'title'))),
            location: listLine(text(field(each, 'location'))),
            workplace:
              field(each, 'remote') === true
                ? 'Remote'
                : field(each, 'hybrid') === true
                  ? 'Hybrid'
                  : field(each, 'on_site') === true
                    ? 'On-site'
                    : null,
            team: listLine(text(field(each, 'department'))),
            pay: payRange(
              field(salary, 'min'),
              field(salary, 'max'),
              field(salary, 'currency'),
              field(salary, 'period'),
            ),
            link: slug && `https://${source.board}.recruitee.com/o/${encodeURIComponent(slug)}`,
            posted: day(field(each, 'published_at')),
            closes: day(field(each, 'close_at')) ?? undefined,
            text: lines(
              htmlToText(text(field(each, 'description')) ?? ''),
              '',
              htmlToText(text(field(each, 'requirements')) ?? ''),
            ).trim(),
          }) ?? []
        );
      });
    case 'workable':
      return list(field(answer, 'jobs')).flatMap((each) => {
        const code = text(field(each, 'shortcode'));
        const place = [field(each, 'city'), field(each, 'state'), field(each, 'country')]
          .map(text)
          .filter(Boolean)
          .join(', ');
        return (
          job({
            id: code,
            title: listLine(text(field(each, 'title'))),
            location: listLine(place),
            workplace: field(each, 'telecommuting') === true ? 'Remote' : null,
            team: listLine(text(field(each, 'department'))),
            link:
              code &&
              `https://apply.workable.com/${encodeURIComponent(source.board)}/j/${encodeURIComponent(code)}/`,
            posted: day(field(each, 'published_on')),
            text: htmlToText(text(field(each, 'description')) ?? ''),
          }) ?? []
        );
      });
    case 'jazzhr':
      return jazzhrJobs(source, answer);
    case 'paylocity': {
      const data = typeof answer === 'string' ? pageData(answer) : null;
      const company = listLine(text(field(data, 'ModuleTitle'))) ?? undefined;
      return list(field(data, 'Jobs')).flatMap((each) => {
        const posting = id(field(each, 'JobId'));
        if (field(each, 'IsInternal') === true || !posting || !/^\d{1,12}$/.test(posting)) {
          return [];
        }
        const place = field(each, 'JobLocation');
        const city = [text(field(place, 'City')), text(field(place, 'State'))]
          .filter(Boolean)
          .join(', ');
        return (
          job({
            id: posting,
            title: listLine(text(field(each, 'JobTitle'))),
            company,
            location: listLine(city || text(field(each, 'LocationName'))),
            workplace: field(each, 'IsRemote') === true ? 'Remote' : null,
            team: listLine(text(field(each, 'HiringDepartment'))),
            link: paylocityJobPage(posting),
            posted: day(field(each, 'PublishedDate')),
            text: htmlToText(text(field(each, 'Description')) ?? ''),
          }) ?? []
        );
      });
    }
    case 'oracle':
      return list(field(list(field(answer, 'items'))[0], 'requisitionList')).flatMap((each) => {
        const posting = id(field(each, 'Id'));
        const others = list(field(each, 'secondaryLocations')).length;
        const primary = listLine(text(field(each, 'PrimaryLocation')));
        const link =
          posting &&
          `https://${source.site}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(source.board)}/job/${encodeURIComponent(posting)}`;
        return (
          job({
            id: posting,
            title: listLine(text(field(each, 'Title'))),
            location: primary && others > 0 ? `${primary}, and ${others} more` : primary,
            workplace: workplace(field(each, 'WorkplaceType')),
            team: listLine(text(field(each, 'Department')) ?? text(field(each, 'Organization'))),
            link,
            posted: day(field(each, 'PostedDate')),
            closes: day(field(each, 'PostingEndDate')) ?? undefined,
            text: text(field(each, 'ShortDescriptionStr')) ?? '',
          }) ?? []
        );
      });
    case 'workday':
      return workdayJobs(source, answer);
    case 'icims':
      return icimsJobs(source, answer);
  }
}

/** The words of a title or a link, as narrowing compares them: lowercase, no accents, no final "s". */
function titleWords(title: string): string[] {
  const words =
    title
      .slice(0, 400)
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word));
}

/**
 * A test of whether a title fits any of the wanted ones: it has all of one's words, in any order,
 * as "Manager, Program Operations" fits "program manager". It goes by whole words, so "RN" doesn't
 * fit "Intern". With nothing wanted, every title fits.
 */
export function titleFilter(wanted: readonly string[]): (title: string) => boolean {
  const asked = wanted.map(titleWords).filter((words) => words.length > 0);
  if (asked.length === 0) return () => true;
  return (title) => {
    const words = new Set(titleWords(title));
    return asked.some((each) => each.every((word) => words.has(word)));
  };
}

/** Where a job is, and whether it's remote, without saying "Remote" twice. */
function whereOf(each: BoardJob): string {
  const { location, workplace } = each;
  if (location && workplace && location.toLowerCase().includes(workplace.toLowerCase())) {
    return location;
  }
  return [location, workplace].filter(Boolean).join(', ');
}

/**
 * A job in one line, for a listing: its title, who's hiring when a source has many employers,
 * where, pay, when it was posted and closes, and its link.
 */
export function boardJobLine(each: BoardJob): string {
  return [
    each.title,
    each.company,
    whereOf(each),
    each.pay,
    each.posted && `posted ${each.posted}`,
    each.closes && `closes ${each.closes}`,
    each.changed && `changed ${each.changed}`,
    each.note,
    each.link,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What was read, as one Markdown file: a heading, where it's from, then each job under its own. */
export function jobsMarkdown(
  heading: string,
  source: string,
  saved: string,
  jobs: readonly BoardJob[],
): string {
  const parts = [`# ${heading}`, '', `- **Source:** ${source}`, `- **Saved:** ${saved}`];
  jobs.forEach((each, i) => {
    parts.push(
      '',
      `## ${i + 1}. ${each.title}`,
      '',
      ...[
        ['Company', each.company],
        ['Where', whereOf(each)],
        ['Team', each.team],
        ['Pay', each.pay],
        ['Posted', each.posted],
        ['Closes', each.closes],
        ['Changed', each.changed],
        ['Note', each.note],
        ['Link', each.link],
      ].flatMap(([label, value]) => (value ? [`- **${label}:** ${value}`] : [])),
      '',
      each.text,
    );
  });
  return `${parts.join('\n')}\n`;
}

/** A board's open jobs as one Markdown file, every posting word for word where the board gives it. */
export function boardMarkdown(
  source: BoardSource,
  jobs: readonly BoardJob[],
  savedOn: string,
): string {
  const count = `${jobs.length} open ${jobs.length === 1 ? 'job' : 'jobs'}`;
  const how = boardFromSitemap(source)
    ? 'from its sitemap, each by the words in its link'
    : boardHasText(source)
      ? 'word for word'
      : 'as the board lists them, without each posting’s full text';
  return jobsMarkdown(
    `${boardSystem(source)} board: ${boardName(source)}`,
    boardRequest(source),
    `${savedOn} by Factwright, ${count}, ${how}`,
    jobs,
  );
}
