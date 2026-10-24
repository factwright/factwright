import { boardPostingId, boardSource } from './boards.ts';
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
 * job-boards.greenhouse.io alike, or for a company's site with ?gh_jid=4567890. LinkedIn's is the
 * number in jobs/view/<id>, whatever it says around it, and Indeed's is its jk. Null for a link to
 * a whole board, or to a site this doesn't know.
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
