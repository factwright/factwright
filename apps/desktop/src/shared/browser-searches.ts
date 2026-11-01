import type { AboutYou } from './about.ts';
import { kindsOf } from './kinds.ts';
import { joinPlaces } from './places.ts';

/** Where each site keeps its own search. */
const LINKEDIN = 'https://www.linkedin.com/jobs/search/';
const INDEED = 'https://www.indeed.com/jobs';
const GOVERNMENT_JOBS = 'https://www.governmentjobs.com/jobs';

/** How many of a kind's job titles, and how many cities, get searches of their own. */
export const MOST_TITLES = 5;
export const MOST_CITIES = 3;

/**
 * How much of a title or place goes in an address, so that it stays under the 2,081 characters
 * Windows opens, even where each letter takes nine to encode.
 */
const MOST_IN_ADDRESS = 100;

const UNITED_STATES = 'United States';

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

/** The words before the area: "anywhere in the", "remote from". */
const LEAD_IN =
  /^(?:remote(?:ly)?\b[\s,:(-]*)?(?:(?:anywhere|any|from|in|within|across|near)[\s,:-]+)*(?:the\s+)?/i;
/** The United States, however it's said, whatever follows: "US only", "USA, no sponsorship". */
const THE_US =
  /^(?:continental\s+)?(?:u\.?\s?s\.?(?:\s?a\.?)?|united states(?: of america)?|america)(?![\p{L}\p{N}])/iu;
/**
 * A time zone, which Profile says "Remote from" can be: "Central European time", "EST". ET, CT, MT
 * and PT count only on their own, as they're also places, such as Hartford, CT.
 */
const TIME_ZONE =
  /\b(?:time|timezones?|hours?|utc|gmt|[ecmp][sd]t|ces?t|bst|eest|eet|ist|jst|kst|sgt|aest|aedt)\b|^(?:eastern|central|mountain|pacific|et|ct|mt|pt)$/i;
/** What's after the first area: "or Canada", "/Canada", "only". In lowercase, as OR is Oregon. */
const AFTER_AREA = /\s+or\s.*$|\s*[/&;(].*$|[\s-]+(?:only|based)\b.*$/;
const NO_AREA =
  /^(?:any|anywhere|everywhere|world|worldwide|global|globally|international|internationally)?$/i;
/** What a place doesn't have, so it's a sentence, whose words aren't for a location box. */
const NOT_A_PLACE =
  /\d|(?:^|[\s,])(?:i|my|we|and|but|not|no|except|with|without|can|need|must|if|home)(?=[\s,]|$)/i;

/**
 * The area a site's location box can look in, from what "Remote from" says, or nothing unless it
 * reads as a place: "anywhere in the US" looks in the United States, and a time zone or a sentence
 * looks with no location at all.
 */
export function remoteArea(remoteFrom: string): string {
  const said = oneLine(remoteFrom).replace(LEAD_IN, '');
  if (THE_US.test(said)) return UNITED_STATES;
  if (TIME_ZONE.test(said)) return '';
  const area = said.replace(AFTER_AREA, '').replace(/[\s.,:;!?)-]+$/, '');
  const placeLike = area.length <= 60 && area.split(' ').length <= 4 && !NOT_A_PLACE.test(area);
  return placeLike && !NO_AREA.test(area) ? area : '';
}

/** The places to look, remote first, and whether it has cities past as many as get searches. */
function placesFor({ workplaces, remoteFrom, places }: AboutYou): {
  places: Place[];
  cut: boolean;
} {
  const named = joinPlaces(distinct(places));
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
  const query = new URLSearchParams();
  for (const [word, value] of Object.entries(words)) {
    if (value) query.set(word, value.slice(0, MOST_IN_ADDRESS));
  }
  return `${page}?${query.toString().replaceAll('+', '%20')}`;
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
      // It takes Remote as a place, across its site, in place of an area. Posted in the past 7 days.
      url: address(INDEED, { q: title, l: remote ? 'Remote' : location, fromage: '7' }),
    },
  ];
  if (publicWork) {
    links.push({
      site: 'GovernmentJobs',
      // It has no filter for remote work, and looks across the country with no location.
      url: address(GOVERNMENT_JOBS, {
        keyword: remote ? `${title} remote` : title,
        location: location === UNITED_STATES ? '' : location,
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
