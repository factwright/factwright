import { type BoardJob, job, listLine } from './boards.ts';
import { htmlToText } from './posting.ts';

/*
 * The two public job searches that aren't one employer's: USAJOBS's keyless feed, for federal
 * jobs, and Workable's search across its employers. Every link in a listing is checked or built
 * here, so a hostile answer can't put a link to anywhere else in front of Claude.
 */

/** A source of listings, by its name in the job_listings tool. */
export type ListingSource = 'usajobs' | 'workable';

/** A page of listings, and how to ask for the next. */
export interface ListingPage {
  jobs: BoardJob[];
  /** The rows the page held before anything was left out. Zero means there's no more. */
  rows: number;
  next: string | null;
  /** How many there are in all, when the source says. */
  total: number | null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const field = (value: unknown, key: string) => (isObject(value) ? value[key] : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const day = (value: unknown) => text(value)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;

/** How many of a federal job's places show in a listing. */
const MAX_PLACES = 4;

/** A day as USAJOBS's feed takes one. */
const usajobsDay = (date: string) => {
  const [year, month, dayOfMonth] = date.split('-');
  return `${month}-${dayOfMonth}-${year}`;
};

/**
 * Where USAJOBS's keyless feed lists the announcements opened between two days, as YYYY-MM-DD,
 * that close on or after `closing`. Only those days go to it, so the search itself stays here.
 */
export function usajobsRequest(from: string, to: string, closing: string, next?: string): string {
  const days = [
    `StartPositionOpenDate=${usajobsDay(from)}`,
    `EndPositionOpenDate=${usajobsDay(to)}`,
    `StartPositionCloseDate=${usajobsDay(closing)}`,
  ].join('&');
  return `https://data.usajobs.gov/api/historicjoa?${days}${next ? `&continuationToken=${next}` : ''}`;
}

/** An announcement's status when it still takes applications. Some have no status yet. */
const stillOpen = (status: unknown) => {
  const words = text(status);
  return words === null || words === 'Accepting applications';
};

/**
 * The federal jobs in a page of USAJOBS's feed that still take applications on `today`, and that
 * `keep` keeps, by the title and all the places an announcement names.
 */
export function readUsajobs(
  answer: unknown,
  today: string,
  keep: (title: string, places: string) => boolean,
): ListingPage {
  const rows = list(field(answer, 'data'));
  const jobs = rows.flatMap((each) => {
    const number = field(each, 'usajobsControlNumber');
    const title = listLine(text(field(each, 'positionTitle')));
    const closes = day(field(each, 'positionCloseDate'));
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || !title) return [];
    if (!stillOpen(field(each, 'positionOpeningStatus')) || (closes && closes < today)) return [];
    const places = list(field(each, 'positionlocations')).flatMap((place) => {
      const words = [field(place, 'positionLocationCity'), field(place, 'positionLocationState')]
        .map(text)
        .filter(Boolean)
        .join(', ');
      return words ? [words] : [];
    });
    if (!keep(title, places.join('; '))) return [];
    const remote = places.some((place) => /\bremote\b/i.test(place));
    const shown = places.slice(0, MAX_PLACES).join('; ');
    const more = places.length - MAX_PLACES;
    const min = field(each, 'minimumSalary');
    const max = field(each, 'maximumSalary');
    const per = text(field(each, 'salaryType'))?.toLowerCase().replace(/^per /, '') ?? 'year';
    const dollars = (value: unknown) =>
      typeof value === 'number' && value > 0 ? `$${value.toLocaleString('en-US')}` : null;
    const pay = [dollars(min), dollars(max)].filter(Boolean).join('–');
    const paths = list(field(each, 'hiringpaths'))
      .map((path) => text(field(path, 'hiringPath')))
      .filter(Boolean)
      .join('; ');
    return (
      job({
        id: String(number),
        title,
        company: listLine(text(field(each, 'hiringAgencyName'))) ?? undefined,
        location: listLine(more > 0 ? `${shown}, and ${more} more` : shown),
        workplace: remote
          ? 'Remote'
          : text(field(each, 'teleworkEligible')) === 'Y'
            ? 'Telework possible'
            : null,
        team: listLine(text(field(each, 'hiringDepartmentName'))),
        pay: pay ? `${pay} a ${per}` : null,
        posted: day(field(each, 'positionOpenDate')),
        closes: closes ?? undefined,
        note: paths ? `Open to: ${paths}` : undefined,
        link: `https://www.usajobs.gov/job/${number}`,
        text: [
          text(field(each, 'workSchedule')),
          text(field(each, 'appointmentType')),
          text(field(each, 'securityClearance')),
        ]
          .filter(Boolean)
          .join(' · '),
      }) ?? []
    );
  });
  const next = text(field(field(field(answer, 'paging'), 'metadata'), 'continuationToken'));
  const total = field(field(field(answer, 'paging'), 'metadata'), 'totalCount');
  return {
    jobs,
    rows: rows.length,
    next: next && /^[\w%+/=-]{1,300}$/.test(next) ? next : null,
    total: typeof total === 'number' ? total : null,
  };
}

/** Whether a place asks for remote work rather than somewhere. */
export const isRemotePlace = (place: string) => /^(fully )?remote\b/i.test(place.trim());

/**
 * Where Workable's public job search lists jobs for a title and a place. Those are all it's sent.
 * For remote work, its own filter for that takes the place's.
 */
export function workableSearchRequest(title: string, place: string, next?: string): string {
  const part = encodeURIComponent;
  const where = isRemotePlace(place)
    ? '&workplace=remote'
    : place
      ? `&location=${part(place)}`
      : '';
  const page = next ? `&pageToken=${part(next)}` : '';
  return `https://jobs.workable.com/api/v1/jobs?query=${part(title)}${where}${page}`;
}

/** The jobs in a page of Workable's public job search, each with its link on jobs.workable.com. */
export function readWorkableSearch(answer: unknown): ListingPage {
  const rows = list(field(answer, 'jobs'));
  const jobs = rows.flatMap((each) => {
    const address = text(field(each, 'url'));
    let link: string | null = null;
    try {
      const url = new URL(address ?? '');
      if (url.protocol === 'https:' && url.hostname === 'jobs.workable.com') link = url.href;
    } catch {
      link = null;
    }
    const state = text(field(each, 'state'));
    if (state && state !== 'published') return [];
    const places = list(field(each, 'locations'))
      .map(text)
      .filter((place) => place && place !== 'TELECOMMUTE')
      .join('; ');
    const workplace = text(field(each, 'workplace'));
    return (
      job({
        id: text(field(each, 'id')),
        title: listLine(text(field(each, 'title'))),
        company: listLine(text(field(field(each, 'company'), 'title'))) ?? undefined,
        location: listLine(places),
        workplace: workplace === 'remote' ? 'Remote' : workplace === 'hybrid' ? 'Hybrid' : null,
        link,
        posted: day(field(each, 'created')),
        text: ['description', 'requirementsSection', 'benefitsSection']
          .map((key) => htmlToText(text(field(each, key)) ?? ''))
          .filter(Boolean)
          .join('\n\n'),
      }) ?? []
    );
  });
  const total = field(answer, 'totalSize');
  return {
    jobs,
    rows: rows.length,
    next: text(field(answer, 'nextPageToken')),
    total: typeof total === 'number' ? total : null,
  };
}
