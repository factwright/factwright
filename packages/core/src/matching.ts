import { boardPostingId, boardSource, workablePostingId } from './boards.ts';
import { companyKey, slug } from './keys.ts';
import { isJobLink, normalizeUrl } from './links.ts';

/**
 * Telling whether two finds are one job, the same way everywhere: when the app joins what the
 * skills found into jobs, when find_job tells a skill whether the user has seen a job, and when
 * the user merges two jobs by hand.
 */

/** An ID as Lever and Ashby give a posting, and as Indeed gives a listing. */
const OPAQUE_ID = /^[\w-]{1,100}$/;

/**
 * A key for the one posting a link is to, the same however the link is written: the applicant
 * system's own ID for it, such as "greenhouse:4567890" for boards.greenhouse.io and
 * job-boards.greenhouse.io alike, or for a company's site with ?gh_jid=4567890, and Workable's
 * shortcode, as "workable:1b6e0a1710". LinkedIn's is the number in jobs/view/<id>, whatever it says
 * around it, and Indeed's is its jk. Null for a link to a whole board, or to a site this doesn't
 * know.
 */
export function postingKey(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // A company's own site, with its board inside it, names the posting in its query.
  const greenhouse = url.searchParams.get('gh_jid');
  if (greenhouse && /^\d{1,20}$/.test(greenhouse)) return `greenhouse:${greenhouse}`;
  const ashby = url.searchParams.get('ashby_jid');
  if (ashby && OPAQUE_ID.test(ashby)) return `ashby:${ashby.toLowerCase()}`;
  const board = boardSource(address);
  if (board) {
    const id = boardPostingId(address);
    if (!id || !OPAQUE_ID.test(id)) return null;
    // Greenhouse's, Lever's and Ashby's IDs are their own across every board. Gem's go by board.
    if (board.kind === 'greenhouse') return /^\d+$/.test(id) ? `greenhouse:${id}` : null;
    if (board.kind === 'gem') return `gem:${board.board.toLowerCase()}:${id}`;
    return `${board.kind}:${id.toLowerCase()}`;
  }
  // Workable's IDs are its own across every company, as its short links name no company.
  const workable = workablePostingId(address);
  if (workable) return `workable:${workable.toLowerCase()}`;
  const workday = workdayPosting(host, url.pathname);
  if (workday) return workday;
  const icims = icimsPosting(host, url.pathname);
  if (icims) return icims;
  const taleo = taleoPosting(host, url);
  if (taleo) return taleo;
  const successFactors = successFactorsPosting(host, url);
  if (successFactors) return successFactors;
  if (/(^|\.)linkedin\.com$/.test(host) && /^\/jobs(\/|$)/.test(url.pathname)) {
    // jobs/view/<id>, or jobs/view/<its title>-<id>.
    const view = url.pathname.match(/^\/jobs\/view\/([^/]+)/)?.[1];
    const id = view?.match(/(?:^|-)(\d+)$/)?.[1] ?? url.searchParams.get('currentJobId');
    return id && /^\d{1,20}$/.test(id) ? `linkedin:${id}` : null;
  }
  if (/(^|\.)indeed\.com$/.test(host)) {
    const id = url.searchParams.get('jk') ?? url.searchParams.get('vjk');
    return id && OPAQUE_ID.test(id) ? `indeed:${id.toLowerCase()}` : null;
  }
  return null;
}

/**
 * A Workday posting's key, by the company's own site on Workday and the posting's ID, which ends
 * its job's part of the address, after the last "_": the same for the posting and its
 * application, as "…/job/Denver/Product-Manager_R101" and "…/Product-Manager_R101/apply" are. A
 * company's site is its own name at myworkdayjobs.com, or the part after "recruiting" at
 * myworkdaysite.com.
 */
function workdayPosting(host: string, path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  let site = '';
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(host)) site = host.split('.')[0] ?? '';
  else if (/^(wd\d+\.)?myworkdaysite\.com$/.test(host)) {
    const at = parts.indexOf('recruiting');
    site = at < 0 ? '' : (parts[at + 1] ?? '');
  } else return null;
  const job = parts.findIndex((part) => part === 'job' || part === 'details');
  if (!site || job < 0) return null;
  const after = parts.slice(job + 1);
  const ends = after.indexOf('apply');
  const posting = (ends < 0 ? after : after.slice(0, ends)).at(-1) ?? '';
  const id = /_([A-Za-z0-9-]{1,40})$/.exec(posting)?.[1];
  return id ? `workday:${site.toLowerCase()}:${id.toLowerCase()}` : null;
}

