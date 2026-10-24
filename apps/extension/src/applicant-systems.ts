/**
 * The job application sites the extension may be allowed on (src/application-sites.ts), by the
 * applicant systems most companies' forms are on, and the sites it's never on, as patterns the
 * browser's permissions and scripts take. Nothing here reaches the browser, so the manifest is
 * built from it too.
 */

/** An applicant system, by the sites its application forms are on. */
export interface ApplicantSystem {
  name: string;
  /** Its forms' sites, as the browser's permissions name sites. */
  sites: string[];
  /** Its own pages on those sites that aren't anyone's application, such as its home page. */
  not?: string[];
}

/**
 * The applicant systems most companies' application forms are on, each by the sites its job pages
 * and forms are on, never its own home page. Those that give each company a site under one name,
 * as Workday, iCIMS and Taleo do, take in the whole name: iCIMS and Taleo keep more there than job
 * pages, such as their customers' own sign-ins, which the script then runs on too, but for iCIMS's
 * home page. There, as anywhere it runs, it shows its Fill button only on a page with an
 * application form, and a menu only in a field you go to that Factwright has an answer for.
 */
export const APPLICANT_SYSTEMS: readonly ApplicantSystem[] = [
  {
    name: 'Greenhouse',
    sites: [
      'https://boards.greenhouse.io/*',
      'https://job-boards.greenhouse.io/*',
      'https://boards.eu.greenhouse.io/*',
      'https://job-boards.eu.greenhouse.io/*',
    ],
  },
  { name: 'Lever', sites: ['https://jobs.lever.co/*', 'https://jobs.eu.lever.co/*'] },
  { name: 'Ashby', sites: ['https://jobs.ashbyhq.com/*'] },
  { name: 'Workday', sites: ['https://*.myworkdayjobs.com/*', 'https://*.myworkdaysite.com/*'] },
  {
    name: 'iCIMS',
    sites: ['https://*.icims.com/*'],
    not: ['https://icims.com/*', 'https://www.icims.com/*'],
  },
  {
    name: 'SmartRecruiters',
    sites: ['https://jobs.smartrecruiters.com/*', 'https://careers.smartrecruiters.com/*'],
  },
  { name: 'Workable', sites: ['https://apply.workable.com/*'] },
  { name: 'Jobvite', sites: ['https://jobs.jobvite.com/*'] },
  { name: 'Taleo', sites: ['https://*.taleo.net/*'] },
  { name: 'JazzHR', sites: ['https://*.applytojob.com/*'] },
  { name: 'Rippling', sites: ['https://ats.rippling.com/*'] },
  { name: 'Paylocity', sites: ['https://recruiting.paylocity.com/*'] },
  { name: 'UKG', sites: ['https://recruiting.ultipro.com/*', 'https://recruiting2.ultipro.com/*'] },
  { name: 'Dayforce', sites: ['https://jobs.dayforcehcm.com/*'] },
  { name: 'Personio', sites: ['https://*.jobs.personio.de/*', 'https://*.jobs.personio.com/*'] },
];

/**
 * This computer's site, which a build for testing counts among the job application sites, so its
 * end-to-end runs fill forms served here. The stores' build never does.
 */
export const THIS_COMPUTER = 'http://127.0.0.1/*';

/** The job application sites, as the opt-in asks the browser for them. */
export const jobSites = (local: boolean): string[] => [
  ...APPLICANT_SYSTEMS.flatMap((system) => system.sites),
  ...(local ? [THIS_COMPUTER] : []),
];

/**
 * Sites whose terms forbid filling their own forms, where the extension never runs a script:
 * LinkedIn's Easy Apply and Indeed's Easily apply. The panel gives answers to copy there.
 */
export const COPY_ONLY_SITES = [
  '*://linkedin.com/*',
  '*://*.linkedin.com/*',
  '*://indeed.com/*',
  '*://*.indeed.com/*',
];

/** Pages on the sites you allowed where the script never runs. */
export const NOT_JOB_SITES = [
  ...APPLICANT_SYSTEMS.flatMap((system) => system.not ?? []),
  ...COPY_ONLY_SITES,
];

/** A pattern's parts: its scheme, its host, and its path. */
const PATTERN = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/;

/**
 * Whether a page's address is on a site a pattern names, as the browser matches its permissions
 * and scripts: the same scheme, http or https for *, the same host or one under it for "*.", any
 * port, as the browser's patterns leave ports out, and the path, with * for anything.
 */
export function onSite(url: string, pattern: string): boolean {
  const parts = PATTERN.exec(pattern);
  if (!parts) return false;
  const [, scheme = '', host = '', path = ''] = parts;
  let page: URL;
  try {
    page = new URL(url);
  } catch {
    return false;
  }
  const protocol = page.protocol.slice(0, -1);
  if (scheme === '*' ? protocol !== 'http' && protocol !== 'https' : protocol !== scheme) {
    return false;
  }
  const name = page.hostname.toLowerCase();
  const wanted = host.toLowerCase();
  if (wanted.startsWith('*.')) {
    const under = wanted.slice(2);
    if (name !== under && !name.endsWith(`.${under}`)) return false;
  } else if (wanted !== '*' && name !== wanted) {
    return false;
  }
  return wildcard(path, `${page.pathname}${page.search}`);
}

/** Whether words are as a pattern says, with * for any words at all, and nothing else special. */
function wildcard(pattern: string, words: string): boolean {
  const parts = pattern.split('*');
  const first = parts[0] ?? '';
  const last = parts.at(-1) ?? '';
  if (parts.length === 1) return words === pattern;
  if (words.length < first.length + last.length) return false;
  if (!words.startsWith(first) || !words.endsWith(last)) return false;
  // Each part between, in its order, the first place it fits after the one before.
  const end = words.length - last.length;
  let at = first.length;
  for (const part of parts.slice(1, -1)) {
    const found = words.indexOf(part, at);
    if (found < 0 || found + part.length > end) return false;
    at = found + part.length;
  }
  return true;
}

/** Whether a page is on one of the sites patterns name, and not on a page they leave out. */
export const onAnySite = (url: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => onSite(url, pattern)) &&
  !NOT_JOB_SITES.some((pattern) => onSite(url, pattern));

/** Whether a page is on LinkedIn or Indeed, where the extension only ever gives answers to copy. */
export const isCopyOnlySite = (url: string): boolean =>
  COPY_ONLY_SITES.some((pattern) => onSite(url, pattern));

/** The names this computer goes by, whose sites a build for testing may add over http. */
const THIS_COMPUTERS = ['localhost', '127.0.0.1'];

/** A site's host name, as an address's: a name with a dot, never an IP address or a pattern. */
const NAMED = /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i;

/**
 * A careers site, as one click adds it: the site of the page you're on, as the browser's
 * permissions name it, such as "https://careers.example.com/*". Only a named https site, and in a
 * build for testing (`local`) this computer's over http too, and never LinkedIn or Indeed. Null
 * for a page that can't be one.
 */
export function careersSite(url: string, local: boolean): string | null {
  let page: URL;
  try {
    page = new URL(url);
  } catch {
    return null;
  }
  const here = local && page.protocol === 'http:' && THIS_COMPUTERS.includes(page.hostname);
  if (!here && (page.protocol !== 'https:' || !NAMED.test(page.hostname))) return null;
  if (isCopyOnlySite(url)) return null;
  return `${page.protocol}//${page.hostname.toLowerCase()}/*`;
}

/** Whether a site, as kept, is a careers site one click could have added. */
export const isCareersSite = (site: string, local: boolean): boolean =>
  site.endsWith('/*') && careersSite(site.slice(0, -1), local) === site;
