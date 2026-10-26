import { decodeEntities, htmlToText } from './posting.ts';

/** A company's job board on an applicant system, by the board's name there. */
export interface BoardSource {
  kind: 'greenhouse' | 'lever' | 'ashby' | 'gem';
  board: string;
}

/** One open job on a board. */
export interface BoardJob {
  /** The applicant system's ID for the posting, which its links carry. */
  id: string | null;
  title: string;
  location: string | null;
  /** Remote, hybrid or on-site, when the board says. */
  workplace: string | null;
  team: string | null;
  pay: string | null;
  link: string;
  /** When it was posted, as YYYY-MM-DD, when the board says. */
  posted: string | null;
  /** The posting, as plain text. */
  text: string;
}

const BOARD_NAMES: Readonly<Record<BoardSource['kind'], string>> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  gem: 'Gem',
};

/** The applicant system's name, such as "Greenhouse". */
export const boardSystem = (source: BoardSource) => BOARD_NAMES[source.kind];

/**
 * The board a link is on: a board's own page, or one of its postings. Null for a link that
 * isn't on Greenhouse, Lever, Ashby or Gem.
 */
export function boardSource(address: string): BoardSource | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  const first = segments(url)[0];
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // An embedded board names itself in ?for=.
    const board = url.searchParams.get('for') ?? (first === 'embed' ? null : first);
    return board ? { kind: 'greenhouse', board } : null;
  }
  if (!first) return null;
  if (host === 'jobs.lever.co') return { kind: 'lever', board: first };
  if (host === 'jobs.ashbyhq.com') return { kind: 'ashby', board: first };
  if (host === 'jobs.gem.com') return { kind: 'gem', board: first };
  return null;
}