/**
 * An iCIMS posting's key, by the company's site on iCIMS and the job's number, which follows
 * "/jobs/" in the posting's address and its application's alike, as
 * "careers-acme.icims.com/jobs/1234/engineer/job" and "…/jobs/1234/engineer/candidate" are.
 */
function icimsPosting(host: string, path: string): string | null {
  if (!/^[a-z0-9-]+\.icims\.com$/.test(host) || host === 'www.icims.com') return null;
  const id = /^\/jobs\/(\d{1,12})(?:\/|$)/.exec(path)?.[1];
  return id ? `icims:${host.split('.')[0]}:${id}` : null;
}

/** An ID as Taleo and SuccessFactors give a posting or a requisition: letters, digits and dashes. */
const REQUISITION = /^[\w-]{1,40}$/;

/**
 * A Taleo posting's key, by the company's site and the job's number: on Taleo Enterprise, its
 * "job" in a career section's posting and application alike, as
 * "acme.taleo.net/careersection/2/jobdetail.ftl?job=2600123" and "…/jobapply.ftl?job=2600123"
 * are, on the company's own name at taleo.net or its own site; on Taleo Business Edition, the
 * company's code and the requisition's, as "…/ats/careers/v2/applyRequisition?org=ACME&rid=4321".
 */
function taleoPosting(host: string, url: URL): string | null {
  const taleo = /^[a-z0-9-]+\.taleo\.net$/.test(host);
  if (/^\/careersection\//.test(url.pathname) && (taleo || /\.ftl$/.test(url.pathname))) {
    const job = url.searchParams.get('job') ?? '';
    const site = taleo ? (host.split('.')[0] ?? '') : host;
    return REQUISITION.test(job) ? `taleo:${site}:${job.toLowerCase()}` : null;
  }
  if (/(^|\.)tbe\.taleo\.net$/.test(host) && /\/ats\/careers\//.test(url.pathname)) {
    const org = url.searchParams.get('org') ?? '';
    const rid = url.searchParams.get('rid') ?? '';
    return REQUISITION.test(org) && REQUISITION.test(rid)
      ? `taleo:${org.toLowerCase()}:${rid.toLowerCase()}`
      : null;
  }
  return null;
}

/** The sites SuccessFactors' career pages are on, by their data centers' names. */
const SUCCESSFACTORS = /(^|\.)(successfactors\.(com|eu)|sapsf\.(com|eu|cn)|hr\.cloud\.sap)$/;

/**
 * A SuccessFactors posting's key, by the company's ID and the requisition's, which its posting
 * and its application on a career site name alike, as
 * "career4.successfactors.com/career?company=acme&career_job_req_id=1000" and
 * "…/sfcareer/jobreqcareer?jobId=1000&company=acme" do. A company's own career site, which names
 * its postings by IDs of its own, gives none.
 */
function successFactorsPosting(host: string, url: URL): string | null {
  if (!SUCCESSFACTORS.test(host)) return null;
  const company = url.searchParams.get('company') ?? url.searchParams.get('career_company') ?? '';
  const job = url.searchParams.get('career_job_req_id') ?? url.searchParams.get('jobId') ?? '';
  return REQUISITION.test(company) && REQUISITION.test(job)
    ? `successfactors:${company.toLowerCase()}:${job.toLowerCase()}`
    : null;
}

/** The site a posting's key is on, such as "greenhouse" or "linkedin". */
export const postingSite = (key: string) => key.split(':', 1)[0] ?? '';

/**
 * Whether two sets of postings are on the same site but none is the same: two postings, so two
 * jobs, however alike their titles. A posting with no key, such as on a company's own site, says
 * nothing either way.
 */
export function otherPostings(a: Iterable<string>, b: Iterable<string>): boolean {
  const first = new Set(a);
  const second = [...b];
  if (second.some((key) => first.has(key))) return false;
  const sites = new Set([...first].map(postingSite));
  return second.some((key) => sites.has(postingSite(key)));
}

/** A role's title, as matching reads it: its level, such as senior or staff, and its other words. */
export interface TitleWords {
  /** Its levels, such as ["senior"] or ["2"] for "II", sorted. */
  levels: string[];
  /** What the role is, such as ["backend", "engineer", "software"], sorted. */
  words: string[];
  /**
   * The last word of each part of the title, which says what the part is: "engineer" and "tool"
   * for "Staff Engineer, Developer Tools", where "developer" only says which tools. Sorted.
   */
  heads: string[];
}

