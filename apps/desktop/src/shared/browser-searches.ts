import type { AboutYou } from './about.ts';
import { kindsOf } from './kinds.ts';

/** Where each site keeps its own search. */
const LINKEDIN = 'https://www.linkedin.com/jobs/search/';
const INDEED = 'https://www.indeed.com/jobs';
const GOVERNMENT_JOBS = 'https://www.governmentjobs.com/jobs';

/** How many of a kind's job titles, and how many cities, get searches of their own. */
export const MOST_TITLES = 5;
export const MOST_CITIES = 3;

/** One site a search opens on, and its address there. */
export interface SearchLink {
  site: 'LinkedIn' | 'Indeed' | 'GovernmentJobs';
  url: string;
}

/** One job title in one place, with a link for each site it opens on. */
export interface BrowserSearch {
  title: string;
  /** Where it looks, as the dialog says it, such as "Remote, United States" or "Columbus, OH". */
  where: string;
  links: SearchLink[];
}

/** A kind of job's searches. With one kind of job, its id and name are blank. */
export interface KindSearches {
  id: string;
  name: string;
  searches: BrowserSearch[];
  /** Whether it has titles or cities past as many as get searches. */
  cut: boolean;
}

/** Where a search looks: remote, from an area or from nowhere in particular, or in a city. */
interface Place {
  where: string;
  remote: boolean;
  /** What a site's location box takes, or nothing when there's no place to name. */
  location: string;
}

/** On one line, with no control characters, as a location box or a list's row takes it. */
const oneLine = (text: string) => text.replace(/[\s\p{Cc}]+/gu, ' ').trim();

/** Each once, in any case, leaving out the blanks. */
function distinct(texts: readonly string[]): string[] {
  const kept = new Map<string, string>();
  for (const text of texts.map(oneLine)) {
    if (text && !kept.has(text.toLowerCase())) kept.set(text.toLowerCase(), text);
  }
  return [...kept.values()];
}

/**
 * A time zone, which Profile says "Remote from" can be: "Central European time", "EST". ET, CT, MT
 * and PT are left out, as they're also places, such as Hartford, CT.
 */
const TIME_ZONE = /\b(?:time|timezones?|hours?|utc|gmt|[ecmp][sd]t|ces?t|bst)\b/i;
/** The words before the area: "anywhere in the", "remote from". */
const LEAD_IN =
  /^(?:remote(?:ly)?\b[\s,:-]*)?(?:(?:anywhere|from|in|within|across)\s+)*(?:the\s+)?/i;
/** After the first area, and anything else that isn't one: "or Canada", "only". */
const AFTER_AREA = /\s+(?:or|and)\s.*$|\s*[/&;(].*$|\s+only\b.*$|[\s.,:!]+$/i;
const NO_AREA = /^(?:anywhere|everywhere|world|worldwide|global|globally)?$/i;
const UNITED_STATES = /^(?:u\.?\s?s\.?(?:\s?a\.?)?|united states(?: of america)?|america)$/i;

/**
 * The area a site's location box can look in, from what "Remote from" says, or nothing when it
 * names no place: "anywhere in the US" looks in the United States, and a time zone looks nowhere
 * in particular.
 */
export function remoteArea(remoteFrom: string): string {
  const said = oneLine(remoteFrom);
  if (TIME_ZONE.test(said)) return '';
  const area = said.replace(LEAD_IN, '').replace(AFTER_AREA, '');
  if (NO_AREA.test(area)) return '';
  return UNITED_STATES.test(area) ? 'United States' : area;
}

/** The places to look, remote first, and whether it has cities past as many as get searches. */
function placesFor({ workplaces, remoteFrom, places }: AboutYou): {
  places: Place[];
  cut: boolean;
} {
  const named = distinct(places);
  // "Remote" typed as a city means the same as picking it.
  const isRemote = (place: string) => /^remote\b/i.test(place);
  const cities = named.filter((place) => !isRemote(place));
  const looking: Place[] = cities
    .slice(0, MOST_CITIES)
    .map((city) => ({ where: city, remote: false, location: city }));
  if (workplaces.includes('remote') || named.some(isRemote)) {
    const area = remoteArea(remoteFrom);
    looking.unshift({ where: area ? `Remote, ${area}` : 'Remote', remote: true, location: area });
  }
  if (looking.length === 0) looking.push({ where: 'Anywhere', remote: false, location: '' });
  return { places: looking, cut: cities.length > MOST_CITIES };
}

/**
 * A search's address: every word encoded, whatever it holds, leaving out what's blank. A space is
 * %20, which reads as a space in any address, where + does so only as a form sends it.
 */
function address(page: string, words: Readonly<Record<string, string>>): string {
  const kept = Object.entries(words).filter(([, value]) => value);
  return `${page}?${new URLSearchParams(kept).toString().replaceAll('+', '%20')}`;
}

function linksFor(title: string, place: Place, publicWork: boolean): SearchLink[] {
  const { remote, location } = place;
  const links: SearchLink[] = [
    {
      site: 'LinkedIn',
      url: address(LINKEDIN, {
        keywords: title,
        location,
        // Its filters: remote work, and posted in the past week.
        ...(remote && { f_WT: '2' }),
        f_TPR: 'r604800',
      }),
    },
    {
      site: 'Indeed',
      // It takes Remote as a place. Posted in the past 7 days.
      url: address(INDEED, { q: title, l: remote ? 'Remote' : location, fromage: '7' }),
    },
  ];
  if (publicWork) {
    links.push({
      site: 'GovernmentJobs',
      // Its location box takes cities and states, and it has no filter for remote work.
      url: address(GOVERNMENT_JOBS, {
        keyword: remote ? `${title} remote` : title,
        location: remote ? '' : location,
      }),
    });
  }
  return links;
}

/**
 * The ready-made searches for each kind of job: one for each of its first titles in each place
 * the user would work, on LinkedIn and Indeed, and GovernmentJobs for someone who wants government,
 * nonprofit or school work. A kind with no titles has none. These sites turn software away, so
 * they're for the user to open in their own browser, where they see far more than a web search
 * can. The app only hands an address to the browser, on a click. It never fetches one, and the
 * tools refuse these sites (safe-fetch.ts).
 */
export function browserSearches(answers: AboutYou): KindSearches[] {
  const { places, cut: citiesCut } = placesFor(answers);
  const publicWork = answers.companies.includes('public');
  return kindsOf(answers).map(({ id, name, roles }) => {
    const titles = distinct(roles);
    return {
      id,
      name,
      searches: titles.slice(0, MOST_TITLES).flatMap((title) =>
        places.map((place) => ({
          title,
          where: place.where,
          links: linksFor(title, place, publicWork),
        })),
      ),
      cut: titles.length > MOST_TITLES || (titles.length > 0 && citiesCut),
    };
  });
}
