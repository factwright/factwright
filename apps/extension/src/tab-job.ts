import { hostOf } from '@factwright/core';
import type { PageJob } from './page/read-job.ts';
import type { Unread } from './read-tab.ts';
import type { JobToSave } from './save.ts';

/** Query parameters that only track where a click came from (@factwright/core's links.ts). */
const TRACKING_PARAM =
  /^(utm_|ref$|src$|source$|from$|tk$|trk|rjptk|xpse|xfps|xkcb|gh_src|lever-)/i;

/** Text from an address, decoded, or as it is when it can't be. */
const decoded = (text: string) => {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
};

/** Indeed's pages that show one job, alone or beside a search. */
const INDEED_JOB_PATH = /^\/(viewjob|jobs|q-|m\/|rc\/clk|cmp\/[^/]+\/jobs)/;

/**
 * Job boards, which list many companies' jobs: a board's name is never the company's, and its
 * address names none. Hacker News's "Who is hiring?" threads are one.
 */
const BOARD =
  /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.[a-z.]+|ziprecruiter\.[a-z.]+|monster\.[a-z.]+|wellfound\.com|angel\.co|dice\.com|simplyhired\.[a-z.]+|careerbuilder\.com|builtin\.com|builtin[a-z]+\.(com|org)|hired\.com|otta\.com|welcometothejungle\.com|themuse\.com|remoteok\.com|weworkremotely\.com|flexjobs\.com|joinhandshake\.com|idealist\.org|news\.ycombinator\.com)$/i;

/** Applicant systems whose addresses name the company after the site: "jobs.lever.co/acme/…". */
const COMPANY_IN_PATH =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|jobvite\.com|rippling\.com)$/i;

/** The parts of an address that are about jobs, not the company: "careers", "jobs", "apply". */
const GENERIC = /^(www|jobs?|careers?|apply|boards?|job-boards|ats|app|hire|embed|en|us)$/i;

/** Words that stay lowercase inside a company's name. */
const SMALL_WORDS = new Set(['and', 'of', 'the', 'for', 'at', 'in', 'on', 'by']);

/**
 * A job's own address from the page's: on LinkedIn's and Indeed's job pages, including a search
 * showing one, the job's own page, and anywhere else, the page's without tracking. A page's route
 * after "#/", as some careers sites keep each job's, stays. readJobPage does the same in the page;
 * this is for a page the extension doesn't read.
 */
export function jobAddress(href: string): string {
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
  if (/(^|\.)indeed\.com$/.test(host) && INDEED_JOB_PATH.test(url.pathname)) {
    const key = url.searchParams.get('vjk') ?? url.searchParams.get('jk');
    if (key && /^[\w-]+$/.test(key)) return `https://${url.hostname}/viewjob?jk=${key}`;
  }
  // As readJobPage does, so the two agree to the character: the query's other parts as they were.
  const kept = url.search
    .replace(/^\?/, '')
    .split('&')
    .filter((pair) => pair && !TRACKING_PARAM.test(decoded(pair.split('=', 1)[0] ?? '')));
  url.search = kept.length > 0 ? `?${kept.join('&')}` : '';
  // A link's "#:~:text=…", which only highlights words on the page, is no part of its address.
  const hash = url.hash.replace(/:~:.*$/s, '');
  url.hash = /^#!?\//.test(hash) ? hash : '';
  return url.toString();
}

/**
 * Whether an address is one job's own: on LinkedIn and Indeed, a job's page, not a search, a feed
 * or a company's page. Anywhere else, it can't tell, so any address is.
 */
export function isJobAddress(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  if (/(^|\.)linkedin\.com$/.test(host)) return /^\/jobs\/view\/\d+\/?$/.test(parsed.pathname);
  if (/(^|\.)indeed\.com$/.test(host)) {
    return parsed.pathname === '/viewjob' && parsed.searchParams.has('jk');
  }
  return true;
}

/** A tab title that names a list of jobs, or a site's own page, rather than one job. */
const NOT_ONE_JOB = /\bjobs\b|^(job search|search|home|feed|messaging|notifications)$/i;

/**
 * A title and company from a tab's title, as job sites write them: "Staff Engineer | Northwind |
 * LinkedIn", "Staff Engineer at Northwind", or "Northwind hiring Staff Engineer in Austin". A title
 * that names a search, such as "Engineer jobs in Austin", names neither.
 */
