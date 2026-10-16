/** A job as the extension read it from the page you're on. */
export interface PageJob {
  /** The job's own address: the page's, without tracking, or the job's own on LinkedIn and Indeed. */
  url: string;
  /** The page's address as it was, which can name a search the job was found in. */
  pageUrl: string;
  /** The site, such as "linkedin.com". */
  site: string;
  /** The page's title in the browser's tab. */
  pageTitle: string;
  /** What the page says the job is called, and who it's with, where and for what pay. */
  title: string;
  company: string;
  location: string;
  pay: string;
  /** Full time, part time, contract and so on, as the page puts it. */
  employment: string;
  /** When it was posted, as the page puts it, such as "2026-10-14". */
  posted: string;
  /** The posting itself, as text. */
  posting: string;
  /**
   * Where the posting's text came from: what you selected, the job's own data, where the job site
   * shows its posting, or, for a page it knows nothing of, the page's main text, which may well not
   * be a posting at all.
   */
  source: 'selection' | 'structured' | 'page' | 'main';
}

/**
 * Reads the job on the page you're on: its address, its posting, and what it can tell of the title,
 * company, place and pay. The extension sends this one function into the page, only when you ask
 * it to, so everything it needs is inside it. The page's job data, which job sites publish for
 * search engines, comes first, then what each big job site shows, then the page's main text, except
 * on LinkedIn, where only the job's own posting is read. Text you've selected stands in for the
 * posting, for a page it can't read well. It reads the page as it is, and changes nothing in it.
 */
