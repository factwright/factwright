import {
  type BoardJob,
  boardJobLine,
  boardSource,
  boardSystem,
  jobPostingFields,
  jobsMarkdown,
  localDate,
  oneLine,
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
} from './search.ts';

/** The most a sitemap may weigh, which the sitemaps protocol puts at 50 MB. */
const SITEMAP_MAX_BYTES = 25_000_000;
/** The most sitemaps one call reads. Big employers' indexes run to 40 or so. */
const MAX_SITEMAPS = 50;
/** The most postings one call reads for their job data. */
const MAX_PAGES = 12;
/** How long reading sitemaps may go on, leaving time for the pages themselves. */
const SITEMAPS_MS = 22_000;
/** How long reading pages may go on, leaving time to save what was read. */
const PAGES_MS = 38_000;
/** The most links listed that weren't read. */
const MAX_UNREAD_LISTED = 40;

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
];

function offLimits(host: string): string | null {
  const barred = OFF_LIMITS.find(([site]) => site.test(host))?.[1];
  return barred
    ? `Factwright doesn’t read ${barred}’s sites as a whole: its terms or robots.txt keep software out. Search it with allowed_domains, or the user can open it in their browser and save what they pick.`
    : null;
}

/** A site without "www.", so the two count as one. */
const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '');

/** A sitemap's address, always https, or null for one that can't be read. */
function sitemapAddress(address: string): string | null {
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.protocol = 'https:';
    // A gzipped file comes as it is, which the fetcher won't unpack.
    return url.pathname.endsWith('.gz') ? null : url.href;
  } catch {
    return null;
  }
}

/** What a sitemap's name says about whether it lists jobs. */
const namesJobs = (address: string) => /job|career|posting|position|opening|vacanc/i.test(address);

/** What a link's path says about whether it's to one posting. */
const looksLikePosting = (link: string) =>
  /\/(jobs?|positions?|openings?|vacanc(y|ies)|requisitions?|postings?|careers?)\/./i.test(
    new URL(link).pathname,
  );

/** The pages a site's sitemaps list. */
interface SitePages {
  links: { link: string; changed: string | null }[];
  /** The sitemaps it read, and those it didn't get to. */
  read: number;
  left: number;
  /** What went wrong with the first it couldn't read. */
  failure: unknown;
}

/**
 * Every page a site's sitemaps list, the sitemaps that name jobs first, within the time given. An
 * index's sitemaps stay on its own site.
 */
async function pagesOf(
  starts: readonly string[],
  fetch: Fetch,
  stop: () => boolean,
): Promise<SitePages> {
  const queue = starts.flatMap((start) => sitemapAddress(start) ?? []);
  queue.sort((a, b) => Number(namesJobs(b)) - Number(namesJobs(a)));
  const seen = new Set<string>();
  const links: SitePages['links'] = [];
  let read = 0;
  let failure: unknown = null;
  while (queue.length > 0 && read < MAX_SITEMAPS && !stop()) {
    const next = queue.shift() ?? '';
    if (seen.has(next)) continue;
    seen.add(next);
    let answer: unknown;
    try {
      answer = await fetch(next, false, SITEMAP_MAX_BYTES);
    } catch (error) {
      if (error instanceof FetchRefused) throw error;
      failure ??= error;
      continue;
    }
    read++;
    const sitemap = readSitemap(String(answer));
    if (sitemap.index) {
      const host = new URL(next).hostname;
      const others = sitemap.links.flatMap(({ link }) => {
        const child = sitemapAddress(link);
        return child && new URL(child).hostname === host ? [child] : [];
      });
      others.sort((a, b) => Number(namesJobs(b)) - Number(namesJobs(a)));
      queue.push(...others);
    } else {
      for (const link of sitemap.links) links.push(link);
    }
  }
  return { links, read, left: queue.length, failure };
}