/** Short forms, written out: "Sr. SWE" is "senior software engineer". */
const SPELLED_OUT: ReadonlyMap<string, readonly string[]> = new Map([
  ['sr', ['senior']],
  ['snr', ['senior']],
  ['jr', ['junior']],
  ['jnr', ['junior']],
  ['mgr', ['manager']],
  ['mngr', ['manager']],
  ['dir', ['director']],
  ['assoc', ['associate']],
  ['swe', ['software', 'engineer']],
  ['sde', ['software', 'development', 'engineer']],
  ['sre', ['site', 'reliability', 'engineer']],
  ['em', ['engineering', 'manager']],
  ['tpm', ['technical', 'program', 'manager']],
  ['tech', ['technical']],
  ['ml', ['machine', 'learning']],
  ['admin', ['administrator']],
  ['ops', ['operations']],
  ['intl', ['international']],
  ['svp', ['senior', 'vp']],
  ['evp', ['executive', 'vp']],
  ['avp', ['assistant', 'vp']],
  ['ceo', ['chief', 'executive', 'officer']],
  ['cto', ['chief', 'technology', 'officer']],
  ['cfo', ['chief', 'financial', 'officer']],
  ['coo', ['chief', 'operating', 'officer']],
  ['cmo', ['chief', 'marketing', 'officer']],
]);

/** Words written apart or with a hyphen, as one: "front-end" and "front end" are "frontend". */
const JOINED: ReadonlyMap<string, string> = new Map([
  ['front end', 'frontend'],
  ['back end', 'backend'],
  ['full stack', 'fullstack'],
  ['dev ops', 'devops'],
  ['on site', 'onsite'],
  ['in office', 'inoffice'],
  ['full time', 'fulltime'],
  ['part time', 'parttime'],
  ['vice president', 'vp'],
  ['co founder', 'cofounder'],
  ['e commerce', 'ecommerce'],
  ['entry level', 'junior'],
  ['mid level', 'mid'],
]);

/** Words that say how senior a role is, each as one level: "II" and "2" are both "2". */
const LEVELS: ReadonlyMap<string, string> = new Map([
  ['intern', 'intern'],
  ['internship', 'intern'],
  ['junior', 'junior'],
  ['entry', 'junior'],
  ['associate', 'associate'],
  ['mid', 'mid'],
  ['intermediate', 'mid'],
  ['senior', 'senior'],
  ['staff', 'staff'],
  ['principal', 'principal'],
  ['distinguished', 'distinguished'],
  ['fellow', 'fellow'],
  ['lead', 'lead'],
  ['head', 'head'],
  ['director', 'director'],
  ['vp', 'vp'],
  ['chief', 'chief'],
  ['i', '1'],
  ['ii', '2'],
  ['iii', '3'],
  ['iv', '4'],
  ['v', '5'],
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['4', '4'],
  ['5', '5'],
]);

/** Words that say nothing about the role. */
const FILLER = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'for',
  'to',
  'in',
  'at',
  'on',
  'with',
  'also',
  'level',
  'team',
  'role',
  'position',
  'opening',
  'job',
  'new',
]);

/** Where and how the job is worked, which a listing adds or leaves off: "(Remote)". */
const ARRANGEMENT = new Set(['remote', 'hybrid', 'onsite', 'inoffice', 'fulltime', 'wfh']);

/**
 * Words for a kind of work in itself, so a title that adds one, such as "Engineer" and
 * "Engineer, Support", is another job. A team, a place or a specialty only says more about
 * the same one.
 */
const ROLE_NOUNS = new Set([
  'engineer',
  'developer',
  'programmer',
  'architect',
  'scientist',
  'analyst',
  'designer',
  'researcher',
  'manager',
  'officer',
  'president',
  'founder',
  'cofounder',
  'owner',
  'consultant',
  'specialist',
  'coordinator',
  'administrator',
  'assistant',
  'advocate',
  'recruiter',
  'writer',
  'editor',
  'producer',
  'marketer',
  'strategist',
  'accountant',
  'attorney',
  'lawyer',
  'counsel',
  'paralegal',
  'nurse',
  'physician',
  'teacher',
  'instructor',
  'technician',
  'mechanic',
  'operator',
  'representative',
  'rep',
  'agent',
  'partner',
  'executive',
  'tester',
  'support',
  'advisor',
  'adviser',
  'planner',
  'buyer',
  'auditor',
  'controller',
  'clerk',
  'therapist',
  'pharmacist',
  'generalist',
]);

