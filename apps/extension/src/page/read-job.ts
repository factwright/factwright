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
      posting: ['#jobDescriptionText', '.jobsearch-JobComponent-description'],
      title: ['[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title'],
      company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name]'],
      location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'],
    },
    {
      host: /(^|\.)greenhouse\.io$/,
      posting: ['.job__description', '#content', '.job-post'],
      title: ['.job__title h1', '.app-title', 'h1.section-header'],
      company: ['.company-name'],
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
      posting: ['.job-sections', '[itemprop="description"]'],
      title: ['.job-title'],
      company: [],
      location: ['.job-detail'],
    },
  ];

  /** Text as one line, without runs of spaces. */
  const oneLine = (text: unknown) =>
    typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';

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
    const parse = (html: string) => textOf(new DOMParser().parseFromString(html, 'text/html').body);
    const text = parse(markup);
    // Some sites encode the description's markup twice, so the first reading still has its tags,
    // closing ones too, which a posting that only mentions a tag, as in "use <div>", hasn't.
    return /<\/(p|li|ul|ol|div|h[1-6])\s*>/i.test(text) ? parse(text) : text;
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
   * search showing one, the job's own page. A page's route after "#/", as some careers sites keep
   * each job's, stays.
   */
  function jobUrl(): string {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return href;
    }
    const host = url.hostname.replace(/^www\./, '');
    if (/(^|\.)linkedin\.com$/.test(host) && /^\/jobs(\/|$)/.test(url.pathname)) {
      const id =
        url.searchParams.get('currentJobId') ??
        url.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
      if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    if (
      /(^|\.)indeed\.com$/.test(host) &&
      /^\/(viewjob|jobs|q-|m\/|rc\/clk|cmp\/[^/]+\/jobs)/.test(url.pathname)
    ) {
      const key = url.searchParams.get('vjk') ?? url.searchParams.get('jk');
      if (key && /^[\w-]+$/.test(key)) return `https://${url.hostname}/viewjob?jk=${key}`;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    if (!/^#!?\//.test(url.hash)) url.hash = '';
    return url.toString();
  }

  /** Text to compare, such as two titles: lowercase letters and digits only. */
  const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  /** A title's words, to compare: "Sr. Software Engineer" has "sr", "software" and "engineer". */
  const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
  /**
   * Whether two titles name the same job: one holds the other, or most of the shorter one's words
   * are the other's, as "Sr. Software Engineer" and "Senior Software Engineer" are.
   */
  const sameTitle = (a: string, b: string) => {
    const [x, y] = [plain(a), plain(b)];
    if (!x || !y) return false;
    if (x.includes(y) || y.includes(x)) return true;
    const [one, other] = [words(a), words(b)];
    const shared = [...one].filter((word) => other.has(word)).length;
    return shared / Math.min(one.size, other.size) >= 0.6;
  };
  /** An address, to compare, without its query, but with a careers site's route after "#/". */
  const place = (address: unknown) => {
    try {
      const url = new URL(String(address), href);
      const route = /^#!?\/./.test(url.hash) ? url.hash.replace(/\/+$/, '') : '';
      const path = url.pathname.replace(/\/+$/, '');
      return `${url.hostname.replace(/^www\./, '')}${path}${route}`.toLowerCase();
    } catch {
      return '';
    }
  };
  /** The site an address is on, to compare. */
  const siteOf = (address: unknown) => place(address).split(/[/#]/, 1)[0] ?? '';

  const site = (() => {
    try {
      return new URL(href).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const known = SITES.find((each) => each.host.test(site));
  const linkedIn = /(^|\.)linkedin\.com$/.test(site);
  const fromSite = (selectors: string[] | undefined) =>
    first(selectors ?? [], (element) => oneLine(textOf(element)));
  const shownTitle = fromSite(known?.title);

  /** A posting's title, as text: "R&amp;D Engineer" is "R&D Engineer". */
  const titleOf = (posting: Record<string, unknown>) =>
    posting.title ? oneLine(textOfMarkup(String(posting.title))) : '';
  /**
   * What the page calls its job, to check its job data against: the job site's own title, or on a
   * site it doesn't know, the page's heading, its tab's title and its preview's.
   */
  const pageNames = shownTitle
    ? [shownTitle]
    : [
        first(['h1'], (element) => oneLine(textOf(element))),
        oneLine(doc.title),
        meta('og:title'),
      ].filter(Boolean);

  // The page's own job data: the posting for this page when there are several, and none that the
  // page no longer shows, as a single-page job site can leave an earlier job's behind: one whose
  // own address is another page of this site, or whose title the page doesn't show.
  const postings = jobPostings();
  const here = place(href);
  const isHere = (posting: Record<string, unknown>) =>
    Boolean(posting.url) && place(posting.url) === here;
  const elsewhere = (posting: Record<string, unknown>) =>
    Boolean(posting.url) && !isHere(posting) && siteOf(posting.url) === siteOf(href);
  const showsTitle = (posting: Record<string, unknown>) => {
    const title = titleOf(posting);
    return !title || pageNames.length === 0 || pageNames.some((name) => sameTitle(title, name));
  };
  const candidates = postings.filter((each) => !elsewhere(each));
  const matching =
    candidates.find(isHere) ??
    candidates.find((each) => shownTitle && sameTitle(titleOf(each), shownTitle)) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  const data = matching && (isHere(matching) || showsTitle(matching)) ? matching : undefined;

  /** A site's name, unless it's a job board's or an applicant system's, which no job is with. */
  const notBoard = (name: string) => (BOARDS.test(name.trim()) ? '' : name);
  const title = (
    (data ? titleOf(data) : '') ||
    shownTitle ||
    meta('og:title') ||
    first(['h1'], (element) => oneLine(textOf(element))) ||
    oneLine(doc.title)
  ).replace(/\s*-\s*job post\s*$/i, '');

  const selection = oneLine(selected).length >= MIN_SELECTION ? selected.trim() : '';
  const described = data?.description ? textOfMarkup(String(data.description)) : '';
  const shown = first(known?.posting ?? [], (element) => textOf(element));
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
  } else if (described && described.length >= shown.length * 0.6) {
    // The job data's description, unless what the site shows is clearly fuller.
    posting = described;
    source = 'structured';
  } else if (shown) {
    posting = shown;
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
    company:
      nameOf(data?.hiringOrganization) ||
      fromSite(known?.company) ||
      notBoard(meta('og:site_name')),
    location: (data && placeOf(data)) || fromSite(known?.location),
    pay: data ? payOf(data) : '',
    employment: data ? employmentOf(data.employmentType) : '',
    posted: oneLine(data?.datePosted).slice(0, 10),
    posting: posting.slice(0, MAX_POSTING),
    source,
  };
}