/** One posting read for its job data: a job to list, or why not. */
type PageRead =
  | { kind: 'job'; job: BoardJob }
  | { kind: 'closed' }
  | { kind: 'gone' }
  | { kind: 'not a posting' }
  | { kind: 'unread'; why: string };

async function readJobPage(link: string, fetch: Fetch, today: string): Promise<PageRead> {
  let html: unknown;
  try {
    html = await fetch(link, false);
  } catch (error) {
    if (error instanceof FetchRefused) throw error;
    if (error instanceof FetchAnswered && (error.status === 404 || error.status === 410)) {
      return { kind: 'gone' };
    }
    return { kind: 'unread', why: reasonOf(error) };
  }
  const data = typeof html === 'string' ? jobPostingFields(html) : null;
  if (!data?.title) return { kind: 'not a posting' };
  if (data.closes && /^\d{4}-\d{2}-\d{2}$/.test(data.closes) && data.closes < today) {
    return { kind: 'closed' };
  }
  return {
    kind: 'job',
    job: {
      id: null,
      title: oneLine(data.title).slice(0, 300),
      location: data.where,
      workplace: null,
      team: null,
      pay: data.pay,
      link,
      posted: data.posted,
      text: data.text,
      ...(data.company && { company: oneLine(data.company).slice(0, 300) }),
      ...(data.closes && { closes: data.closes }),
    },
  };
}

export interface CareersSiteDeps extends SearchToolDeps {
  /** Hears each page a request goes to, for the task's card. */
  onRead?: ((url: string) => void) | undefined;
  /** Waits, between pages, as long as a robots.txt asks. Tests pass their own. */
  wait?: (ms: number) => Promise<void>;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

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
  // A site's robots.txt can send the request on to the site's real home. After that, a request for
  // a page goes nowhere else, as nothing has said that other site may be read.
  let stage: 'robots' | 'sitemaps' | 'pages' = 'robots';
  let host = bareHost(site.hostname);
  const home = new Set([host]);
  const fetch = fetchInTime({
    ...deps,
    onRedirect: (to) => {
      const next = new URL(to).hostname;
      const barred = offLimits(next);
      if (barred) throw new FetchRefused(barred);
      if (stage === 'pages' && !home.has(bareHost(next))) {
        throw new Error(`it sent the request on to ${next}`);
      }
      if (stage === 'robots') {
        host = bareHost(next);
        home.add(host);
      }
      deps.onRead?.(to);
    },
  });

  let robots: Robots;
  try {
    deps.onRead?.(`${site.origin}/robots.txt`);
    robots = await robotsOf(site.origin, fetch);
  } catch (error) {
    if (error instanceof FetchRefused) return `Not read: ${reasonOf(error)}`;
    return `Not read: ${site.hostname}’s robots.txt couldn’t be read (${reasonOf(error)}), so it isn’t known what the site allows. Read its careers page with read_page, or search it with allowed_domains.`;
  }
  stage = 'sitemaps';

  // A robots.txt moved with the site names sitemaps there; without any, the usual place is looked at.
  const guess = `https://${host}/sitemap.xml`;
  const guessAllowed = robotsAllow(robots, '/sitemap.xml');
  const starts = robots.sitemaps.length > 0 ? robots.sitemaps : guessAllowed ? [guess] : [];
  if (starts.length === 0) {
    return `Not read: ${host}’s robots.txt names no sitemap and asks software to leave the rest alone. Read its careers page with read_page, or search it with allowed_domains.`;
  }
  let pages: SitePages;
  try {
    pages = await pagesOf(
      starts.map((start) => {
        deps.onRead?.(start);
        return start;
      }),
      fetch,
      () => spent() > SITEMAPS_MS,
    );
  } catch (error) {
    if (error instanceof FetchRefused) return `Not read: ${reasonOf(error)}`;
    return `Couldn’t read ${host}’s sitemap (${reasonOf(error)}). Read its careers page with read_page instead.`;
  }
  if (pages.read === 0) {
    return `${host} has no sitemap to read${pages.failure ? ` (${reasonOf(pages.failure)})` : ''}. Read its careers page with read_page, or search it with allowed_domains.`;
  }