/** A word without its plural "s": "tools" is "tool", while "status", "ios" and "access" stay. */
function singular(word: string): string {
  return word.length >= 5 && word.endsWith('s') && !/(ss|us|is)$/.test(word)
    ? word.slice(0, -1)
    : word;
}

/**
 * Where a title's parts meet: "Staff Engineer, Developer Tools (Remote) | Berlin - EU". Each part
 * is trimmed as its words are read, so the marks take no spaces with them, which would read a
 * long run of spaces again from each space in it.
 */
const PARTS = /[,()|/:;–—]|\s-\s/;

/** A part of a title's words: short forms written out, and words written apart joined. */
function partWords(part: string): string[] {
  const raw = slug(part).split('-').filter(Boolean);
  // "Eng Manager" is engineering's, and "Software Eng" an engineer.
  const managing = new Set(['manager', 'mgr', 'director', 'dir', 'lead', 'head', 'vp']);
  const spelled = raw.flatMap((word, i): readonly string[] => {
    const next = raw[i + 1] ?? '';
    if (word === 'eng') return [managing.has(next) ? 'engineering' : 'engineer'];
    if (word === 'dev') return [managing.has(next) ? 'development' : 'developer'];
    return SPELLED_OUT.get(word) ?? [word];
  });
  const joined: string[] = [];
  for (let i = 0; i < spelled.length; i++) {
    const pair = JOINED.get(`${spelled[i]} ${spelled[i + 1] ?? ''}`);
    if (pair) {
      joined.push(pair);
      i += 1;
    } else joined.push(spelled[i] as string);
  }
  return joined;
}

/**
 * A role's title, read for matching: lowercase, with short forms written out ("Sr." is
 * "senior"), its level apart from what the role is, and what doesn't say what the role is left
 * out: "the", "(Remote)", "(m/w/d)". What's in parentheses counts, so "(Backend)" and
 * "(Frontend)" are told apart.
 */
export function readTitle(title: string): TitleWords {
  const levels = new Set<string>();
  const words = new Set<string>();
  const heads = new Set<string>();
  for (const part of title.split(PARTS)) {
    let head: string | null = null;
    for (const word of partWords(part)) {
      const level = LEVELS.get(word) ?? (/^l[1-9]$/.test(word) ? word : undefined);
      if (level) levels.add(level);
      else if (word.length > 1 && !FILLER.has(word) && !ARRANGEMENT.has(word)) {
        head = singular(word);
        words.add(head);
      }
    }
    if (head) heads.add(head);
  }
  return { levels: [...levels].sort(), words: [...words].sort(), heads: [...heads].sort() };
}

/** Whether a title says anything at all. */
export const isTitled = (title: TitleWords) => title.levels.length > 0 || title.words.length > 0;

/**
 * How two titles compare:
 * - **same:** the same level and the same words, however they're written or ordered.
 * - **more:** the same level, and one says more about the same work, such as its team: "Staff
 *   Engineer" and "Staff Software Engineer, Platform".
 * - **apart:** the same level, and each says something the other doesn't: "(Backend)" and
 *   "(Frontend)".
 * - **different:** another level, such as "Software Engineer" and "Senior Software Engineer",
 *   or one adds another kind of work, such as "Product Designer, Researcher", or one says
 *   nothing.
 */
export type TitleFit = 'same' | 'more' | 'apart' | 'different';

export function titleFit(a: TitleWords, b: TitleWords): TitleFit {
  if (a.levels.join(' ') !== b.levels.join(' ')) return 'different';
  const onlyA = a.words.filter((word) => !b.words.includes(word));
  const onlyB = b.words.filter((word) => !a.words.includes(word));
  if (onlyA.length === 0 && onlyB.length === 0) return 'same';
  if (onlyA.length > 0 && onlyB.length > 0) return 'apart';
  const [fewer, more] = onlyA.length > 0 ? [b, a] : [a, b];
  const extra = onlyA.length > 0 ? onlyA : onlyB;
  const anotherRole = extra.some((word) => ROLE_NOUNS.has(word) && more.heads.includes(word));
  return fewer.words.length === 0 || anotherRole ? 'different' : 'more';
}