export function fromTabTitle(title: string): { role: string; company: string } {
  const plain = title
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s*[|–—-]\s*(LinkedIn|Indeed(\.com)?|Glassdoor)\s*$/i, '')
    .trim();
  const hiring = plain.match(/^(.+?) hiring (.+?)(?: in .+)?$/i);
  if (hiring?.[1] && hiring[2]) return { company: hiring[1].trim(), role: hiring[2].trim() };
  // "Role | Company" first, since a title's own dashes, as in "Engineer - Platform", aren't a split.
  const bars = plain.split(/\s+\|\s+/).filter(Boolean);
  const found = (() => {
    if (bars.length >= 2) return { role: bars[0] ?? '', company: bars[1] ?? '' };
    const at = plain.replace(/^job application for /i, '').match(/^(.+?) at (.+)$/i);
    if (at?.[1] && at[2]) return { role: at[1].trim(), company: at[2].trim() };
    const dashes = plain.split(/\s+[–—-]\s+/).filter(Boolean);
    if (dashes.length >= 2) return { role: dashes[0] ?? '', company: dashes.at(-1) ?? '' };
    return { role: plain, company: '' };
  })();
  return NOT_ONE_JOB.test(found.role) ? { role: '', company: '' } : found;
}

/** A job from a tab's address and title alone, for a page the extension doesn't read. */
export function jobFromTab(href: string, title: string): PageJob {
  const { role, company } = fromTabTitle(title);
  return {
    url: jobAddress(href),
    pageUrl: href,
    site: hostOf(href),
    pageTitle: title,
    title: role,
    company,
    location: '',
    pay: '',
    employment: '',
    posted: '',
    posting: '',
    source: 'page',
  };
}

/** A company's name from a word in an address: "harbor-and-pine" as "Harbor and Pine". */
function nameFrom(part: string): string {
  let text = part;
  try {
    text = decodeURIComponent(part);
  } catch {
    // Left as it is.
  }
  if (/^\d+$/.test(text)) return '';
  return text
    .split(/[-_.+\s]+/)
    .filter(Boolean)
    .map((word, at) =>
      at > 0 && SMALL_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ')
    .slice(0, 100);
}

/**
 * A company's name from a job's address, for a page that doesn't name one: the company's own site,
 * as "careers.lumen.example" is "Lumen", or the company an applicant system's address names, as
 * "jobs.lever.co/harbor-and-pine/…" is "Harbor and Pine". A job board's address names none.
 */
export function companyFromAddress(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase();
  if (BOARD.test(host)) return '';
  const labels = host.split('.');
  if (COMPANY_IN_PATH.test(host)) {
    const [first = ''] = labels;
    const fromPath = parsed.pathname.split('/').find((part) => part && !GENERIC.test(part)) ?? '';
    const name = !GENERIC.test(first) && labels.length > 2 ? first : fromPath;
    return nameFrom(parsed.searchParams.get('for') ?? name);
  }
  const own = labels.find((label) => !GENERIC.test(label)) ?? '';
  return nameFrom(own.replace(/^(careers|jobs)-/, ''));
}

/**
 * What a save without the popup would need checked first, or null when it looks like one job, with
 * its title, company and posting: a page that isn't one job's own, or that can't be read, a title,
 * company or posting it couldn't find, or a posting taken from the page's main text, which may not
 * be a posting at all. A LinkedIn job saved by its link alone, as you chose, needs no posting. The
 * popup shows each of these, to check.
 */
export function needsChecking(page: PageJob, job: JobToSave, unread: Unread): string | null {
  if (!isJobAddress(job.url)) return 'This isn’t one job’s page.';
  if (unread === 'unreadable') return 'It can’t read this page.';
  if (!job.role) return 'It couldn’t tell the job’s title.';
  if (!job.company) return 'It couldn’t tell the company.';
  if (!job.posting && unread !== 'linkedin-link-only') return 'It couldn’t find the posting.';
  if (page.source === 'main') return 'It couldn’t tell the posting from the rest of the page.';
  return null;
}

/** The job to save from what was read, with the company from its address when the page names none. */
export function toSave(page: PageJob): JobToSave {
  return {
    url: page.url,
    site: page.site,
    company: page.company.trim() || companyFromAddress(page.url),
    role: page.title.trim(),
    pay: page.pay,
    posting: page.posting,
  };
}
