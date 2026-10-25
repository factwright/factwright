import { hostOf } from '@factwright/core';
import { isCopyOnlySite, jobSites, onAnySite } from './applicant-systems.ts';
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

/** Search engines, whose results are never one job's posting, though a search for jobs shows many. */
const SEARCH_ENGINE =
  /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yandex\.[a-z.]+|baidu\.com|ecosia\.org|startpage\.com|search\.brave\.com|kagi\.com)$/i;

/**
 * A search engine's page of results, by its path, as "/search", with what's searched for in the
 * address or not, as a search sent from a form leaves it out, and not its other pages, such as its
 * careers.
 */
const SEARCH_PATH = /^\/((\w+\/)?d?search|s|html)\/?$/i;
/** The query's name for what's searched for, as a results page at a site's root has it. */
const SEARCH_QUERY = /^(q|p|wd|text|query)$/i;

/**
 * Words in a page's address that are about jobs, in its site's name or its path, as
 * "careers.example.com", "/jobs/42" and "/en/careers/data-lead" have.
 */
const JOB_WORD =
  /^(jobs?|careers?|positions?|openings?|vacanc(y|ies)|requisitions?|hiring|apply|internships?|recruit(ing|ment)?|talent|karriere|stellen(angebote)?|emplois?|empleos?|vacatures)$/i;

/** A query's name for one job, as a careers page says which of its Greenhouse board's it shows. */
const JOB_QUERY =
  /^(gh_jid|ashby_jid|jobs?(_?id)?|req(uisition)?_?id|(posting|vacancy|position|opening)_?id)$/i;

/**
 * Words in a page's title that name a job, or jobs: a role, as "Account Executive", or "Careers",
 * or the genders a posting names, as German and French ones do with "(m/w/d)" and "(H/F)".
 */
const JOB_TITLE =
  /\b((job|career|opening|position|internship|intern|engineer|developer|designer|manager|pm|scientist|director|analyst|architect|researcher|specialist|consultant|administrator|programmer|recruiter|marketer|technician|coordinator|accountant|attorney|generalist|nurse|teacher|driver|associate|representative|executive|officer|lead|writer|editor|assistant|advisor|strategist)s?|hiring|vacanc(y|ies)|head of|devops|sre|cto|vp|counsel)\b|\(\s*[mwfdhvx]\s*\/\s*[mwfdhvx](\s*\/\s*(div\.?|[mwfdhvx]))?\s*\)|\(all genders\)/i;

/**
 * What job postings say, a kind of thing to each: what you'd do, what it asks of you, the years of
 * experience it wants, its benefits, its pay, its hours, how to apply, its equal-opportunity line,
 * and what it calls itself, in English, and as German, French, Spanish and Dutch postings most
 * often put them. A posting says several. A page that isn't one says none, or one in passing, as an
 * article may mention "benefits".
 */