/**
 * How a title compares with every title a job goes by: the same as one of them, or saying more
 * or less than one while apart from none, which a job written two ways can be. Otherwise not this
 * job.
 */
export function titlesFit(
  titles: readonly TitleWords[],
  title: TitleWords,
): 'same' | 'more' | 'different' {
  const fits = titles.map((each) => titleFit(each, title));
  if (fits.includes('same')) return 'same';
  return fits.includes('more') && !fits.includes('apart') ? 'more' : 'different';
}

/**
 * Words that alone never name one company, so "Scale AI" isn't "AI", and "Acme Labs" not "Labs".
 */
const GENERIC_COMPANY = new Set([
  'ai',
  'app',
  'apps',
  'analytics',
  'bank',
  'bio',
  'capital',
  'cloud',
  'consulting',
  'data',
  'digital',
  'energy',
  'financial',
  'games',
  'global',
  'group',
  'health',
  'hq',
  'international',
  'io',
  'lab',
  'labs',
  'media',
  'network',
  'networks',
  'partners',
  'robotics',
  'security',
  'services',
  'software',
  'solutions',
  'studio',
  'studios',
  'systems',
  'tech',
  'technologies',
  'technology',
  'therapeutics',
  'us',
  'usa',
  'ventures',
]);

/** A company as matching knows it: its name, and its key from companyKey. */
export interface CompanyName {
  company: string;
  companyKey: string;
}

/**
 * How two companies compare: the same, by their keys, or for names with no key, such as
 * 株式会社メルカリ, by the names; related, when one's name holds the other's word for word, such
 * as "Acme" and "Acme Robotics", or "DeepMind" and "Google DeepMind"; or different.
 */
export function companyMatch(a: CompanyName, b: CompanyName): 'same' | 'related' | 'different' {
  if (!a.companyKey || !b.companyKey) {
    if (a.companyKey || b.companyKey) return 'different';
    const name = (each: CompanyName) => each.company.normalize('NFKC').trim().toLowerCase();
    return name(a) !== '' && name(a) === name(b) ? 'same' : 'different';
  }
  if (a.companyKey === b.companyKey) return 'same';
  const [shorter, longer] =
    a.companyKey.length <= b.companyKey.length
      ? [a.companyKey, b.companyKey]
      : [b.companyKey, a.companyKey];
  if (!`-${longer}-`.includes(`-${shorter}-`)) return 'different';
  return shorter.split('-').every((word) => GENERIC_COMPANY.has(word)) ? 'different' : 'related';
}

/** What a job goes by, for telling whether two are one: its company, its role and its links. */
export interface JobIdentity extends CompanyName {
  role: string;
  links: readonly { url: string }[];
}

/**
 * How likely two jobs are one, most likely first:
 * - **posting:** a link to the same posting, by its address or its ID, at any company;
 * - **role:** the same role at the same company, however it's written, or at a company whose
 *   name holds the other's, or a title saying more about the same work at the same company,
 *   with no other posting on the same site;
 * - **company:** another role at the same company, or one whose name holds the other's.
 * Null for jobs at different companies.
 */
export function jobLikeness(a: JobIdentity, b: JobIdentity): 'posting' | 'role' | 'company' | null {
  const urls = (job: JobIdentity) =>
    job.links
      .map((link) => link.url)
      .filter(isJobLink)
      .map(normalizeUrl);
  const postings = (job: JobIdentity) => job.links.flatMap((link) => postingKey(link.url) ?? []);
  const theirUrls = new Set(urls(b));
  const theirPostings = postings(b);
  if (
    urls(a).some((url) => theirUrls.has(url)) ||
    postings(a).some((key) => theirPostings.includes(key))
  ) {
    return 'posting';
  }
  const company = companyMatch(a, b);
  if (company === 'different') return null;
  const fit = titleFit(readTitle(a.role), readTitle(b.role));
  const alike = fit === 'same' || (company === 'same' && fit === 'more');
  return alike && !otherPostings(postings(a), theirPostings) ? 'role' : 'company';
}

/** What identifies a job when the user or a skill names it. */
export interface JobQuery {
  company: string;
  role?: string;
  link?: string;
}

/**
 * How a job on file matches what a skill asked about, as the app tells one job from another: by
 * a link to the same posting, at any company; by the same role, at the same company or one whose
 * name holds the other's; or as another job at the company.
 */
