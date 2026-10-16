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
  /** Where the posting's text came from: what you selected, the job's own data, or the page. */
  source: 'selection' | 'structured' | 'page';
}

/**
 * Reads the job on the page you're on: its address, its posting, and what it can tell of the title,
 * company, place and pay. The extension sends this one function into the page, only when you ask
 * it to save the job, so everything it needs is inside it. The page's job data, which job sites
 * publish for search engines, comes first, then what each big job site shows, then the page's main
 * text. Text you've selected stands in for the posting, for a page it can't read well.
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

  /** An element's text as lines and paragraphs, with list items as "- " lines. */
  function textOf(root: Node): string {
    const parts: string[] = [];
    const visit = (node: Node) => {
      if (node.nodeType === 3) {
        parts.push((node.nodeValue ?? '').replace(/\s+/g, ' '));
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      const tag = element.tagName.toUpperCase();
      if (SKIPPED.has(tag) || hidden(element)) return;
      if (tag === 'BR') {
        parts.push('\n');
        return;
      }
      const block = BLOCKS.has(tag);
      const heading = /^H[1-6]$/.test(tag);
      if (tag === 'LI') parts.push('\n- ');
      else if (heading) parts.push('\n\n');
      else if (block) parts.push('\n');
      for (const child of Array.from(element.childNodes)) visit(child);
      // A list item ends where the next one starts, so items don't get a blank line between them.
      if (heading || tag === 'P' || tag === 'UL' || tag === 'OL') parts.push('\n\n');
      else if (block) parts.push('\n');
    };
    visit(root);
    return parts
      .join('')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n- \n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Markup, such as a posting's description in the page's job data, as text. */
  function textOfMarkup(markup: string): string {
    // Parsed into a document of its own, which never runs scripts or loads anything.
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    return textOf(parsed.body);
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
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const each of value) visit(each);
        return;
      }
      const node = value as Record<string, unknown>;
      const type = node['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((each) => typeof each === 'string' && /JobPosting$/i.test(each))) {
        found.push(node);
      }
      if (node['@graph']) visit(node['@graph']);
    };
    for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        visit(JSON.parse(script.textContent ?? ''));
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

  /** The job's own address, without tracking: on LinkedIn and Indeed, the job's own page. */
  function jobUrl(): string {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return href;
    }
    const host = url.hostname.replace(/^www\./, '');
    if (/(^|\.)linkedin\.com$/.test(host)) {
      const id =
        url.searchParams.get('currentJobId') ??
        url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
      if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    if (/(^|\.)indeed\.com$/.test(host)) {
      const key = url.searchParams.get('vjk') ?? url.searchParams.get('jk');
      if (key && /^[\w-]+$/.test(key)) return `https://${url.hostname}/viewjob?jk=${key}`;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  }

  const site = (() => {
    try {
      return new URL(href).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const known = SITES.find((each) => each.host.test(site));
  const [data] = jobPostings();
  const fromSite = (selectors: string[] | undefined) =>
    first(selectors ?? [], (element) => oneLine(textOf(element)));

  const title =
    oneLine(data?.title ? textOfMarkup(String(data.title)) : '') ||
    fromSite(known?.title) ||
    meta('og:title') ||
    first(['h1'], (element) => oneLine(textOf(element))) ||
    oneLine(doc.title);
  const company =
    nameOf(data?.hiringOrganization) || fromSite(known?.company) || meta('og:site_name');
  const place = (data && placeOf(data)) || fromSite(known?.location);

  const selection = oneLine(selected).length >= MIN_SELECTION ? selected.trim() : '';
  const described = data?.description ? textOfMarkup(String(data.description)) : '';
  const shown = first(known?.posting ?? [], (element) => textOf(element));
  const main = () => {
    const root =
      doc.querySelector('main, [role="main"], article') ??
      doc.querySelector('#content') ??
      doc.body;
    if (!root) return '';
    // The page's own navigation, headers and footers aren't the posting.
    const copy = root.cloneNode(true) as Element;
    for (const element of Array.from(copy.querySelectorAll('nav, header, footer, aside, form'))) {
      element.remove();
    }
    return textOf(copy);
  };

  let posting = selection;
  let source: PageJob['source'] = 'selection';
  if (!posting) {
    // The job data's description, unless what the site shows is clearly fuller.
    posting = described.length >= shown.length * 0.6 && described ? described : shown;
    source = posting === described && described ? 'structured' : 'page';
  }
  if (!posting) {
    posting = main();
    source = 'page';
  }

  return {
    url: jobUrl(),
    pageUrl: href,
    site,
    pageTitle: oneLine(doc.title),
    title,
    company,
    location: place,
    pay: data ? payOf(data) : '',
    employment: data ? employmentOf(data.employmentType) : '',
    posted: oneLine(data?.datePosted).slice(0, 10),
    posting: posting.slice(0, MAX_POSTING),
    source,
  };
}