export function readJobPage(
  doc: Document = document,
  href: string = location.href,
  selected: string = String(globalThis.getSelection?.() ?? ''),
  /** The address the page loaded at, before a single-page site moved it on to another job. */
  loadedAt: string = doc.defaultView?.performance?.getEntriesByType?.('navigation')[0]?.name ?? '',
  /** Where the selected text starts, which on Hacker News is inside the post it's from. */
  selectedFrom: Node | null = globalThis.getSelection?.()?.anchorNode ?? null,
): PageJob {
  /** The longest posting it keeps, in characters. A long one is around 20,000. */
  const MAX_POSTING = 100_000;
  /** Selected text shorter than this is likely a word or a title, not the posting. */
  const MIN_SELECTION = 200;
  /** Query parameters that only track where a click came from (@factwright/core's links.ts). */
  const TRACKING_PARAM =
    /^(utm_|ref$|src$|source$|from$|tk$|trk|rjptk|xpse|xfps|xkcb|gh_src|lever-)/i;
  /** Job boards and applicant systems, which are never the company a job is with. */
  const BOARDS =
    /^(linkedin|indeed|glassdoor|ziprecruiter|monster|wellfound|angellist|dice|simplyhired|careerbuilder|built ?in|hired|otta|welcome to the jungle|greenhouse|lever|workday|ashby|smartrecruiters|jobvite|icims)(\.com)?$/i;
  /** Words that name a role, as in a job post's first line: "Acme | Senior Engineer | Remote". */
  const ROLE =
    /\b(engineer|developer|dev|swe|designer|manager|pm|scientist|lead|head|director|analyst|architect|researcher|intern|internship|specialist|consultant|administrator|programmer|devops|sre|cto|vp|officer|recruiter|writer|marketer|technician|operator|representative|associate|coordinator|executive|accountant|counsel|attorney|hacker|generalist|founding|roles|positions|openings)s?\b/i;
  /** The code Workday's job data puts before a company's legal name: "2100 ", "ADUS-", "US: ". */
  const ENTITY_CODE = /^(\d+\s+|[A-Z]{2,}\d+\s+|[A-Z\d]{2,8}\s*[-:]\s*|[A-Z][a-z]+:\s+)/;
  /** Elements whose text is never part of a posting. */
  const SKIPPED = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'SVG',
    'CANVAS',
    'IFRAME',
    'BUTTON',
    'INPUT',
    'SELECT',
    'TEXTAREA',
  ]);
  /** A page's own parts around its content, left out of its main text. */
  const AROUND = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM']);
  /** Elements that start a new line or paragraph. */
  const BLOCKS = new Set([
    'P',
    'DIV',
    'SECTION',
    'ARTICLE',
    'HEADER',
    'FOOTER',
    'UL',
    'OL',
    'TABLE',
    'TR',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'BLOCKQUOTE',
    'PRE',
    'DL',
    'DT',
    'DD',
    'HR',
  ]);

  /** Each big job site's own places for the posting and its details, newest layouts first. */
  const SITES: {
    host: RegExp;
    posting: string[];
    title: string[];
    company: string[];
    /** The company in the tab's title, for a site that shows its name nowhere else as text. */
    companyInTitle?: RegExp;
    location: string[];
  }[] = [
    {
      host: /(^|\.)linkedin\.com$/,
      posting: [
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.jobs-box__html-content',
        '#job-details',
        '.show-more-less-html__markup',
        '.description__text',
      ],
      title: [
        '.job-details-jobs-unified-top-card__job-title',
        '.jobs-unified-top-card__job-title',
        '.top-card-layout__title',
        '.topcard__title',
      ],
      company: [
        '.job-details-jobs-unified-top-card__company-name',
        '.jobs-unified-top-card__company-name',
        '.topcard__org-name-link',
        '.top-card-layout__second-subline a',
      ],
      location: [
        '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
        '.job-details-jobs-unified-top-card__bullet',
        '.jobs-unified-top-card__bullet',
        '.topcard__flavor--bullet',
      ],
    },
    {
      host: /(^|\.)indeed\.com$/,
      posting: [
        '[data-testid="vj-job-description-heading"] + div',
        '#jobDescriptionText',
        '.jobsearch-JobComponent-description',
      ],
      title: [
        '[data-testid="vj-job-title"]',
        '[data-testid="jobsearch-JobInfoHeader-title"]',
        '.jobsearch-JobInfoHeader-title',
      ],
      company: [
        '[data-testid="company-info-metadata"] [dir="ltr"]',
        '[data-testid="inlineHeader-companyName"]',
        '[data-company-name]',
      ],
      location: [
        '[data-testid="company-info-metadata"] > div > div + [dir="ltr"]',
        '[data-testid="inlineHeader-companyLocation"]',
        '[data-testid="job-location"]',
      ],
    },
    {
      host: /(^|\.)greenhouse\.io$/,
      posting: ['.job__description', '#content', '.job-post'],
      title: ['.job__title h1', '.app-title', 'h1.section-header'],
      company: ['.company-name'],
      // Its newer boards name the company in the tab's title, "Job Application for … at Acme".
      companyInTitle: /^Job Application for .+ at (.+)$/i,
      location: ['.job__location', '.location'],
    },
    {
      host: /(^|\.)lever\.co$/,
      posting: ['[data-qa="job-description"]', '.posting-page .content', '.section-wrapper'],
      title: ['.posting-headline h2'],
      company: [],
      location: ['.posting-categories .location', '.posting-category.location'],
    },
    {
      host: /(^|\.)myworkdayjobs\.com$/,
      posting: ['[data-automation-id="jobPostingDescription"]'],
      title: ['[data-automation-id="jobPostingHeader"]'],
      company: [],
      location: ['[data-automation-id="locations"]'],
    },
    {
      host: /(^|\.)ashbyhq\.com$/,
      posting: ['.ashby-job-posting-right-pane', '[class*="_descriptionText"]'],
      title: ['.ashby-job-posting-heading', 'h1'],
      company: [],
      location: [],
    },
    {
      host: /(^|\.)glassdoor\.[a-z.]+$/,
      posting: ['[class*="JobDetails_jobDescription"]', '#JobDescriptionContainer'],
      title: ['[data-test="job-title"]'],
      company: ['[data-test="employer-name"]'],
      location: ['[data-test="location"]'],
    },
    {
      host: /(^|\.)ziprecruiter\.com$/,
      posting: ['.job_description', '[class*="job_description"]'],
      title: ['.job_title', 'h1'],
      company: ['.hiring_company', '[class*="company_name"]'],
      location: ['.location', '[class*="location"]'],
    },
    {
      host: /(^|\.)smartrecruiters\.com$/,
      // The posting, without the map, the buttons and the links after it.
      posting: [
        '.job-sections [itemprop="description"]',
        '.job-sections',
        '[itemprop="description"]',
      ],
      title: ['.job-title'],
      company: [],
      location: ['.job-detail'],
    },
  ];

  /** Text as one line, without runs of spaces. */
  const oneLine = (text: unknown) =>
    typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';

  /** Text from an address, decoded, or as it is when it can't be. */
  const decoded = (text: string) => {
    try {
      return decodeURIComponent(text.replace(/\+/g, ' '));
    } catch {
      return text;
    }
  };
  /**
   * An address's query, as its names and values, read from its text. Firefox's sandbox for an
   * extension's code in a page can't step through a URL's own list of them.
   */
  const queryOf = (search: string): [string, string][] =>
    search
      .replace(/^\?/, '')
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf('=');
        return at < 0
          ? [decoded(pair), '']
          : [decoded(pair.slice(0, at)), decoded(pair.slice(at + 1))];
      });
  /** An address's query without its tracking, and the rest of it as it was. */
  const untracked = (search: string) => {
    const kept = search
      .replace(/^\?/, '')
      .split('&')
      .filter((pair) => pair && !TRACKING_PARAM.test(decoded(pair.split('=', 1)[0] ?? '')));
    return kept.length > 0 ? `?${kept.join('&')}` : '';
  };

  /** Whether an element is hidden in a way its markup says. */
  const hidden = (element: Element) =>
    element.hasAttribute('hidden') ||
    element.getAttribute('aria-hidden') === 'true' ||
    /display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.getAttribute('style') ?? '');

  /**
   * An element's text as lines and paragraphs, with list items as "- " lines, leaving out the
   * elements named in `skip`. It reads the page as it is: nothing in it is copied or changed.
   */
  function textOf(root: Node, skip: ReadonlySet<string> = new Set()): string {
    const parts: string[] = [];
    const visit = (node: Node) => {
      if (node.nodeType === 3) {
        parts.push((node.nodeValue ?? '').replace(/\s+/g, ' '));
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      const tag = element.tagName.toUpperCase();
      if (SKIPPED.has(tag) || skip.has(tag) || hidden(element)) return;
      if (tag === 'BR') {
        parts.push('\n');
        return;
      }
      if (tag === 'LI') {
        // An item's text, without the lines a paragraph in it starts and ends with, as many
        // editors write them. An empty item is left out.
        const start = parts.length;
        for (const child of Array.from(element.childNodes)) visit(child);
        const item = parts.splice(start).join('').trim();
        if (item) parts.push(`\n- ${item}`);
        return;
      }
      const block = BLOCKS.has(tag);
      const heading = /^H[1-6]$/.test(tag);
      if (heading) parts.push('\n\n');
      else if (block) parts.push('\n');
      for (const child of Array.from(element.childNodes)) visit(child);
      if (heading || tag === 'P' || tag === 'UL' || tag === 'OL') parts.push('\n\n');
      else if (block) parts.push('\n');
    };
    visit(root);
    return (
      parts
        .join('')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        // One list item to a line, without a blank line between items.
        .replace(/^(- .*)\n\n(?=- )/gm, '$1\n')
        .trim()
    );
  }

  /** Markup, such as a posting's description in the page's job data, as text. */
  function textOfMarkup(markup: string): string {
    // Parsed into a document of its own, which never runs scripts or loads anything.
    const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html').body;
    const body = parse(markup);
    // Some sites encode the description's markup twice, so reading it once finds no elements, only
    // text with tags in it. One read once into elements, which may mention a tag, is done.
    const text = body.textContent ?? '';
    return body.children.length === 0 && /<[a-z][^<>]*>/i.test(text)
      ? textOf(parse(text))
      : textOf(body);
  }

  /** The first of the selectors that finds an element with text, and its text. */
  function first(selectors: string[], asText: (element: Element) => string): string {
    for (const selector of selectors) {
      let element: Element | null = null;
      try {
        element = doc.querySelector(selector);
      } catch {
        // A selector this browser can't read.
      }
      const text = element ? asText(element) : '';
      if (text) return text;
    }
    return '';
  }

  /** A meta tag's content, by its property or name. */
  const meta = (key: string) =>
    oneLine(
      doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content'),
    );

  /** Every job posting in the page's job data, wherever it sits in it. */
  function jobPostings(): Record<string, unknown>[] {
    const found: Record<string, unknown>[] = [];
    const visit = (value: unknown, depth: number) => {
      if (!value || typeof value !== 'object' || depth > 6) return;
      if (Array.isArray(value)) {
        for (const each of value) visit(each, depth + 1);
        return;
      }
      const node = value as Record<string, unknown>;
      const type = node['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((each) => typeof each === 'string' && /JobPosting$/i.test(each))) {
        found.push(node);
      }
      for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item']) {
        if (node[key]) visit(node[key], depth + 1);
      }
    };
    for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        visit(JSON.parse(script.textContent ?? ''), 0);
      } catch {
        // Job data that isn't JSON is left out.
      }
    }
    return found;
  }

  /** A name, from a string or an object with one. */
  const nameOf = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(', ');
    if (typeof value === 'string') return oneLine(value);
    if (value && typeof value === 'object') return oneLine((value as { name?: unknown }).name);
    return '';
  };

  /**
   * Who a posting's job data says is hiring. Workday's names the legal entity, with its code, as
   * "2100 NVIDIA USA" or "ADUS-Adobe Inc.": there, it's the site's own name, as the entity writes
   * it ("NVIDIA" at nvidia.wd5.myworkdayjobs.com) but with a capital, or else the entity without
   * its code.
   */
  function hiringOf(posting: Record<string, unknown>): string {
    const name = nameOf(posting.hiringOrganization);
    if (!/(^|\.)myworkdayjobs\.com$/.test(site)) return name;
    const tenant = site.split('.', 1)[0] ?? '';
    const own = name.split(/[^\p{L}\p{N}]+/u).find((word) => word.toLowerCase() === tenant);
    return own ? own.charAt(0).toUpperCase() + own.slice(1) : name.replace(ENTITY_CODE, '');
  }

  /**
   * A job post's company and title, from its first line, as Hacker News's "Who is hiring?" posts
   * write it: "Acme (YC W24) | Senior Engineer | Remote (US)", or with dashes between. The company
   * comes first, without what's in brackets after it, and the title is the first part after it
   * that names a role. A first line that isn't parts like these names neither.
   */
  function headerOf(text: string): { company: string; title: string } {
    const line = text.split('\n', 1)[0] ?? '';
    const parts = (line.includes('|') ? line.split('|') : line.split(/\s[–—-]\s/))
      .map(oneLine)
      .filter(Boolean);
    if (parts.length < 2) return { company: '', title: '' };
    const link = (part: string) => /^(https?:\/\/|www\.)/i.test(part);
    const [start = '', ...rest] = parts;
    return {
      company: start.length <= 100 && !link(start) ? start.replace(/\s*\([^()]*\)$/, '') : '',
      title: rest.find((part) => ROLE.test(part) && !link(part)) ?? '',
    };
  }

  /** Where a posting's job is, from its job data. */
  function placeOf(posting: Record<string, unknown>): string {
    const places = (
      Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation]
    )
      .map((place) => {
        const address = (place as { address?: unknown } | undefined)?.address;
        if (typeof address === 'string') return oneLine(address);
        if (!address || typeof address !== 'object') return nameOf(place);
        const parts = address as Record<string, unknown>;
        return [parts.addressLocality, parts.addressRegion, nameOf(parts.addressCountry)]
          .map(nameOf)
          .filter(Boolean)
          .join(', ');
      })
      .filter(Boolean);
    const remote = /TELECOMMUTE/i.test(String(posting.jobLocationType ?? ''));
    return [...(remote ? ['Remote'] : []), ...new Set(places)].join('; ');
  }

  /** What a posting pays, from its job data, such as "USD 120,000–150,000 a year". */
  function payOf(posting: Record<string, unknown>): string {
    const salary = posting.baseSalary as Record<string, unknown> | undefined;
    if (!salary || typeof salary !== 'object') return '';
    const value = (salary.value ?? {}) as Record<string, unknown>;
    const amount = (n: unknown) =>
      typeof n === 'number' ||
      (typeof n === 'string' && n.trim() !== '' && !Number.isNaN(Number(n)))
        ? Number(n).toLocaleString('en-US')
        : '';
    const low = amount(value.minValue ?? value.value ?? salary.minValue);
    const high = amount(value.maxValue ?? salary.maxValue);
    const range = low && high && low !== high ? `${low}–${high}` : low || high;
    if (!range) return '';
    const unit = oneLine(value.unitText ?? salary.unitText).toLowerCase();
    const per = unit ? ` a${/^[aeiou]/.test(unit) ? 'n' : ''} ${unit}` : '';
    return `${oneLine(salary.currency) ? `${oneLine(salary.currency)} ` : ''}${range}${per}`;
  }

  /** Employment types, such as FULL_TIME, as words, such as "Full time". */
  const employmentOf = (value: unknown): string =>
    (Array.isArray(value) ? value : [value])
      .map((each) => oneLine(each).toLowerCase().replace(/_/g, ' '))
      .filter(Boolean)
      .map((each) => each.charAt(0).toUpperCase() + each.slice(1))
      .join(', ');

  /**
   * The job's own address, without tracking: on LinkedIn's and Indeed's job pages, including a
   * search showing one, the job's own page, and on Hacker News, the post's. A page's route after
   * "#/", as some careers sites keep each job's, stays.
   */
  function jobUrl(): string {
    if (post) return `https://news.ycombinator.com/item?id=${post.id}`;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return href;
    }
    const host = url.hostname.replace(/^www\./, '');
    const query = queryOf(url.search);
    const param = (name: string) => query.find(([key]) => key === name)?.[1] ?? null;
    if (/(^|\.)linkedin\.com$/.test(host) && /^\/jobs(\/|$)/.test(url.pathname)) {
      const id =
        param('currentJobId') ?? url.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
      if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    if (
      /(^|\.)indeed\.com$/.test(host) &&
      /^\/(viewjob|jobs|q-|m\/|rc\/clk|cmp\/[^/]+\/jobs)/.test(url.pathname)
    ) {
      const key = param('vjk') ?? param('jk');
      if (key && /^[\w-]+$/.test(key)) return `https://${url.hostname}/viewjob?jk=${key}`;
    }
    url.search = untracked(url.search);
    // A link's "#:~:text=…", which only highlights words on the page, is no part of its address.
    const hash = url.hash.replace(/:~:.*$/s, '');
    url.hash = /^#!?\//.test(hash) ? hash : '';
    return url.toString();
  }

  /** A title as its words, to compare whole: "Sr. Engineer, Data" is " sr engineer data ". */
  const wordsOf = (text: string) =>
    ` ${text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()} `;
  /**
   * Whether two titles are the same, word for word, whatever their case and punctuation. A title
   * with no letters or digits, such as "🚀", is no title.
   */
  const sameTitle = (a: string, b: string) => {
    const words = wordsOf(a);
    return words.trim() !== '' && words === wordsOf(b);
  };
  /** An address's parts, to compare: its site, its path's parts, its query and its route. */
  const partsOf = (address: unknown) => {
    const named = Array.isArray(address)
      ? address.find((each) => typeof each === 'string')
      : address;
    if (typeof named !== 'string') return null;
    try {
      const url = new URL(named, href);
      // Without a link's "#:~:text=…", which Chrome keeps in where a page loaded, but not in its
      // address.
      const hash = url.hash.replace(/:~:.*$/s, '').replace(/^#$/, '');
      const route = /^#!?\/./.test(hash) ? hash.replace(/\/+$/, '').toLowerCase() : '';
      return {
        host: url.hostname.replace(/^www\./, '').toLowerCase(),
        segments: url.pathname.toLowerCase().split('/').filter(Boolean),
        query: queryOf(url.search).filter(([key]) => !TRACKING_PARAM.test(key)),
        route,
        /** A place on the page, such as "#job-2", which some pages of several jobs use. */
        anchor: route ? '' : hash.toLowerCase(),
      };
    } catch {
      return null;
    }
  };
  /**
   * A posting's own address, which must name a page: a whole address, or one from the site's root.
   * "", "#…" and "?…" are any page's.
   */
  const ownPartsOf = (posting: Record<string, unknown>) => {
    const address = Array.isArray(posting.url)
      ? posting.url.find((each) => typeof each === 'string')
      : posting.url;
    return typeof address === 'string' && /^\s*((https?:)?\/\/|\/)/i.test(address)
      ? partsOf(address)
      : null;
  };
  /** An address, to compare whole: its site, path, query without tracking, and route. */
  const keyOf = (parts: NonNullable<ReturnType<typeof partsOf>>) => {
    const query = parts.query.map(([key, value]) => `${key}=${value}`).sort();
    return `${parts.host}/${parts.segments.join('/')}?${query.join('&')}${parts.route}`;
  };
  const addressOf = (address: unknown) => {
    const parts = partsOf(address);
    return parts ? keyOf(parts) : '';
  };
  /** Whether the page has moved to another place on it since it loaded, as "#job-1" to "#job-2". */
  const anchorMoved = Boolean(loadedAt) && partsOf(loadedAt)?.anchor !== partsOf(href)?.anchor;
  /** Whether the page has moved on from the address it loaded at, as a single-page site does. */
  const moved = (Boolean(loadedAt) && addressOf(loadedAt) !== addressOf(href)) || anchorMoved;

  const site = (() => {
    try {
      return new URL(href).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const known = SITES.find((each) => each.host.test(site));
  const linkedIn = /(^|\.)linkedin\.com$/.test(site);
  /**
   * On Hacker News, the post that's the job, as a "Who is hiring?" thread has them: the comment the
   * selected text starts in, or the one a comment's own page shows.
   */
  const post = (() => {
    if (!/(^|\.)news\.ycombinator\.com$/.test(site)) return null;
    const from =
      selectedFrom?.nodeType === 1 ? (selectedFrom as Element) : selectedFrom?.parentElement;
    const rows = [from?.closest('tr.athing[id]'), doc.querySelector('.fatitem tr.athing[id]')];
    for (const row of rows) {
      const text = row?.querySelector('.commtext');
      if (row && text && /^\d+$/.test(row.id)) return { id: row.id, text };
    }
    return null;
  })();
  const fromSite = (selectors: string[] | undefined) =>
    first(selectors ?? [], (element) => oneLine(textOf(element)));
  /** Indeed's title ends with words only screen readers hear. */
  const JOB_POST = /\s*-\s*job post\s*$/i;
  const shownTitle = fromSite(known?.title).replace(JOB_POST, '');

  /** A posting's title, as text: "R&amp;D Engineer" is "R&D Engineer". */
  const titleOf = (posting: Record<string, unknown>) =>
    posting.title ? oneLine(textOfMarkup(String(posting.title))) : '';
  /**
   * The page's first headings, where a site it doesn't know shows a job's title: not in its menus,
   * sidebars or footer, and not further down, where a list of other jobs can be.
   */
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3'))
    .filter(
      (element) =>
        !element.closest('nav, aside, footer, [hidden], [aria-hidden="true"]') &&
        (element as Element & { checkVisibility?: () => boolean }).checkVisibility?.() !== false,
    )
    .map((element) => oneLine(textOf(element)))
    .filter(Boolean)
    .slice(0, 3);
  /** This page's address: the tab's, and the job's own, as LinkedIn and Indeed have it. */
  const pages = [partsOf(href), partsOf(jobUrl())].filter((parts) => parts !== null);
  /**
   * Whether a posting's own address is another page of this site: one with a query, a route or a
   * last part of its path that this page's address hasn't, as another job's would. "/jobs/42" is
   * this page at "/en/jobs/42-data-lead", but "/jobs/41" isn't.
   */
  const elsewhere = (posting: Record<string, unknown>) => {
    const own = ownPartsOf(posting);
    const last = own?.segments.at(-1);
    if (!own || !(own.query.length > 0 || own.route || own.anchor || last)) return false;
    const sameSite = pages.filter((page) => page.host === own.host);
    return (
      sameSite.length > 0 &&
      !sameSite.some(
        (page) =>
          own.query.every(([key, value]) =>
            page.query.some(([k, v]) => k === key && v === value),
          ) &&
          (!own.route || own.route === page.route) &&
          (!own.anchor || own.anchor === page.anchor) &&
          (!last ||
            page.segments.some(
              (part) =>
                part === last ||
                (part.startsWith(last) && /^[^\p{L}\p{N}]/u.test(part.slice(last.length))),
            )),
      )
    );
  };
  /**
   * Whether a posting's own address is this page's, query, route and place on the page and all.
   * One that names no job, as a single-page site's one address for all its jobs doesn't, counts
   * only with its title shown too.
   */
  const atThisPage = (posting: Record<string, unknown>) => {
    const own = ownPartsOf(posting);
    if (!own) return false;
    const at = pages.some(
      (page) =>
        keyOf(page) === keyOf(own) && (own.anchor ? own.anchor === page.anchor : !anchorMoved),
    );
    const namesJob =
      own.query.length > 0 || own.route !== '' || /\d/.test(own.segments.at(-1) ?? '');
    return at && (namesJob || showsTitle(posting));
  };
  /**
   * Whether the page shows a posting's title, word for word: as the job site's own title, or on a
   * site it doesn't know, as one of its headings.
   */
  const showsTitle = (posting: Record<string, unknown>) => {
    // A page that moved on from the address it loaded at may still hold the first job's data.
    if (moved) return false;
    const title = titleOf(posting);
    return shownTitle
      ? sameTitle(title, shownTitle)
      : headings.some((heading) => sameTitle(title, heading));
  };

  // The page's own job data, only when it's clearly this page's: the one posting at this page's
  // address, or else the one whose title the page shows. A posting for another page is left out,
  // and so is any the page doesn't show, as a single-page job site can leave an earlier job's
  // behind. Without it, the job site's own layout or the page's main text is read instead.
  const postings = jobPostings().filter((posting) => !elsewhere(posting));
  const here = postings.filter(atThisPage);
  const shown = postings.filter(showsTitle);
  const data = here.length === 1 ? here[0] : shown.length === 1 ? shown[0] : undefined;

  /** A site's name, unless it's a job board's or an applicant system's, which no job is with. */
  const notBoard = (name: string) => (BOARDS.test(name.trim()) ? '' : name);
  // A Hacker News post's text, and the company and title its first line names, which are all a
  // post has: never the tab's title, which is only the post's first words.
  const postText = post ? textOf(post.text) : '';
  const header = post ? headerOf(postText) : null;
  const title = header
    ? header.title
    : (
        (data ? titleOf(data) : '') ||
        shownTitle ||
        meta('og:title') ||
        first(['h1'], (element) => oneLine(textOf(element))) ||
        oneLine(doc.title)
      ).replace(JOB_POST, '');
  const company = header
    ? header.company
    : (data && hiringOf(data)) ||
      fromSite(known?.company) ||
      // A tab's title is short: one that isn't is read only as far as any title goes.
      oneLine(known?.companyInTitle?.exec(oneLine(doc.title).slice(0, 500))?.[1]) ||
      notBoard(meta('og:site_name'));

  const selection = oneLine(selected).length >= MIN_SELECTION ? selected.trim() : '';
  const described = data?.description ? textOfMarkup(String(data.description)) : '';
  const onSite = post ? postText : first(known?.posting ?? [], (element) => textOf(element));
  // The page's main text, without its navigation, headers, footers and forms. Never LinkedIn's,
  // where anything but the job's own posting, such as messages, isn't the job's.
  const main = () => {
    if (linkedIn) return '';
    const root =
      doc.querySelector('main, [role="main"], article') ??
      doc.querySelector('#content') ??
      doc.body;
    return root ? textOf(root, AROUND) : '';
  };

  let posting = '';
  let source: PageJob['source'] = 'page';
  if (selection) {
    posting = selection;
    source = 'selection';
  } else if (described && described.length >= onSite.length * 0.6) {
    // The job data's description, unless what the site shows is clearly fuller.
    posting = described;
    source = 'structured';
  } else if (onSite) {
    posting = onSite;
    source = 'page';
  } else {
    posting = main();
    source = posting ? 'main' : 'page';
  }

  return {
    url: jobUrl(),
    pageUrl: href,
    site,
    pageTitle: oneLine(doc.title),
    title,
    company,
    location: (data && placeOf(data)) || fromSite(known?.location),
    pay: data ? payOf(data) : '',
    employment: data ? employmentOf(data.employmentType) : '',
    posted: oneLine(data?.datePosted).slice(0, 10),
    posting: posting.slice(0, MAX_POSTING),
    source,
  };
}