/** A link's path, split at its slashes and decoded. */
function segments(url: URL): string[] {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

/**
 * The ID of the one posting a link is to, such as Greenhouse's job number or Lever's posting
 * UUID. Null for a link to a whole board, or one that isn't on an applicant system.
 */
export function boardPostingId(address: string): string | null {
  const source = boardSource(address);
  if (!source) return null;
  const url = new URL(address);
  if (source.kind === 'greenhouse') {
    // Embedded postings name themselves in ?token=, and company sites in ?gh_jid=.
    const query = url.searchParams.get('gh_jid') ?? url.searchParams.get('token');
    return query ?? url.pathname.match(/\/jobs\/(\d+)/)?.[1] ?? null;
  }
  return segments(url)[1] ?? null;
}

/**
 * A Workable posting's ID, its shortcode, which names it across Workable, the same on its
 * application: "apply.workable.com/acme/j/1B6E0A1710/" and "…/j/1B6E0A1710/apply" alike, Workable's
 * short link, "apply.workable.com/j/1B6E0A1710", and a company's own name at workable.com, as
 * "acme.workable.com/j/1B6E0A1710". Null for a company's whole board, as "apply.workable.com/acme",
 * or a link that isn't on Workable.
 */
export function workablePostingId(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (!/(^|\.)workable\.com$/.test(url.hostname.toLowerCase())) return null;
  const parts = segments(url);
  // "j" first, or after the company's name.
  const at = parts.indexOf('j');
  const id = at === 0 || at === 1 ? parts[at + 1] : undefined;
  return id && /^[A-Za-z0-9]{1,40}$/.test(id) ? id : null;
}

/** Where the applicant system lists every open job on the board, as JSON. */
export function boardRequest(source: BoardSource): string {
  const board = encodeURIComponent(source.board);
  switch (source.kind) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;
    case 'lever':
      return `https://api.lever.co/v0/postings/${board}?mode=json`;
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`;
    case 'gem':
      return `https://api.gem.com/job_board/v0/${board}/job_posts/`;
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const id = (value: unknown) => (typeof value === 'number' ? String(value) : text(value));
const field = (value: unknown, key: string) => (isObject(value) ? value[key] : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** How the systems spell remote, hybrid and on-site, such as Lever's "onsite" and Gem's "in_office". */
const WORKPLACES: ReadonlyMap<string, string | null> = new Map([
  ['remote', 'Remote'],
  ['hybrid', 'Hybrid'],
  ['onsite', 'On-site'],
  ['inoffice', 'On-site'],
  ['unspecified', null],
]);
const workplace = (value: unknown) => {
  const found = text(value);
  const known = WORKPLACES.get(found?.toLowerCase().replace(/[^a-z]/g, '') ?? '');
  return known === undefined ? found : known;
};
const day = (value: unknown) => {
  if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
  return text(value)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
};
const lines = (...parts: (string | null | undefined)[]) =>
  parts.filter((part) => part !== null && part !== undefined).join('\n');

/** Lever's salary range, such as "$150,000–$190,000 a year". */
function leverPay(range: unknown): string | null {
  const min = field(range, 'min');
  const max = field(range, 'max');
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  const currency = text(field(range, 'currency')) ?? 'USD';
  const money = (n: number) =>
    `${currency === 'USD' ? '$' : `${currency} `}${n.toLocaleString('en-US')}`;
  const per = text(field(range, 'interval'))?.replace(/^per-/, '');
  return `${money(min)}–${money(max)}${per ? ` a ${per.replace(/-/g, ' ')}` : ''}`;
}

function job(
  found: Partial<Omit<BoardJob, 'title' | 'link'>> & { title: string | null; link: string | null },
): BoardJob | null {
  if (!found.title || !found.link) return null;
  return {
    id: found.id ?? null,
    title: found.title,
    location: found.location ?? null,
    workplace: found.workplace ?? null,
    team: found.team ?? null,
    pay: found.pay ?? null,
    link: found.link,
    posted: found.posted ?? null,
    text: found.text ?? '',
  };
}

/** Every open job a board's API answered with. */
export function readBoard(source: BoardSource, answer: unknown): BoardJob[] {
  switch (source.kind) {
    case 'greenhouse':
      return list(field(answer, 'jobs')).flatMap(
        (each) =>
          job({
            id: id(field(each, 'id')),
            title: text(field(each, 'title')),
            location: text(field(field(each, 'location'), 'name')),
            team: text(field(list(field(each, 'departments'))[0], 'name')),
            link: text(field(each, 'absolute_url')),
            posted: day(field(each, 'first_published')) ?? day(field(each, 'updated_at')),
            text: htmlToText(decodeEntities(text(field(each, 'content')) ?? '')),
          }) ?? [],
      );
    case 'lever':
      return list(answer).flatMap((each) => {
        const categories = field(each, 'categories');
        const sections = list(field(each, 'lists')).flatMap((section) => [
          '',
          `## ${text(field(section, 'text')) ?? ''}`,
          htmlToText(text(field(section, 'content')) ?? ''),
        ]);
        return (
          job({
            id: id(field(each, 'id')),
            title: text(field(each, 'text')),
            location: text(field(categories, 'location')),
            workplace: workplace(field(each, 'workplaceType')),
            team: text(field(categories, 'team')) ?? text(field(categories, 'department')),
            pay: leverPay(field(each, 'salaryRange')),
            link: text(field(each, 'hostedUrl')),
            posted: day(field(each, 'createdAt')),
            text: lines(
              text(field(each, 'descriptionPlain')),
              ...sections,
              '',
              text(field(each, 'additionalPlain')),
            ),
          }) ?? []
        );
      });
    case 'ashby':
      return list(field(answer, 'jobs')).flatMap((each) => {
        if (field(each, 'isListed') === false) return [];
        const compensation = field(each, 'compensation');
        return (
          job({
            id: id(field(each, 'id')),
            title: text(field(each, 'title')),
            location: text(field(each, 'location')),
            workplace:
              workplace(field(each, 'workplaceType')) ??
              (field(each, 'isRemote') === true ? 'Remote' : null),
            team: text(field(each, 'team')) ?? text(field(each, 'department')),
            pay:
              text(field(compensation, 'compensationTierSummary')) ??
              text(field(compensation, 'scrapeableCompensationSalarySummary')),
            link: text(field(each, 'jobUrl')),
            posted: day(field(each, 'publishedAt')),
            text:
              text(field(each, 'descriptionPlain')) ??
              htmlToText(text(field(each, 'descriptionHtml')) ?? ''),
          }) ?? []
        );
      });
    case 'gem':
      return list(answer).flatMap(
        (each) =>
          job({
            id: id(field(each, 'id')),
            title: text(field(each, 'title')),
            location: text(field(field(each, 'location'), 'name')),
            workplace: workplace(field(each, 'location_type')),
            team: text(field(list(field(each, 'departments'))[0], 'name')),
            link: text(field(each, 'absolute_url')),
            posted: day(field(each, 'first_published_at')) ?? day(field(each, 'updated_at')),
            // Its plain text breaks lines at every link, so the HTML reads better.
            text:
              htmlToText(text(field(each, 'content')) ?? '') ||
              (text(field(each, 'content_plain')) ?? ''),
          }) ?? [],
      );
  }
}

/** Where a job is, and whether it's remote, without saying "Remote" twice. */
function whereOf(each: BoardJob): string {
  const { location, workplace } = each;
  if (location && workplace && location.toLowerCase().includes(workplace.toLowerCase())) {
    return location;
  }
  return [location, workplace].filter(Boolean).join(', ');
}

/** A job in one line, for a listing: its title, where, pay, when it was posted, and its link. */
export function boardJobLine(each: BoardJob): string {
  const posted = each.posted && `posted ${each.posted}`;
  return [each.title, whereOf(each), each.pay, posted, each.link].filter(Boolean).join(' · ');
}

/** A board's open jobs as one Markdown file, every posting word for word. */
export function boardMarkdown(
  source: BoardSource,
  jobs: readonly BoardJob[],
  savedOn: string,
): string {
  const parts = [
    `# ${boardSystem(source)} board: ${source.board}`,
    '',
    `- **Source:** ${boardRequest(source)}`,
    `- **Saved:** ${savedOn} by Factwright, ${jobs.length} open ${jobs.length === 1 ? 'job' : 'jobs'}, word for word`,
  ];
  jobs.forEach((each, i) => {
    parts.push(
      '',
      `## ${i + 1}. ${each.title}`,
      '',
      ...[
        ['Where', whereOf(each)],
        ['Team', each.team],
        ['Pay', each.pay],
        ['Posted', each.posted],
        ['Link', each.link],
      ].flatMap(([label, value]) => (value ? [`- **${label}:** ${value}`] : [])),
      '',
      each.text,
    );
  });
  return `${parts.join('\n')}\n`;
}
