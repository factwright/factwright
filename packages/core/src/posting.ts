/** Where a posting's text can be read from: an applicant system's public API, or the page itself. */
export type PostingSource =
  | { kind: 'greenhouse'; boards: string[]; id: string }
  | { kind: 'lever'; company: string; id: string }
  | { kind: 'gem'; board: string; id: string }
  | { kind: 'ashby'; board: string; id: string }
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
    return { kind: 'greenhouse', boards, id: embedded };
  }
  const lever = on(host === 'jobs.lever.co', /^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (lever?.[1] && lever[2]) return { kind: 'lever', company: lever[1], id: lever[2] };
  const gem = on(host === 'jobs.gem.com', /^\/([^/]+)\/([\w-]+)/);
  if (gem?.[1] && gem[2]) return { kind: 'gem', board: gem[1], id: gem[2] };
  const ashby = on(host === 'jobs.ashbyhq.com', /^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (ashby?.[1] && ashby[2]) return { kind: 'ashby', board: ashby[1], id: ashby[2] };
  return { kind: 'page', url: url.href };
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
    case 'page':
      return [{ url: source.url, json: false }];
  }
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
}

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
      };
    }
    case 'page': {
      if (typeof answer !== 'string') return null;
      const data = jobPostingData(answer);
      if (data) return { text: data, via: 'the page’s JobPosting data' };
      const main =
        element(answer, 'main') ??
        element(answer, 'article') ??
        element(answer, 'body', true) ??
        answer;
      return { text: htmlToText(main), via: 'the web page' };
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

/** Most job pages embed schema.org JobPosting data, which reads cleaner than the page. */
export function jobPostingData(html: string): string | null {
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
    const amount = [field(salary, 'minValue'), field(salary, 'maxValue')]
      .filter((value) => value !== undefined && value !== null)
      .join('–');
    const pay = salary
      ? `Pay: ${amount || String(field(salary, 'value') ?? '')} ${text(field(field(job, 'baseSalary'), 'currency')) ?? ''} ${text(field(salary, 'unitText')) ?? ''}`
          .replace(/\s+/g, ' ')
          .trim()
      : null;
    const remote = field(job, 'jobLocationType') === 'TELECOMMUTE';
    return lines(
      text(field(job, 'title')),
      text(field(field(job, 'hiringOrganization'), 'name')),
      remote ? 'Remote' : places || null,
      pay,
      '',
      htmlToText(decodeEntities(description)),
    );
  }
  return null;
}
