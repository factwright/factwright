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

/** Turns HTML entities such as "&amp;" and "&#8217;" back into the characters they stand for. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(
      /&(nbsp|amp|lt|gt|quot|apos|#39|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip|bull);/g,
      (_, name: string) => ENTITIES[name] ?? '',
    );
}

/**
 * Plain text from HTML, keeping its shape: paragraphs, list items as "- ", and headings as
 * Markdown "##". Scripts, styles, navigation and forms are dropped.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|form|button)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(
        /<h([1-6])[^>]*>/gi,
        (_, level: string) => `\n\n${'#'.repeat(Math.min(6, Number(level) + 1))} `,
      )
      // List items already start on their own line. A list ends with a blank line, so the next
      // paragraph isn't read as part of its last item.
      .replace(/<\/(ul|ol)>/gi, '\n\n')
      .replace(/<\/(p|div|section|article|h[1-6]|tr|table|header)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
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
        answer.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
        answer.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
        answer.match(/<body[\s\S]*<\/body>/i)?.[0] ??
        answer;
      return { text: htmlToText(main), via: 'the web page' };
    }
  }
}

/** Most job pages embed schema.org JobPosting data, which reads cleaner than the page. */
export function jobPostingData(html: string): string | null {
  // Some sites entity-encode the "+" in the script's type.
  const scripts = html.matchAll(
    /<script[^>]+application\/ld(?:\+|&#x2B;|&#43;)json[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, raw] of scripts) {
    let data: unknown;
    try {
      data = JSON.parse((raw ?? '').trim());
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
