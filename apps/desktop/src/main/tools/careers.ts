import {
  type BoardJob,
  boardJobLine,
  boardSource,
  boardSystem,
  type JobPostingFields,
  jobPostingFields,
  jobsMarkdown,
  listLine,
  localDate,
  NO_ROBOTS,
  type Robots,
  readSitemap,
  robotsAllow,
  SUCCESSFACTORS,
  titleFilter,
} from '@factwright/core';
import { type Fetch, FOLDER_NAME, fetchInTime, reasonOf } from './posting.ts';
import { FetchAnswered, FetchRefused, linkProblem } from './safe-fetch.ts';
import {
  capped,
  count,
  FROM_THE_WEB,
  fileSlug,
  headingLines,
  notFolder,
  robotsOf,
  type SearchToolDeps,
  saveInSearch,
  wordsTag,
} from './search.ts';

/** The most a sitemap may weigh. The sitemaps protocol allows 50 MB, which is rare. */
const SITEMAP_MAX_BYTES = 25_000_000;
/** The most requests for sitemaps one call makes, answered or not. Big employers' run to 40 or so. */
const MAX_SITEMAPS = 50;
/** The most sitemaps' text one call holds, and the most links, so huge ones can't fill memory. */
const MAX_SITEMAP_TEXT = 100_000_000;
const MAX_LINKS = 200_000;
/** The most postings one call reads for their job data. */
const MAX_PAGES = 12;
/** How long reading sitemaps may go on, leaving time for the pages themselves. */
const SITEMAPS_MS = 22_000;
/** How long reading pages may go on, leaving time to save what was read. */
const PAGES_MS = 38_000;
/** The most links with the titles' words kept, of those checked against robots.txt, and in all. */
const MAX_MATCHES = 1_000;
const MAX_CHECKS = 5_000;
const MAX_CANDIDATES = 20_000;
/** A link's path this long is no posting's. Leaving it out keeps robots.txt's rules quick to check. */
const MAX_LINK_PATH = 500;
/** How many links to look at before letting the rest of the app run, as tools run in its main process. */
const LINKS_PER_TURN = 200;
/** How much of an answer lists links that weren't read, as Claude Code moves long answers away. */
const MAX_UNREAD_TEXT = 6_000;

/**
 * Systems whose terms or robots.txt keep software out, which this reader stays out of too, even when
 * a company's own site sends it there. Someone can still open these in a browser, and the extension
 * saves what they pick.
 */
const OFF_LIMITS: readonly (readonly [RegExp, string])[] = [
  [/(^|\.)(ultipro\.(com|ca)|ukg\.(com|net))$/, 'UKG'],
  [SUCCESSFACTORS, 'SuccessFactors'],
  [/(^|\.)(neogov\.com|schooljobs\.com)$/, 'NEOGOV'],
  [/(^|\.)(nlx\.org|us\.jobs|usnlx\.com)$/, 'the National Labor Exchange'],
  [/(^|\.)oraclecloud\.com$/, 'Oracle'],
  [/(^|\.)smartrecruiters\.com$/, 'SmartRecruiters'],
];

/** A host as its name goes, in small letters, without the final dot a name can be written with. */
const plainHost = (host: string) => {
  const lower = host.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
};

function offLimits(host: string): string | null {
  const barred = OFF_LIMITS.find(([site]) => site.test(plainHost(host)))?.[1];
  return barred
    ? `Factwright doesn’t read ${barred}’s sites as a whole: its terms or robots.txt keep software out. Search it with allowed_domains, or the user can open it in their browser and save what they pick.`
    : null;
}

/** A site without "www.", so the two count as one. */
const bareHost = (host: string) => plainHost(host).replace(/^www\./, '');

/** A site's name and top level, so a company's sites count as one, as jobs.acme.com and acme.com. */
const baseOf = (host: string) => plainHost(host).split('.').slice(-2).join('.');

/** A sitemap's address, always https, or null for one that can't be read. */
function sitemapAddress(address: string): string | null {
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}