export type JobMatch = 'posting' | 'role' | 'company';

const MATCH_ORDER: Readonly<Record<JobMatch, number>> = { posting: 0, role: 1, company: 2 };

/** The jobs that match a company, or a link, best match first, with how each matches. */
export function matchJobs<T extends JobIdentity>(
  jobs: readonly T[],
  query: JobQuery,
): { job: T; match: JobMatch }[] {
  const asked = {
    company: query.company,
    companyKey: companyKey(query.company),
    role: query.role ?? '',
    links: query.link ? [{ url: query.link }] : [],
  };
  return jobs
    .flatMap((job) => {
      const known = { ...job, companyKey: job.companyKey || companyKey(job.company) };
      const match = jobLikeness(known, asked);
      return match ? [{ job, match }] : [];
    })
    .sort((a, b) => MATCH_ORDER[a.match] - MATCH_ORDER[b.match]);
}

/**
 * Whether a job has a posting of its own: a link to one job, by its address or its ID, and not
 * only a board's address, a Hacker News post or the company's site.
 */
export const hasOwnPosting = (job: { links: readonly { url: string }[] }) =>
  job.links.some((link) => isJobLink(link.url) || postingKey(link.url) !== null);

/**
 * How a job on a page goes with the jobs on file, as the browser extension tells when it saves the
 * page, and when its popup says whether the job is saved:
 * - **same:** a job with the same posting, by its address or its ID, which saving finds there;
 * - **joins:** the one job with the same role at the same company, its title the same however
 *   it's written, where one of the two has no posting of its own, only a board's address, a Hacker
 *   News post or the company's site, so saving adds the page's link and posting to it;
 * - **role:** the one job with the same role at the company, as matching reads it otherwise, as
 *   one with another posting of its own, or a title saying more, which filling a form takes as the
 *   form's job, and saving makes a new job beside.
 */
export type SavedHow = 'same' | 'joins' | 'role';

/** The job on file a page is for, with how, or null for none. */
export function savedJobFor<T extends JobIdentity>(
  jobs: readonly T[],
  page: { url: string; company: string; role: string },
): { job: T; how: SavedHow } | null {
  const matches = matchJobs(jobs, { company: page.company, role: page.role, link: page.url });
  const same = matches.find(({ match }) => match === 'posting');
  if (same) return { job: same.job, how: 'same' };
  const roles = matches.filter(({ match }) => match === 'role');
  // Joining changes the job on file, so only one job it can't be mistaken for: the same company
  // and the same title, never one whose name only holds the page's, or whose title says more.
  const pagePosting = hasOwnPosting({ links: [{ url: page.url }] });
  const name = { company: page.company, companyKey: companyKey(page.company) };
  const title = readTitle(page.role);
  const joins = roles.filter(
    ({ job }) =>
      (!pagePosting || !hasOwnPosting(job)) &&
      companyMatch(
        { company: job.company, companyKey: job.companyKey || companyKey(job.company) },
        name,
      ) === 'same' &&
      titleFit(readTitle(job.role), title) === 'same',
  );
  const [joined, ...others] = joins;
  if (joined && others.length === 0) return { job: joined.job, how: 'joins' };
  const [only, ...more] = roles;
  return only && more.length === 0 ? { job: only.job, how: 'role' } : null;
}

/**
 * Whether two jobs on file are surely one job found twice, as your Claude's Analyze job merges
 * them: the same posting, by its address or its ID, at any company; or the same role at the same
 * company, its title the same however it's written, where one of the two has no posting of its
 * own, only a board's address, a Hacker News post or the company's site. Null for anything less
 * sure, which the user decides with Merge.
 */
export function sameJob(a: JobIdentity, b: JobIdentity): 'posting' | 'role' | null {
  const named = (job: JobIdentity) => ({
    company: job.company,
    companyKey: job.companyKey || companyKey(job.company),
  });
  const like = jobLikeness({ ...a, ...named(a) }, { ...b, ...named(b) });
  if (like === 'posting') return 'posting';
  if (like !== 'role') return null;
  const company = companyMatch(named(a), named(b));
  const title = titleFit(readTitle(a.role), readTitle(b.role));
  const oneHasNone = !hasOwnPosting(a) || !hasOwnPosting(b);
  return company === 'same' && title === 'same' && oneHasNone ? 'role' : null;
}