  const fits = titleFilter(titles);
  const seen = new Set<string>();
  const matches = pages.links.flatMap(({ link, changed }) => {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return [];
    }
    if (url.protocol !== 'https:' || !home.has(bareHost(url.hostname))) return [];
    let words = url.pathname;
    try {
      words = decodeURIComponent(url.pathname);
    } catch {
      // A malformed path reads as it came.
    }
    if (!fits(words) || !robotsAllow(robots, url.pathname + url.search)) return [];
    const key = url.origin + url.pathname.replace(/\/$/, '');
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ link: url.href, changed }];
  });
  const listed = `${host}’s sitemap lists ${count(pages.links.length, 'page')}${
    pages.left > 0
      ? `, from the ${pages.read} sitemaps it had time for, with ${pages.left} left`
      : ''
  }`;
  if (matches.length === 0) {
    return `${listed}, and none has those words in its link. Its links may not name the job, as “…/jobs/3043382” doesn’t, or it may not have that job. Search the employer’s name and the titles with ${host} as allowed_domains instead.`;
  }
  // Links that look like one posting first, as a site's pages about nursing can have the same words,
  // then the newest changes, as those are the likeliest to be open.
  matches.sort(
    (a, b) =>
      Number(looksLikePosting(b.link)) - Number(looksLikePosting(a.link)) ||
      (b.changed ?? '').localeCompare(a.changed ?? ''),
  );

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
    if (i >= MAX_PAGES || readingStopped || spent() + delayMs > PAGES_MS) {
      readingStopped = true;
      unread.push(link);
      continue;
    }
    if (i > 0 && delayMs > 0) await wait(delayMs);
    deps.onRead?.(link);
    let read: PageRead;
    try {
      read = await readJobPage(link, fetch, today);
    } catch (error) {
      // A page that would send the request elsewhere, and only that page, is left out.
      if (!(error instanceof FetchRefused)) throw error;
      read = { kind: 'unread', why: reasonOf(error) };
    }
    if (read.kind === 'job') jobs.push(read.job);
    else if (read.kind === 'closed' || read.kind === 'gone') closed++;
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
    ...(delayMs > 0 ? [`Its robots.txt asks for ${delayMs / 1000} seconds between pages.`] : []),
    'A sitemap can leave jobs out, so this may not be everything the site has.',
  ];
  const unreadLines =
    unread.length > 0
      ? [
          `Not read yet, ${count(unread.length, 'link')} with those words, for read_page to confirm:`,
          ...unread.slice(0, MAX_UNREAD_LISTED).map((link) => `- ${link}`),
          ...(unread.length > MAX_UNREAD_LISTED
            ? [`…and ${unread.length - MAX_UNREAD_LISTED} more.`]
            : []),
        ]
      : [];
  if (jobs.length === 0) {
    return [
      `${listed}, and ${count(matches.length, 'link')} with those words. No open posting came of the ones it read.`,
      ...note,
      ...unreadLines,
    ].join('\n');
  }
  const markdown = jobsMarkdown(
    `Careers site: ${host}`,
    `${host}’s sitemap, and each posting’s JobPosting data`,
    `${today} by Factwright, ${count(jobs.length, 'job')}, word for word`,
    jobs,
  );
  const saved = await saveInSearch(deps, folder, `site-${fileSlug(host)}.md`, markdown);
  const lines = headingLines(markdown);
  return [
    `Saved ${saved}: ${listed}, ${count(matches.length, 'link')} with those words, ${count(jobs.length, 'open posting')} read word for word under “## <number>. <title>”. ${FROM_THE_WEB}`,
    ...note,
    'Each job, with the line it starts on in the file:',
    ...capped(jobs.map((job, i) => `${i + 1}. ${boardJobLine(job)} · line ${lines[i] ?? '?'}`)),
    ...unreadLines,
  ].join('\n');
}