/** A gzipped file comes as it is, which the fetcher won't unpack. */
const isGzipped = (address: string) => new URL(address).pathname.endsWith('.gz');

/** What a sitemap's own path says about whether it lists jobs, whatever its site is called. */
const namesJobs = (address: string) =>
  /job|career|posting|position|opening|vacanc/i.test(new URL(address).pathname);

/** What a link's path says about whether it's to one posting. */
const looksLikePosting = (path: string) =>
  /\/(jobs?|positions?|openings?|vacanc(y|ies)|requisitions?|postings?|careers?)\/./i.test(path);

/** The pages a site's sitemaps list. */
interface SitePages {
  links: { link: string; changed: string | null }[];
  /** The sitemaps it asked for, those that answered, and those it didn't get to. */
  asked: number;
  read: number;
  left: number;
  /** What went wrong with the first it couldn't read. */
  failure: unknown;
  /** Whether a sitemap was left out for being gzipped. */
  gzipped: boolean;
}

/**
 * Every page a site's sitemaps list, the sitemaps that name jobs first, within the time given. An
 * index's sitemaps stay on its own site and must be ones `mayRead` allows, though those robots.txt
 * names itself are read as it invites. `note` hears each before a request goes to it. One that
 * can't be read leaves the others to go on with.
 */
async function pagesOf(
  starts: readonly string[],
  fetch: Fetch,
  stop: () => boolean,
  note: (url: string) => void,
  mayRead: (url: URL) => boolean,
): Promise<SitePages> {
  const jobsFirst = (a: string, b: string) => Number(namesJobs(b)) - Number(namesJobs(a));
  let gzipped = false;
  const usable = (address: string | null): address is string => {
    if (address === null || offLimits(new URL(address).hostname)) return false;
    if (!isGzipped(address)) return true;
    gzipped = true;
    return false;
  };
  const queue = starts.map(sitemapAddress).filter(usable).sort(jobsFirst);
  const seen = new Set<string>();
  const links: SitePages['links'] = [];
  let asked = 0;
  let read = 0;
  let text = 0;
  let failure: unknown = null;
  while (
    queue.length > 0 &&
    asked < MAX_SITEMAPS &&
    links.length < MAX_LINKS &&
    text < MAX_SITEMAP_TEXT &&
    !stop()
  ) {
    const next = queue.shift() ?? '';
    if (seen.has(next)) continue;
    seen.add(next);
    asked++;
    note(next);
    let answer: string;
    try {
      answer = String(await fetch(next, false, SITEMAP_MAX_BYTES));
    } catch (error) {
      failure ??= error;
      continue;
    }
    read++;
    text += answer.length;
    const sitemap = readSitemap(answer);
    if (sitemap.index) {
      const host = new URL(next).hostname;
      const others = sitemap.links
        .map(({ link }) => sitemapAddress(link))
        .filter(usable)
        .filter((child) => {
          const url = new URL(child);
          return url.hostname === host && mayRead(url);
        })
        .sort(jobsFirst)
        .slice(0, MAX_SITEMAPS);
      queue.push(...others);
    } else {
      for (const link of sitemap.links) links.push(link);
    }
  }
  return { links, asked, read, left: new Set(queue).size, failure, gzipped };
}

/** The links on the site with the titles' words, the likeliest to be open postings first. */
interface Matches {
  /** Those robots.txt allows, up to the most that are kept. */
  links: { link: string; changed: string | null }[];
  /** How many links have the words, and of those checked, how many robots.txt keeps it from. */
  withWords: number;
  barred: number;
}

/** Lets the rest of the app run, as a long loop here would stop its window and every other run. */
const nextTurn = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

/**
 * The links on a site with the titles' words. Thousands of links, or a robots.txt built to take long,
 * can't stop the app, as it takes turns with the rest of it, and stops when `stop` says.
 */
