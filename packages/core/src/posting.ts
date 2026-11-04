/** Where a posting's text can be read from: an applicant system's public API, or the page itself. */
export type PostingSource =
  /** With `guessed`, the boards are guesses from a company's site's name, not the link's own. */
  | { kind: 'greenhouse'; boards: string[]; id: string; guessed?: true }
  | { kind: 'lever'; company: string; id: string }
  | { kind: 'gem'; board: string; id: string }
  | { kind: 'ashby'; board: string; id: string }
  | { kind: 'recruitee'; board: string; id: string }
  | { kind: 'workable'; board: string; id: string }
  | { kind: 'page'; url: string };

/** A request for one source: the address, and whether it answers in JSON. */
export interface PostingRequest {
  url: string;
  json: boolean;
}

const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
};

/** A character by its number, or "�" for a number past the last one, which can't be shown. */
const character = (code: number) => (code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd');

/** Turns HTML entities such as "&amp;" and "&#8217;" back into the characters they stand for. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => character(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => character(Number(decimal)))
    .replace(
      /&(nbsp|amp|lt|gt|quot|apos|#39|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip|bull);/g,
      (_, name: string) => ENTITIES[name] ?? '',
    );
}

/*
 * Pages come from anywhere, so everything that reads them does so in one pass. A pattern such as
 * /<nav[\s\S]*?<\/nav>/ reads to the end of the page again for each tag left open, which a page
 * with many of them would make take minutes.
 */

/** What a page shows besides its own words: scripts, styles, navigation and forms. */
const DROPPED = ['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'form', 'button'];

/**
 * HTML with each dropped element, from its opening tag to the first closing one after it, made a
 * space. One left open stays, and so does every later one of its kind, which nothing closes.
 */
function withoutDropped(html: string): string {
  const opening = new RegExp(`<(${DROPPED.join('|')})`, 'gi');
  const closings = new Map(DROPPED.map((name) => [name, new RegExp(`</${name}>`, 'gi')]));
  const unclosed = new Set<string>();
  let kept = '';
  let at = 0;
  for (let open = opening.exec(html); open; open = opening.exec(html)) {
    const name = (open[1] ?? '').toLowerCase();
    const closing = closings.get(name);
    if (!closing || unclosed.has(name)) continue;
    closing.lastIndex = opening.lastIndex;
    if (!closing.exec(html)) {
      unclosed.add(name);
      continue;
    }
    kept += `${html.slice(at, open.index)} `;
    at = closing.lastIndex;
    opening.lastIndex = at;
  }
  return kept + html.slice(at);
}

/**
 * HTML with each tag that `opening` starts, up to the next ">", made what `replace` gives, as
 * /<li[^>]*>/gi would take them. Once a tag has no ">" after it, no later one does either.
 */
function replaceTags(
  html: string,
  opening: RegExp,
  replace: (open: RegExpExecArray) => string,
): string {
  const open = new RegExp(opening.source, 'gi');
  let kept = '';
  let at = 0;
  for (let found = open.exec(html); found; found = open.exec(html)) {
    const close = html.indexOf('>', open.lastIndex);
    if (close < 0) break;
    kept += html.slice(at, found.index) + replace(found);
    at = close + 1;
    open.lastIndex = at;
  }
  return kept + html.slice(at);
}

/** Text with its tags taken out: each "<" up to the next ">", with something between them. */
export function withoutTags(html: string): string {
  let kept = '';
  let at = 0;
  let from = 0;
  for (let open = html.indexOf('<', from); open >= 0; open = html.indexOf('<', from)) {
    const close = html.indexOf('>', open + 1);
    if (close < 0) break;
    from = close + 1;
    // "<>" isn't a tag.
    if (close === open + 1) continue;
    kept += html.slice(at, open);
    at = from;
  }
  return kept + html.slice(at);
}

/**
 * Plain text from HTML, keeping its shape: paragraphs, list items as "- ", and headings as
 * Markdown "##". Scripts, styles, navigation and forms are dropped.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    withoutTags(
      replaceTags(
        replaceTags(withoutDropped(html).replace(/<br\s*\/?>/gi, '\n'), /<li/, () => '\n- '),
        /<h([1-6])/,
        (open) => `\n\n${'#'.repeat(Math.min(6, Number(open[1]) + 1))} `,
      )
        // List items already start on their own line. A list ends with a blank line, so the next
        // paragraph isn't read as part of its last item.
        .replace(/<\/(ul|ol)>/gi, '\n\n')
        .replace(/<\/(p|div|section|article|h[1-6]|tr|table|header)>/gi, '\n'),
    ),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The sites of the applicant systems' public feeds for postings. */
const FEED_HOSTS =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|gem\.com|recruitee\.com|workable\.com)$/;

/** Whether a feed for postings is still on an applicant system's own site, after a redirect. */
export const onFeedSite = (address: string) => FEED_HOSTS.test(new URL(address).hostname);

/** Which source to read a posting from, by its address. */
export function postingSource(address: string): PostingSource {
  const url = new URL(address);
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname;

  // The path's parts, when the host is the given one.
  const on = (test: boolean, pattern: RegExp) => (test ? path.match(pattern) : null);

  const greenhouse = on(/(^|\.)greenhouse\.io$/.test(host), /^\/([^/]+)\/jobs\/(\d+)/);
  if (greenhouse?.[1] && greenhouse[2]) {
    return { kind: 'greenhouse', boards: [greenhouse[1]], id: greenhouse[2] };
  }
  // A company's own careers page can embed a Greenhouse job, named by its gh_jid.
  const embedded = url.searchParams.get('gh_jid');
  if (embedded && /^\d+$/.test(embedded)) {
    const parts = host.split('.');
    const boards = [...new Set([parts[0] ?? '', parts.slice(0, -1).join('')])].filter(Boolean);
    return { kind: 'greenhouse', boards, id: embedded, guessed: true };
  }
  const lever = on(host === 'jobs.lever.co', /^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (lever?.[1] && lever[2]) return { kind: 'lever', company: lever[1], id: lever[2] };
  const gem = on(host === 'jobs.gem.com', /^\/([^/]+)\/([\w-]+)/);
  if (gem?.[1] && gem[2]) return { kind: 'gem', board: gem[1], id: gem[2] };
  const ashby = on(host === 'jobs.ashbyhq.com', /^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (ashby?.[1] && ashby[2]) return { kind: 'ashby', board: ashby[1], id: ashby[2] };
  const recruiteeHost = /^([a-z0-9-]{1,63})\.recruitee\.com$/.exec(host)?.[1];
  const recruitee = on(Boolean(recruiteeHost), /^\/(?:l\/[\w-]{1,20}\/)?o\/([\w-]{1,200})(?:\/|$)/);
  if (recruiteeHost && recruitee?.[1]) {
    return { kind: 'recruitee', board: recruiteeHost, id: recruitee[1] };
  }
  const workable = on(
    host === 'apply.workable.com',
    /^\/([\w-]{1,100})\/j\/([A-Za-z0-9]{1,40})(?:\/|$)/,
  );
  if (workable?.[1] && workable[2] && workable[1] !== 'j') {
    return { kind: 'workable', board: workable[1], id: workable[2] };
  }
  return { kind: 'page', url: url.href };
}

/** Query parameters that track a visit, or page through, sort or search a list, rather than name a job. */
const NOT_A_JOB =
  /^(utm_\w*|gclid|fbclid|msclkid|ref|referrer|source|src|trk\w*|lang|locale|page|p|offset|limit|start|from|size|sort|q|query|keywords?|search)$/i;

/** What the last part of a list's own address says, as /careers or /open-positions. */
const LIST_PAGES = new Set([
  'careers',
  'career',
  'jobs',
  'job',
  'openings',
  'open-positions',
  'open-jobs',
  'all-jobs',
  'job-openings',
  'current-openings',
  'positions',
  'vacancies',
  'opportunities',
  'career-opportunities',
  'job-opportunities',
  'join',
  'join-us',
  'work-with-us',
  'job-search',
  'search-jobs',
  'search',
  'results',
]);

/**
 * Whether a page's address names one job's posting rather than a list of jobs, such as a
 * company's board or careers page. On an applicant system with a public feed, it's a link its feed
 * reads one posting by. Anywhere else, one with a number in its path, as /jobs/4751/… or
 * /senior-engineer-2110, a last part of words that isn't a list's own, as /senior-engineer, or a
 * number in its query that tracks nothing, as ?id=42.
 */
export function namesOnePosting(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (onFeedSite(address)) return postingSource(address).kind !== 'page';
  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (parts.some((part) => /\d/.test(part))) return true;
  const last = parts.at(-1) ?? '';
  if (last && !LIST_PAGES.has(last) && /[-_]/.test(last)) return true;
  const query = url.search.slice(1).split('&');
  return query.some((pair) => {
    const [name = '', value = ''] = pair.split('=', 2);
    return !NOT_A_JOB.test(name) && /\d/.test(value);
  });
}

/** The requests to try for a source, in order, until one answers. */
export function postingRequests(source: PostingSource): PostingRequest[] {
  const part = encodeURIComponent;
  switch (source.kind) {
    case 'greenhouse':
      return source.boards.map((board) => ({
        url: `https://boards-api.greenhouse.io/v1/boards/${part(board)}/jobs/${part(source.id)}`,
        json: true,
      }));
    case 'lever':
      return [
        {
          url: `https://api.lever.co/v0/postings/${part(source.company)}/${part(source.id)}`,
          json: true,
        },
      ];
    case 'gem':
      return [
        {
          url: `https://api.gem.com/job_board/v0/${part(source.board)}/job_posts/${part(source.id)}`,
          json: true,
        },
      ];
    case 'ashby':
      return [
        {
          url: `https://api.ashbyhq.com/posting-api/job-board/${part(source.board)}?includeCompensation=true`,
          json: true,
        },
      ];
    case 'recruitee':
      return [
        {
          url: `https://${part(source.board)}.recruitee.com/api/offers/${part(source.id)}`,
          json: true,
        },
      ];
    case 'workable':
      return [
        {
          url: `https://apply.workable.com/api/v2/accounts/${part(source.board)}/jobs/${part(source.id)}`,
          json: true,
        },
      ];
    case 'page':
      return [{ url: pageAddress(source.url), json: false }];
  }
}

/**
 * A Workday posting's own link, from a link to its page for applying, which can say a posting has
 * closed when it hasn't. It looks at each part of the path once, so a long link takes as long as
 * it is long.
 */
function withoutApply(address: string): string {
  const end = address.search(/[?#]/);
  const path = end < 0 ? address : address.slice(0, end);
  const parts = path.split('/');
  // The parts before these are the scheme, the gap after it, and the host.
  const at = parts.findIndex((part, index) => index > 2 && part.toLowerCase() === 'apply');
  return at < 0 ? address : parts.slice(0, at).join('/') + address.slice(path.length);
}

/**
 * Where to read a page. An iCIMS posting's page is little more than a frame that loads the posting
 * later, so reading it gets next to nothing. Asked for the frame's own view, it gives the posting
 * in full, with its JobPosting data.
 */
function pageAddress(address: string): string {
  if (onWorkday(address)) return withoutApply(address);
  const url = new URL(address);
  if (!/(^|\.)icims\.com$/i.test(url.hostname) || !url.pathname.startsWith('/jobs/')) {
    return address;
  }
  if (/[?&]in_iframe=/.test(url.search)) return address;
  const base = url.hash ? url.href.slice(0, -url.hash.length) : url.href;
  return `${base}${url.search ? '&' : '?'}in_iframe=1${url.hash}`;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const field = (value: unknown, key: string) => (isObject(value) ? value[key] : undefined);
const lines = (...parts: (string | null | undefined)[]) =>
  parts
    .filter((part): part is string => part !== null && part !== undefined)
    .join('\n')
    .trim();

/** A posting, as plain text, and how it was read. */
export interface Posting {
  text: string;
  via: string;
  /** The page itself says the posting has closed, so it has no text. */
  closed?: true;
  /** The job's title, as the applicant system or the page's job data gives it. */
  title?: string;
  /** The employer's name, as the applicant system or the page's job data gives it. */
  company?: string;
}

/** The applicant systems with public feeds for postings, by name. */
export const FEED_SYSTEMS: Readonly<Record<Exclude<PostingSource['kind'], 'page'>, string>> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  gem: 'Gem',
  ashby: 'Ashby',
  recruitee: 'Recruitee',
  workable: 'Workable',
};

/** A title or a name as one trimmed line, or null when there's none. */
function oneLine(value: unknown, longest: number): string | null {
  const line = typeof value === 'string' ? decodeEntities(value).replace(/\s+/g, ' ').trim() : '';
  return line ? line.slice(0, longest) : null;
}

/** A posting's title and employer, those that are known, as a Posting holds them. */
function titled(title: unknown, company?: unknown): Pick<Posting, 'title' | 'company'> {
  const job = oneLine(title, 300);
  const by = oneLine(company, 200);
  return { ...(job && { title: job }), ...(by && { company: by }) };
}

/**
 * A Workday posting's page holds only its job data and a script that says whether it's open. Once
 * it has closed, the page still answers as usual, with this in place of the job data.
 */
const WORKDAY_CLOSED = /\bpostingAvailable\s*:\s*false\b/;

const onWorkday = (address: string) =>
  /(^|\.)myworkday(jobs|site)\.com$/i.test(new URL(address).hostname);

/**
 * A Workday legal entity's code before its name, as "2100 " in "2100 NVIDIA USA" or "ADUS-" in
 * "ADUS-Adobe Inc.", as the extension reads it too.
 */
const WORKDAY_ENTITY = /^(\d+\s+|[A-Z]{2,}\d+\s+|[A-Z\d]{2,8}\s*[-:]\s*|[A-Z][a-z]+:\s+)/;

/**
 * Who a Workday posting's job data says is hiring, which names the legal entity: the site's own
 * name, as the entity writes it ("NVIDIA" at nvidia.wd5.myworkdayjobs.com) but with a capital, or
 * else the entity without its code.
 */
function workdayEmployer(name: string, address: string): string {
  const tenant = new URL(address).hostname.split('.', 1)[0] ?? '';
  const own = name.split(/[^\p{L}\p{N}]+/u).find((word) => word.toLowerCase() === tenant);
  return own ? own.charAt(0).toUpperCase() + own.slice(1) : name.replace(WORKDAY_ENTITY, '');
}

const onTaleo = (address: string) => /(^|\.)taleo\.net$/i.test(new URL(address).hostname);

/** The hidden field a Taleo posting's page keeps the posting in. */
const TALEO_FIELD = 'name="initialHistory"';

/** One part of what a Taleo page keeps: URL-encoded, with a backslash before a character it escapes, as "\:". */
function taleoPart(part: string): string {
  let decoded = part;
  try {
    decoded = decodeURIComponent(part);
  } catch {
    // A part that isn't encoded as it should be is read as it is.
  }
  return decoded.replace(/\\(.)/g, '$1');
}

/**
 * The value of the hidden field a Taleo posting's page keeps the posting in: the first input tag
 * that names it, whatever the page's scripts say of it. It reads each input tag once, from its
 * "<input" to the next ">", and once a tag has no ">" after it, no later one does either.
 */
function taleoField(html: string): string | null {
  const opening = /<input\b/gi;
  for (let found = opening.exec(html); found; found = opening.exec(html)) {
    const end = html.indexOf('>', opening.lastIndex);
    if (end < 0) return null;
    const tag = html.slice(found.index, end);
    opening.lastIndex = end + 1;
    if (!tag.includes(TALEO_FIELD)) continue;
    const value = /\bvalue="([^"]*)"/.exec(tag)?.[1];
    if (value) return value;
  }
  return null;
}

/**
 * A Taleo posting, from its page. What the page shows is only the site's menus: the posting is in
 * a hidden field, initialHistory, that the page's script shows it from. Its value is the posting's
 * parts between "!|!": its title, its number, then each block of it as HTML, starting "!*!", each
 * there twice. Null for a page without one.
 */
function taleoPosting(html: string): Posting | null {
  const value = taleoField(html);
  const parts = value ? decodeEntities(value).split('!|!').map(taleoPart) : [];
  const first = parts.findIndex((part) => part.startsWith('!*!'));
  const blocks = [
    ...new Set(
      parts.filter((part) => part.startsWith('!*!')).map((part) => htmlToText(part.slice(3))),
    ),
  ].filter(Boolean);
  if (blocks.length === 0) return null;
  const title = first >= 2 ? (parts[first - 2] ?? '') : '';
  const known = title.length <= 300 && !/^(true|false|\d*)$/.test(title) && !title.includes('!$!');
  return {
    text: lines(known ? title : null, '', blocks.join('\n\n')),
    via: 'Taleo',
    ...(known && titled(title)),
  };
}

/** Job data shorter than this, in characters, may be a teaser for what's on the page. */
const FULL_JOB_DATA = 1500;

/** How a page is read when it has no job data: its own text, which may be any page's. */
export const PAGE_TEXT = 'the web page';

/**
 * Reads a posting from what its source answered: the API's JSON, or the page's HTML. A page
 * gives its schema.org JobPosting data when it has some, and otherwise its main text.
 */
export function readPosting(source: PostingSource, answer: unknown): Posting | null {
  switch (source.kind) {
    case 'greenhouse': {
      const content = text(field(answer, 'content'));
      if (!content) return null;
      const body = htmlToText(decodeEntities(content));
      return {
        text: lines(
          text(field(answer, 'title')),
          text(field(field(answer, 'location'), 'name')),
          '',
          body,
        ),
        via: 'Greenhouse API',
        ...titled(field(answer, 'title'), field(answer, 'company_name')),
      };
    }
    case 'lever': {
      const lists = Array.isArray(field(answer, 'lists'))
        ? (field(answer, 'lists') as unknown[])
        : [];
      const sections = lists.flatMap((list) => [
        '',
        `## ${text(field(list, 'text')) ?? ''}`,
        htmlToText(text(field(list, 'content')) ?? ''),
      ]);
      const description = text(field(answer, 'description'));
      if (!description && sections.length === 0) return null;
      return {
        text: lines(
          text(field(answer, 'text')),
          text(field(field(answer, 'categories'), 'location')),
          '',
          htmlToText(description ?? ''),
          ...sections,
          '',
          htmlToText(text(field(answer, 'additional')) ?? ''),
        ),
        via: 'Lever API',
        ...titled(field(answer, 'text')),
      };
    }
    case 'gem': {
      const content = text(field(answer, 'content'));
      if (!content) return null;
      const where = [
        text(field(field(answer, 'location'), 'name')),
        text(field(answer, 'location_type')),
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        text: lines(text(field(answer, 'title')), where || null, '', htmlToText(content)),
        via: 'Gem API',
        ...titled(field(answer, 'title')),
      };
    }
    case 'ashby': {
      const jobs = field(answer, 'jobs');
      const job = Array.isArray(jobs) ? jobs.find((each) => field(each, 'id') === source.id) : null;
      if (!job) return null;
      const pay =
        text(field(field(job, 'compensation'), 'compensationTierSummary')) ??
        text(field(field(job, 'compensation'), 'scrapeableCompensationSalarySummary'));
      const body =
        text(field(job, 'descriptionPlain')) ??
        htmlToText(text(field(job, 'descriptionHtml')) ?? '');
      return {
        text: lines(
          text(field(job, 'title')),
          text(field(job, 'location')),
          pay ? `Compensation: ${pay}` : null,
          '',
          body,
        ),
        via: 'Ashby API',
        ...titled(field(job, 'title')),
      };
    }
    case 'recruitee': {
      const offer = field(answer, 'offer');
      const description = text(field(offer, 'description'));
      if (!description) return null;
      return {
        text: lines(
          text(field(offer, 'title')),
          text(field(offer, 'location')),
          '',
          htmlToText(description),
          '',
          htmlToText(text(field(offer, 'requirements')) ?? ''),
        ),
        via: 'Recruitee API',
        ...titled(field(offer, 'title'), field(offer, 'company_name')),
      };
    }
    case 'workable': {
      const description = text(field(answer, 'description'));
      if (!description) return null;
      const place = field(answer, 'location');
      return {
        text: lines(
          text(field(answer, 'title')),
          [text(field(place, 'city')), text(field(place, 'region')), text(field(place, 'country'))]
            .filter(Boolean)
            .join(', ') || null,
          field(answer, 'remote') === true ? 'Remote' : null,
          '',
          htmlToText(description),
          '',
          htmlToText(text(field(answer, 'requirements')) ?? ''),
          '',
          htmlToText(text(field(answer, 'benefits')) ?? ''),
        ),
        via: 'Workable API',
        ...titled(field(answer, 'title')),
      };
    }
    case 'page': {
      if (typeof answer !== 'string') return null;
      if (onWorkday(source.url) && WORKDAY_CLOSED.test(answer)) {
        return { text: '', via: 'Workday', closed: true };
      }
      const job = jobPostingFields(answer);
      if (onTaleo(source.url)) {
        const taleo = taleoPosting(answer);
        if (taleo) return taleo;
        // A posting's page without the posting in its field, nor job data, has only the site's
        // menus to read, which are never the posting.
        if (!job && /\/jobdetail\.ftl$/i.test(new URL(source.url).pathname)) {
          return { text: '', via: 'Taleo' };
        }
      }
      const data = job && jobPostingText(job);
      const hiring =
        job?.company && onWorkday(source.url)
          ? workdayEmployer(job.company, source.url)
          : job?.company;
      const known = job ? titled(job.title, hiring) : {};
      if (data && data.length >= FULL_JOB_DATA) {
        return { text: data, via: 'the page’s JobPosting data', ...known };
      }
      const main = htmlToText(
        element(answer, 'main') ??
          element(answer, 'article') ??
          element(answer, 'body', true) ??
          answer,
      );
      if (!data) return { text: main, via: PAGE_TEXT };
      // Some job data holds only a teaser, as USAJOBS's does, with the posting on the page itself.
      return main.length > data.length
        ? { text: lines(data, '', main), via: 'the page’s JobPosting data and its text', ...known }
        : { text: data, via: 'the page’s JobPosting data', ...known };
    }
  }
}

/**
 * A page's first element of a kind, from its opening tag to the first closing tag after it, or,
 * with `toLast`, to the last one.
 */
function element(html: string, name: string, toLast = false): string | null {
  const open = new RegExp(`<${name}`, 'i').exec(html);
  if (!open) return null;
  const closing = new RegExp(`</${name}>`, 'gi');
  closing.lastIndex = open.index + name.length + 1;
  let end = -1;
  for (let close = closing.exec(html); close; close = toLast ? closing.exec(html) : null) {
    end = closing.lastIndex;
  }
  return end < 0 ? null : html.slice(open.index, end);
}

/** A script's type, when it's JSON-LD. Some sites entity-encode the "+" in it. */
const JSON_LD_TYPE = /application\/ld(?:\+|&#x2B;|&#43;)json/i;

/**
 * What's inside each JSON-LD script on a page, in order, as
 * /<script[^>]+application\/ld(?:\+|&#x2B;|&#43;)json[^>]*>([\s\S]*?)<\/script>/gi would find it.
 */
function jsonLdScripts(html: string): string[] {
  const opening = /<script/gi;
  const closing = /<\/script>/gi;
  const found: string[] = [];
  for (let open = opening.exec(html); open; open = opening.exec(html)) {
    const end = html.indexOf('>', opening.lastIndex);
    if (end < 0) break;
    // The type comes after at least one other character of the tag. Another "<script" before
    // this tag's ">" ends there too, so it's no more JSON-LD than this one.
    const jsonLd = JSON_LD_TYPE.test(html.slice(opening.lastIndex + 1, end));
    opening.lastIndex = end + 1;
    if (!jsonLd) continue;
    closing.lastIndex = end + 1;
    const close = closing.exec(html);
    // Nothing closes this script, so nothing closes any after it either.
    if (!close) break;
    found.push(html.slice(end + 1, close.index));
    opening.lastIndex = closing.lastIndex;
  }
  return found;
}

/** A date in a page's job data, without its time: "2026-07-01T04:00:00Z" reads as 2026-07-01. */
function day(value: unknown): string | null {
  const date = text(value)?.trim();
  if (!date) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : date.slice(0, 40);
}

/** What a page's schema.org JobPosting data says. */
export interface JobPostingFields {
  title: string | null;
  company: string | null;
  /** "Remote", or the places it names. */
  where: string | null;
  pay: string | null;
  posted: string | null;
  closes: string | null;
  /** The posting, as plain text. */
  text: string;
}

/** Most job pages embed schema.org JobPosting data, which reads cleaner than the page. */
export function jobPostingData(html: string): string | null {
  const job = jobPostingFields(html);
  return job && jobPostingText(job);
}

/** A page's JobPosting data as the posting's text, with its title, employer, place and dates on top. */
function jobPostingText(job: JobPostingFields): string {
  return lines(
    job.title,
    job.company,
    job.where,
    job.pay ? `Pay: ${job.pay}` : null,
    job.posted ? `Posted: ${job.posted}` : null,
    job.closes ? `Closes: ${job.closes}` : null,
    '',
    job.text,
  );
}

/** What a page's JobPosting data says, for the first with a description. Null for a page with none. */
export function jobPostingFields(html: string): JobPostingFields | null {
  for (const raw of jsonLdScripts(html)) {
    let data: unknown;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    const graph = field(data, '@graph');
    const items = [
      data,
      ...(Array.isArray(data) ? data : []),
      ...(Array.isArray(graph) ? graph : []),
    ];
    const job = items.find((item) => {
      const type = field(item, '@type');
      return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
    });
    const description = text(field(job, 'description'));
    if (!job || !description) continue;
    const locations = field(job, 'jobLocation');
    const places = (Array.isArray(locations) ? locations : [locations])
      .map((place) => {
        const address = field(place, 'address');
        return [text(field(address, 'addressLocality')), text(field(address, 'addressRegion'))]
          .filter(Boolean)
          .join(', ');
      })
      .filter(Boolean)
      .join('; ');
    const salary = field(field(job, 'baseSalary'), 'value');
    // A page can put anything here, so only a number or some words count as an amount.
    const money = (value: unknown) =>
      typeof value === 'number' || typeof value === 'string' ? String(value) : null;
    const amount = [money(field(salary, 'minValue')), money(field(salary, 'maxValue'))]
      .filter(Boolean)
      .join('–');
    const pay = salary
      ? `${amount || (money(field(salary, 'value')) ?? '')} ${text(field(field(job, 'baseSalary'), 'currency')) ?? ''} ${text(field(salary, 'unitText')) ?? ''}`
          .replace(/\s+/g, ' ')
          .trim()
      : null;
    const remote = field(job, 'jobLocationType') === 'TELECOMMUTE';
    const title = text(field(job, 'title'));
    const company = text(field(field(job, 'hiringOrganization'), 'name'));
    return {
      // Some sites escape these twice, so "Sales &amp; Service" would show as it's written.
      title: title && decodeEntities(title),
      company: company && decodeEntities(company),
      where: remote ? 'Remote' : places || null,
      pay,
      posted: day(field(job, 'datePosted')),
      closes: day(field(job, 'validThrough')),
      text: htmlToText(decodeEntities(description)),
    };
  }
  return null;
}