const POSTING_SAYS = [
  /\b(responsibilities|duties|what you[’']?(ll| will) (do|be doing)|in this role|about the role|your role|ihre aufgaben|deine aufgaben|ihr aufgabengebiet|vos missions|tus funciones|wat ga je doen|jouw taken)(?![a-z])/i,
  /\b(qualifications|requirements|what you[’']?(ll| will) bring|what we[’']?re looking for|who you are|nice to haves?|bonus points|ihr profil|dein profil|anforderungen|votre profil|profil recherché|requisitos|wat vragen wij|wat breng je mee)(?![a-z])/i,
  /\b(years of ([a-z-]+ ){0,2}experience|years[’']? experience|experience (is )?(required|preferred)|berufserfahrung|ann?(ée)?s d[’']expérience|años de experiencia|jaar (werk)?ervaring|werkervaring)(?![a-z])/i,
  /\b(benefits|perks|401\(?k|paid time off|parental leave|health insurance|dental and vision|wir bieten|nous offrons|ofrecemos|wat bieden wij|wat wij bieden)(?![a-z])/i,
  /\b(salary|compensation|pay range|base pay|pay rate|hourly rate|hourly wage|gehalt|vergütung|salaire|rémunération|salario|sueldo|salaris)(?![a-z])|[$€£]\s?(\d{2,3}([.,]\d{3})+|\d{2,3}k)\b|\b\d{2,3}([.,]\d{3})+\s?€|[$£]\s?\d+(\.\d\d)?\s?(\/|per |an )\s?(hr|hour)\b/i,
  /\b(full[- ]time|part[- ]time|employment type|job type|internship|temps plein|temps partiel|jornada completa|media jornada|tiempo completo)(?![a-z])|\b(vollzeit|teilzeit)/i,
  /\b(apply (now|today|for this (job|position|role))|how to apply|submit (your|an?) (resume|résumé|application|cv)|cover letter|jetzt bewerben|bewirb dich|ihre bewerbung|deine bewerbung|postuler|postulez|candidatez|postúlate|solliciteer)(?![a-z])/i,
  /\b(equal (employment )?opportunity|affirmative action|without regard to|reasonable accommodations?|veteran status|visa sponsorship|e-verify|chancengleichheit|situation de handicap|igualdad de oportunidades)(?![a-z])/i,
  /\b(job (description|summary|requisition)|position (summary|overview|description)|about the (job|position|team)|we[’']?re hiring|join (our|the) team|stellenbeschreibung|stellenangebot|offre d[’']emploi|oferta de empleo|vacature)(?![a-z])/i,
];

/** Whether a page is a search engine's results. */
function isSearchPage(url: URL): boolean {
  if (!SEARCH_ENGINE.test(url.hostname)) return false;
  // What some put after the path, as Yahoo's ";_ylt=…", is no part of it.
  const path = url.pathname.split(';')[0] ?? '';
  return (
    SEARCH_PATH.test(path) ||
    (path === '/' && [...url.searchParams.keys()].some((name) => SEARCH_QUERY.test(name)))
  );
}

/** Whether a page's address has words about jobs, or a query's name for one job. */
function addressNamesJobs(url: URL): boolean {
  // A careers site's route after "#/", which jobAddress keeps, is part of its path, and a word run
  // into the next, as in "JobDetail.aspx", is a word of its own.
  const route = /^#!?\//.test(url.hash) ? url.hash : '';
  const words = `${url.hostname}${url.pathname}${route}`
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .split(/[/._+!#-]+/);
  return (
    words.some((word) => JOB_WORD.test(word)) ||
    [...url.searchParams.keys()].some((name) => JOB_QUERY.test(name))
  );
}

/**
 * Whether a page looks like a job's, for the popup to fill in its title and company, and for a save
 * without the popup to take it. A search engine's results never do, whatever they say, even with a
 * posting's text selected among them. Otherwise its own job data, a job site's own posting, text
 * you selected, or an applicant system's site says so at once. Anywhere else, it takes two signs:
 * words in its address or title about jobs, or kinds of things postings say, such as their duties,
 * the qualifications they ask for, their pay and their equal-opportunity line. One is enough where
 * the page shows no text to go by, as a careers page that's all one form doesn't. A page it can't
 * read, or LinkedIn's by its link alone, gets the benefit of the doubt, and so do LinkedIn's and
 * Indeed's, whose addresses tell which pages are one job's.
 */
export function looksLikeJob(page: PageJob, unread: Unread): boolean {
  let url: URL;
  try {
    url = new URL(page.url);
  } catch {
    return true;
  }
  if (isSearchPage(url)) return false;
  if (unread || page.source === 'structured' || page.source === 'selection') return true;
  if (page.source === 'page' && page.posting.trim()) return true;
  // Only a job's own data, or a job site's layout, gives its place, pay, hours or date.
  if (page.location || page.pay || page.employment || page.posted) return true;
  if (isCopyOnlySite(page.url) || onAnySite(page.url, jobSites(false))) return true;
  const signs =
    Number(addressNamesJobs(url)) +
    Number(JOB_TITLE.test(`${page.title} ${page.pageTitle}`)) +
    POSTING_SAYS.filter((says) => says.test(page.posting)).length;
  // One sign is often chance, as a news article's "benefits" is.
  return signs >= (page.posting.trim() ? 2 : 1);
}

/**
 * What a save without the popup would need checked first, or null when it looks like one job, with
 * its title, company and posting: a page that isn't one job's own, that doesn't look like a job's
 * at all, or that can't be read, a title, company or posting it couldn't find, or a posting taken
 * from the page's main text, which may not be a posting at all. A LinkedIn job saved by its link
 * alone, as you chose, needs no posting. The popup shows each of these, to check.
 */
export function needsChecking(page: PageJob, job: JobToSave, unread: Unread): string | null {
  if (!isJobAddress(job.url)) return 'This isn’t one job’s page.';
  if (!looksLikeJob(page, unread)) return 'This doesn’t look like a job posting.';
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