async function matchesIn(
  links: SitePages['links'],
  titles: readonly string[],
  home: ReadonlySet<string>,
  robots: Robots,
  stop: () => boolean,
): Promise<Matches> {
  const fits = titleFilter(titles);
  const candidates = new Map<string, { url: URL; changed: string | null; posting: boolean }>();
  let withWords = 0;
  let seen = 0;
  for (const { link, changed } of links) {
    if (++seen % LINKS_PER_TURN === 0) {
      await nextTurn();
      if (stop()) break;
    }
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (!home.has(bareHost(url.hostname)) || url.pathname.length > MAX_LINK_PATH) continue;
    url.protocol = 'https:';
    let words = url.pathname;
    try {
      words = decodeURIComponent(url.pathname);
    } catch {
      // A malformed path reads as it came.
    }
    if (!fits(words)) continue;
    const key = bareHost(url.hostname) + url.pathname.replace(/\/$/, '') + url.search;
    if (candidates.has(key)) continue;
    withWords++;
    if (candidates.size < MAX_CANDIDATES) {
      candidates.set(key, { url, changed, posting: looksLikePosting(url.pathname) });
    }
  }
  // Links that look like one posting first, as a site's pages about nursing can have the same words,
  // then the newest changes, as those are the likeliest to be open.
  const ordered = [...candidates.values()].sort(
    (a, b) =>
      Number(b.posting) - Number(a.posting) || (b.changed ?? '').localeCompare(a.changed ?? ''),
  );
  const kept: Matches['links'] = [];
  let barred = 0;
  let checked = 0;
  for (const { url, changed } of ordered) {
    if (kept.length >= MAX_MATCHES || checked >= MAX_CHECKS) break;
    if (++checked % LINKS_PER_TURN === 0) {
      await nextTurn();
      if (stop()) break;
    }
    if (robotsAllow(robots, url.pathname + url.search)) kept.push({ link: url.href, changed });
    else barred++;
  }
  return { links: kept, withWords, barred };
}

/** One posting read for its job data: a job to list, or why not. */
type PageRead =
  | { kind: 'job'; job: BoardJob }
  | { kind: 'closed' }
  | { kind: 'not a posting' }
  | { kind: 'unread' };

async function readJobPage(link: string, fetch: Fetch, today: string): Promise<PageRead> {
  let html: unknown;
  try {
    html = await fetch(link, false);
  } catch (error) {
    if (error instanceof FetchAnswered && (error.status === 404 || error.status === 410)) {
      return { kind: 'closed' };
    }
    // It didn't load, or would have sent the request off the site. The next may do better.
    return { kind: 'unread' };
  }
  let data: JobPostingFields | null = null;
  try {
    data = typeof html === 'string' ? jobPostingFields(html) : null;
  } catch {
    // A page can put anything in its job data, so what can't be read counts as none.
  }
  const title = listLine(data?.title);
  if (!data || !title) return { kind: 'not a posting' };
  if (data.closes && /^\d{4}-\d{2}-\d{2}$/.test(data.closes) && data.closes < today) {
    return { kind: 'closed' };
  }
  const company = listLine(data.company);
  const closes = listLine(data.closes);
  return {
    kind: 'job',
    job: {
      id: null,
      title,
      location: listLine(data.where),
      workplace: null,
      team: null,
      pay: listLine(data.pay),
      link,
      posted: listLine(data.posted),
      text: data.text,
      ...(company && { company }),
      ...(closes && { closes }),
    },
  };
}

export interface CareersSiteDeps extends SearchToolDeps {
  /** Waits, between pages, as long as a robots.txt asks. Tests pass their own. */
  wait?: (ms: number) => Promise<void>;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** As many links as fit in an answer, then how many more the file has. */
function unreadLines(unread: readonly string[]): string[] {
  if (unread.length === 0) return [];
  const kept: string[] = [];
  let length = 0;
  for (const link of unread) {
    length += link.length + 3;
    if (length > MAX_UNREAD_TEXT) break;
    kept.push(`- ${link}`);
  }
  const left = unread.length - kept.length;
  return [
    `Not read, ${count(unread.length, 'link')} with those words, for read_page if one looks like a fit. Calling this again reads the same ones:`,
    ...kept,
    ...(left > 0 ? [`…and ${left} more in the file.`] : []),
  ];
}

/**
 * Reads any careers site the way a search engine's job search does: its robots.txt first, whose
 * rules it follows, then the sitemap that names, then the JobPosting data on the pages whose links
 * have the titles asked for. It reads only the site it's given, up to MAX_PAGES postings a call,
 * saves what they say in one file in a job search's folder, and lists them for Claude. Each page it
 * reads goes on the task's card, and the titles stay on this computer.
 */
export async function careersSite(
  address: string,
  titles: readonly string[],
  folder: string,
  deps: CareersSiteDeps,
): Promise<string> {
  if (!FOLDER_NAME.test(folder)) return notFolder(folder);
  if (titles.length === 0) return 'Give the job titles to look for in the site’s links.';
  let site: URL;
  try {
    site = new URL(address);
  } catch {
    return `“${address}” isn’t a link.`;
  }
  const problem = linkProblem(site) ?? offLimits(site.hostname);
  if (problem) return `Not read: ${problem}`;
  const known = boardSource(site.href);
  if (known) {
    return `${site.href} is on ${boardSystem(known)}, which job_board reads. Use that instead.`;
  }

  const clock = deps.now ?? (() => new Date());
  const started = clock().getTime();
  const spent = () => clock().getTime() - started;
  let stage: 'robots' | 'sitemaps' | 'pages' = 'robots';
  let origin = site.origin;
  let host = bareHost(site.hostname);
  let robots: Robots = NO_ROBOTS;
  const home = new Set([host]);
  const fetch = fetchInTime({
    ...deps,
    onRedirect: (to) => {
      const next = new URL(to);
      const barred = offLimits(next.hostname);
      if (barred) throw new FetchRefused(barred);
      if (stage === 'pages') {
        if (!home.has(bareHost(next.hostname))) {
          throw new Error(`it sent the request on to ${next.hostname}`);
        }
        if (!robotsAllow(robots, next.pathname + next.search)) {
          throw new Error('it sent the request somewhere its robots.txt keeps software from');
        }
      }
      // A site that's moved takes its robots.txt along, which speaks for where it is now. Any other
      // answer says nothing about that other site, whose own robots.txt hasn't been read.
      if (stage === 'robots' && next.pathname === '/robots.txt') {
        origin = next.origin;
        host = bareHost(next.hostname);
        home.add(host);
      }
      deps.onRead?.(to);
    },
  });

  try {
    deps.onRead?.(`${site.origin}/robots.txt`);
    robots = await robotsOf(site.origin, fetch);
  } catch (error) {
    if (error instanceof FetchRefused) return `Not read: ${reasonOf(error)}`;
    return `Not read: ${site.hostname}’s robots.txt couldn’t be read (${reasonOf(error)}), so it isn’t known what the site allows. Read its careers page with read_page, or search it with allowed_domains.`;
  }
  stage = 'sitemaps';

  // Only the company's own sitemaps, as a robots.txt can name anything. Without any, the usual place.
  const named = robots.sitemaps.filter((link) => {
    const url = sitemapAddress(link);
    return url !== null && baseOf(new URL(url).hostname) === baseOf(host);
  });
  const starts =
    named.length > 0 ? named : robotsAllow(robots, '/sitemap.xml') ? [`${origin}/sitemap.xml`] : [];
  if (starts.length === 0) {
    return `Not read: ${host}’s robots.txt names no sitemap and asks software to leave the rest alone. Read its careers page with read_page, or search it with allowed_domains.`;
  }
  const pages = await pagesOf(
    starts,
    fetch,
    () => spent() > SITEMAPS_MS,
    (url) => deps.onRead?.(url),
    (url) => !home.has(bareHost(url.hostname)) || robotsAllow(robots, url.pathname + url.search),
  );
  if (pages.read === 0) {
    if (pages.failure instanceof FetchRefused) return `Not read: ${reasonOf(pages.failure)}`;
    const why = pages.gzipped
      ? ' its sitemaps are gzipped, which the app doesn’t read'
      : pages.failure
        ? ` ${reasonOf(pages.failure)}`
        : '';
    return `${host} has no sitemap to read${why ? ` (${why.trim()})` : ''}. Read its careers page with read_page, or search it with allowed_domains.`;
  }

  const {
    links: matches,
    withWords,
    barred,
  } = await matchesIn(pages.links, titles, home, robots, () => spent() > PAGES_MS);
  const listed = `${host}’s sitemap lists ${count(pages.links.length, 'page')}${
    pages.left > 0
      ? `, from the first ${count(pages.asked, 'sitemap')}, with ${pages.left} not read`
      : ''
  }`;
  if (matches.length === 0) {
    if (barred > 0) {
      return `${listed}, and ${count(barred, 'link')} with those words, but its robots.txt keeps software from them. Search the employer’s name and the titles with ${host} as allowed_domains instead.`;
    }
    return `${listed}, and none has those words in its link. Its links may not name the job, as “…/jobs/3043382” doesn’t, or it may not have that job. Search the employer’s name and the titles with ${host} as allowed_domains instead.`;
  }

  const today = localDate(clock());
  const wait = deps.wait ?? pause;
  const delayMs = (robots.crawlDelay ?? 0) * 1000;
  const jobs: BoardJob[] = [];
  const unread: string[] = [];
  let closed = 0;
  let notPostings = 0;
  let readingStopped = false;
  stage = 'pages';
  for (const [i, { link }] of matches.entries()) {
    if (i >= MAX_PAGES || readingStopped || (i > 0 && spent() + delayMs > PAGES_MS)) {
      readingStopped = true;
      unread.push(link);
      continue;
    }
    if (i > 0 && delayMs > 0) await wait(delayMs);
    deps.onRead?.(link);
    const read = await readJobPage(link, fetch, today);
    if (read.kind === 'job') jobs.push(read.job);
    else if (read.kind === 'closed') closed++;
    else if (read.kind === 'not a posting') notPostings++;
    else unread.push(link);
  }

  const note = [
    ...(closed > 0
      ? [`${count(closed, 'posting')} left out: gone, or past its closing date.`]
      : []),
    ...(notPostings > 0
      ? [
          `${count(notPostings, 'page')} left out: no job data, so not a posting, or it needs a browser.`,
        ]
      : []),
    ...(barred > 0
      ? [`${count(barred, 'link')} left out, as its robots.txt keeps software from them.`]
      : []),
    ...(delayMs > 0 ? [`Its robots.txt asks for ${delayMs / 1000} seconds between pages.`] : []),
    'A sitemap can leave jobs out, so this may not be everything the site has.',
  ];
  const lead = `${listed}, ${count(withWords, 'link')} with those words`;
  if (jobs.length === 0 && unread.length === 0) {
    return [`${lead}. No open posting came of the ones it read.`, ...note].join('\n');
  }
  const markdown = `${jobsMarkdown(
    `Careers site: ${host}`,
    `${host}’s sitemap, and each posting’s JobPosting data`,
    `${today} by Factwright, ${count(jobs.length, 'job')}, word for word, for ${titles.map((title) => `“${title}”`).join(', ')}`,
    jobs,
  )}${
    unread.length > 0
      ? `\n## Links with those words, not read\n\n${unread.map((link) => `- ${link}`).join('\n')}\n`
      : ''
  }`;
  const saved = await saveInSearch(
    deps,
    folder,
    `site-${fileSlug(host)}-${wordsTag(titles)}.md`,
    markdown,
  );
  const lines = headingLines(
    markdown,
    jobs.map((job) => job.title),
  );
  return [
    `Saved ${saved}: ${lead}, ${count(jobs.length, 'open posting')} read word for word under “## <number>. <title>”. ${FROM_THE_WEB}`,
    ...note,
    ...(jobs.length > 0
      ? [
          'Each job, with the line it starts on in the file:',
          ...capped(
            jobs.map((job, i) => `${i + 1}. ${boardJobLine(job)} · line ${lines[i] ?? '?'}`),
          ),
        ]
      : []),
    ...unreadLines(unread),
  ].join('\n');
}
