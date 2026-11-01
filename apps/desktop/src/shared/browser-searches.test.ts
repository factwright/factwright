import { describe, expect, it } from 'vitest';
import { readAnswers } from './about.ts';
import {
  type BrowserSearch,
  browserSearches,
  MOST_CITIES,
  MOST_TITLES,
  remoteArea,
} from './browser-searches.ts';

/** The searches for someone with one kind of job. */
function searchesFor(answers: Record<string, unknown>): BrowserSearch[] {
  const [only] = browserSearches(readAnswers(answers));
  if (!only) throw new Error('There’s always a first kind of job');
  return only.searches;
}

/** One search's address on one site. */
function linkOn(search: BrowserSearch | undefined, site: string): string {
  const url = search?.links.find((link) => link.site === site)?.url;
  if (!url) throw new Error(`No link on ${site}`);
  return url;
}

// These are text. Nothing here, or anywhere in the app, ever fetches them.
describe('browserSearches', () => {
  it('looks for someone remote with each site’s remote and past-week filters', () => {
    const [search, ...rest] = searchesFor({
      roles: ['Program Manager'],
      workplaces: ['remote'],
      remoteFrom: 'anywhere in the US',
    });
    expect(rest).toEqual([]);
    expect(search).toEqual({
      title: 'Program Manager',
      where: 'Remote, United States',
      links: [
        {
          site: 'LinkedIn',
          url: 'https://www.linkedin.com/jobs/search/?keywords=Program%20Manager&location=United%20States&f_WT=2&f_TPR=r604800',
        },
        {
          site: 'Indeed',
          url: 'https://www.indeed.com/jobs?q=Program%20Manager&l=Remote&fromage=7',
        },
      ],
    });
  });

  it('looks for someone on-site in a city, with no remote filter', () => {
    const [search, ...rest] = searchesFor({
      roles: ['Registered Nurse'],
      workplaces: ['onsite'],
      places: ['Columbus, OH'],
    });
    expect(rest).toEqual([]);
    expect(search).toEqual({
      title: 'Registered Nurse',
      where: 'Columbus, OH',
      links: [
        {
          site: 'LinkedIn',
          url: 'https://www.linkedin.com/jobs/search/?keywords=Registered%20Nurse&location=Columbus%2C%20OH&f_TPR=r604800',
        },
        {
          site: 'Indeed',
          url: 'https://www.indeed.com/jobs?q=Registered%20Nurse&l=Columbus%2C%20OH&fromage=7',
        },
      ],
    });
  });

  it('has one search per title and place, remote first', () => {
    const searches = searchesFor({
      roles: ['Accountant', 'Controller'],
      workplaces: ['remote', 'hybrid'],
      remoteFrom: 'Ohio',
      places: ['Dayton, OH'],
    });
    expect(searches.map(({ title, where }) => `${title} · ${where}`)).toEqual([
      'Accountant · Remote, Ohio',
      'Accountant · Dayton, OH',
      'Controller · Remote, Ohio',
      'Controller · Dayton, OH',
    ]);
    expect(linkOn(searches[0], 'LinkedIn')).toContain('location=Ohio&f_WT=2');
    expect(linkOn(searches[1], 'LinkedIn')).not.toContain('f_WT');
  });

  it('counts cities for someone remote too, as Profile asks “Cities, if you’d go in”', () => {
    const searches = searchesFor({
      roles: ['Designer'],
      workplaces: ['remote'],
      places: ['Chicago'],
    });
    expect(searches.map(({ where }) => where)).toEqual(['Remote', 'Chicago']);
  });

  it('leaves out the location when there’s no place to name', () => {
    const remote = searchesFor({ roles: ['Designer'], workplaces: ['remote'] });
    expect(remote[0]?.where).toBe('Remote');
    expect(linkOn(remote[0], 'LinkedIn')).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=Designer&f_WT=2&f_TPR=r604800',
    );
    const nowhere = searchesFor({ roles: ['Designer'], workplaces: ['onsite'] });
    expect(nowhere[0]?.where).toBe('Anywhere');
    expect(linkOn(nowhere[0], 'LinkedIn')).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=Designer&f_TPR=r604800',
    );
    expect(linkOn(nowhere[0], 'Indeed')).toBe('https://www.indeed.com/jobs?q=Designer&fromage=7');
  });

  it('forgets “Remote from” once remote isn’t picked', () => {
    const searches = searchesFor({
      roles: ['Designer'],
      workplaces: ['onsite'],
      remoteFrom: 'anywhere in the US',
      places: ['Tulsa, OK'],
    });
    expect(searches.map(({ where }) => where)).toEqual(['Tulsa, OK']);
  });

  it('reads “Remote” typed as a city as remote, not as a place', () => {
    const searches = searchesFor({
      roles: ['Designer'],
      places: ['remote', 'Remote (US)', 'Tulsa, OK'],
    });
    expect(searches.map(({ where }) => where)).toEqual(['Remote', 'Tulsa, OK']);
    expect(linkOn(searches[0], 'Indeed')).toContain('l=Remote');
  });

  it('adds GovernmentJobs for someone who wants government, nonprofit or school work', () => {
    const searches = searchesFor({
      roles: ['Public Health Nurse'],
      workplaces: ['remote', 'onsite'],
      places: ['Columbus, OH'],
      companies: ['public'],
    });
    expect(linkOn(searches[0], 'GovernmentJobs')).toBe(
      'https://www.governmentjobs.com/jobs?keyword=Public%20Health%20Nurse%20remote',
    );
    expect(linkOn(searches[1], 'GovernmentJobs')).toBe(
      'https://www.governmentjobs.com/jobs?keyword=Public%20Health%20Nurse&location=Columbus%2C%20OH',
    );
    // It looks across the country with no location, and in an area with one.
    const remoteFrom = (from: string) =>
      linkOn(
        searchesFor({
          roles: ['Nurse'],
          workplaces: ['remote'],
          remoteFrom: from,
          companies: ['public'],
        })[0],
        'GovernmentJobs',
      );
    expect(remoteFrom('anywhere in the US')).toBe(
      'https://www.governmentjobs.com/jobs?keyword=Nurse%20remote',
    );
    expect(remoteFrom('Ohio')).toBe(
      'https://www.governmentjobs.com/jobs?keyword=Nurse%20remote&location=Ohio',
    );
    expect(
      searchesFor({ roles: ['Nurse'], companies: ['startup', 'established'] })[0]?.links.map(
        (link) => link.site,
      ),
    ).toEqual(['LinkedIn', 'Indeed']);
  });

  it('puts cities back with their states, as a comma used to split them in Profile', () => {
    const searches = searchesFor({
      roles: ['Nurse'],
      workplaces: ['onsite'],
      places: ['Chicago', 'IL', 'Dublin', 'OH', 'Tulsa', 'OK', 'Denver', 'CO'],
    });
    expect(searches.map(({ where }) => where)).toEqual(['Chicago, IL', 'Dublin, OH', 'Tulsa, OK']);
    expect(linkOn(searches[1], 'LinkedIn')).toContain('location=Dublin%2C%20OH');
    expect(
      browserSearches(readAnswers({ roles: ['Nurse'], places: ['Chicago', 'IL'] }))[0]?.cut,
    ).toBe(false);
  });

  it('keeps to the first few titles and cities, and says so', () => {
    const [kept] = browserSearches(
      readAnswers({
        roles: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
        places: ['One', 'Two', 'Three', 'Four'],
      }),
    );
    expect(kept?.searches).toHaveLength(MOST_TITLES * MOST_CITIES);
    expect(kept?.searches.at(-1)).toMatchObject({ title: 'E', where: 'Three' });
    expect(kept?.cut).toBe(true);
    const titlesOnly = browserSearches(readAnswers({ roles: ['A', 'B', 'C', 'D', 'E', 'F'] }));
    expect(titlesOnly[0]?.cut).toBe(true);
    const citiesOnly = browserSearches(readAnswers({ roles: ['A'], places: ['1', '2', '3', '4'] }));
    expect(citiesOnly[0]?.cut).toBe(true);
    const all = browserSearches(
      readAnswers({ roles: ['A', 'B', 'C', 'D', 'E'], places: ['One', 'Two', 'Three'] }),
    );
    expect(all[0]?.cut).toBe(false);
  });

  it('has each kind’s own titles, in the same places, and none for a kind with no titles', () => {
    const kinds = browserSearches(
      readAnswers({
        firstKind: { id: 'developer', name: 'Developer' },
        roles: ['Staff Engineer'],
        workplaces: ['remote'],
        otherKinds: [
          {
            id: 'project-manager',
            name: 'Project manager',
            roles: ['Program Manager', 'Delivery Lead'],
          },
          { id: 'teacher', name: 'Teacher' },
        ],
      }),
    );
    expect(
      kinds.map(({ id, name, searches }) => [id, name, searches.map(({ title }) => title)]),
    ).toEqual([
      ['developer', 'Developer', ['Staff Engineer']],
      ['project-manager', 'Project manager', ['Program Manager', 'Delivery Lead']],
      ['teacher', 'Teacher', []],
    ]);
  });

  it('has nothing for someone with no titles, whatever else they said', () => {
    expect(browserSearches(readAnswers({}))).toEqual([
      { id: '', name: '', searches: [], cut: false },
    ]);
    expect(
      browserSearches(readAnswers({ workplaces: ['remote'], places: ['Chicago', 'A', 'B', 'C'] })),
    ).toEqual([{ id: '', name: '', searches: [], cut: false }]);
  });

  describe('with odd titles and places', () => {
    it.each([
      'C++ Developer',
      'R&D Manager',
      'Director, Sales / Marketing (EMEA)',
      '100% remote? #1 role',
      'a=b&l=Berlin',
      'Ingeniero de Diseño',
      'プロジェクトマネージャー',
      'Chef 👩‍🍳',
      'https://example.com/?x=1',
      '../../secret',
      '<script>alert(1)</script>',
      'Don’t "quote" me',
      'already%20encoded',
    ])('keeps %s whole, in its own word', (odd) => {
      const [search] = searchesFor({
        roles: [odd],
        places: [odd],
        companies: ['public'],
      });
      expect(search?.title).toBe(odd);
      const linkedIn = new URL(linkOn(search, 'LinkedIn'));
      expect(linkedIn.origin + linkedIn.pathname).toBe('https://www.linkedin.com/jobs/search/');
      expect([...linkedIn.searchParams.keys()]).toEqual(['keywords', 'location', 'f_TPR']);
      expect(linkedIn.searchParams.get('keywords')).toBe(odd);
      expect(linkedIn.searchParams.get('location')).toBe(odd);
      expect(linkedIn.hash).toBe('');
      const indeed = new URL(linkOn(search, 'Indeed'));
      expect(indeed.origin + indeed.pathname).toBe('https://www.indeed.com/jobs');
      expect([...indeed.searchParams.keys()]).toEqual(['q', 'l', 'fromage']);
      expect(indeed.searchParams.get('q')).toBe(odd);
      expect(indeed.searchParams.get('l')).toBe(odd);
      expect(indeed.hash).toBe('');
      const government = new URL(linkOn(search, 'GovernmentJobs'));
      expect(government.origin + government.pathname).toBe('https://www.governmentjobs.com/jobs');
      expect([...government.searchParams.keys()]).toEqual(['keyword', 'location']);
      expect(government.searchParams.get('keyword')).toBe(odd);
      expect(government.searchParams.get('location')).toBe(odd);
      expect(government.hash).toBe('');
    });

    it('spells its marks out in the address, with %20 for a space and %2B for a plus', () => {
      const [search] = searchesFor({ roles: ['C++ & R&D'] });
      expect(linkOn(search, 'Indeed')).toBe(
        'https://www.indeed.com/jobs?q=C%2B%2B%20%26%20R%26D&fromage=7',
      );
    });

    it('puts each title and place on one line, without control characters', () => {
      const [search] = searchesFor({
        roles: ['Lead\n\tDesigner\u0000 '],
        places: [' Salt   Lake\r\nCity, UT '],
      });
      expect(search).toMatchObject({ title: 'Lead Designer', where: 'Salt Lake City, UT' });
      expect(linkOn(search, 'Indeed')).toBe(
        'https://www.indeed.com/jobs?q=Lead%20Designer&l=Salt%20Lake%20City%2C%20UT&fromage=7',
      );
    });

    it('takes half of a broken letter, as a hand-edited file can hold, without throwing', () => {
      const [search] = searchesFor({ roles: ['Chef \uD83D'] });
      expect(new URL(linkOn(search, 'Indeed')).searchParams.get('q')).toBe('Chef �');
    });

    it('leaves out a title that’s nothing but blanks, or the same as another', () => {
      const searches = searchesFor({
        roles: ['Lead  Designer', 'lead designer', '\u0000\u0001'],
        places: ['Tulsa,  OK', 'tulsa, ok'],
      });
      expect(searches.map(({ title, where }) => `${title} · ${where}`)).toEqual([
        'Lead Designer · Tulsa, OK',
      ]);
    });

    it('stays under what Windows opens, at the longest Profile keeps, in any letters', () => {
      const [search] = searchesFor({
        roles: ['日'.repeat(120)],
        places: ['日'.repeat(120)],
        companies: ['public'],
      });
      // What it shows stays whole, and only the address is cut.
      expect(search?.title).toHaveLength(120);
      expect(search?.links).toHaveLength(3);
      for (const { url } of search?.links ?? []) expect(url.length).toBeLessThan(2081);
      const [remote] = searchesFor({
        roles: ['日'.repeat(120)],
        workplaces: ['remote'],
        remoteFrom: '日'.repeat(60),
      });
      expect(remote?.where).toBe(`Remote, ${'日'.repeat(60)}`);
      for (const { url } of remote?.links ?? []) expect(url.length).toBeLessThan(2081);
    });
  });
});

describe('remoteArea', () => {
  it.each([
    ['anywhere in the US', 'United States'],
    ['Anywhere in the U.S.', 'United States'],
    ['the US', 'United States'],
    ['US', 'United States'],
    ['USA', 'United States'],
    ['U.S.A.', 'United States'],
    ['US only', 'United States'],
    ['US, only', 'United States'],
    ['US-based', 'United States'],
    ['United States', 'United States'],
    ['the United States of America', 'United States'],
    ['Continental US', 'United States'],
    ['from the US', 'United States'],
    ['Anywhere, US', 'United States'],
    ['any US state', 'United States'],
    ['Remote in the US', 'United States'],
    ['Remote (US)', 'United States'],
    ['US or Canada', 'United States'],
    ['US, or Canada', 'United States'],
    ['US/Canada', 'United States'],
    ['US & Canada', 'United States'],
    ['US and Canada', 'United States'],
    ['US time zones', 'United States'],
    ['US except California', 'United States'],
    // What follows the US never leaves the app with it.
    ['US, I need sponsorship', 'United States'],
    ['Canada', 'Canada'],
    ['Remote (Canada)', 'Canada'],
    ['Canada (no Quebec)', 'Canada'],
    ['Canada or the US', 'Canada'],
    ['anywhere in Europe', 'Europe'],
    ['North America', 'North America'],
    ['UK & Ireland', 'UK'],
    ['Ohio', 'Ohio'],
    ['near Chicago', 'Chicago'],
    ['Hartford, CT', 'Hartford, CT'],
    ['Helena, MT.', 'Helena, MT'],
    ['Portland, OR area', 'Portland, OR area'],
    ['Portland, or Seattle', 'Portland'],
    ['the Netherlands', 'Netherlands'],
    ['Inland Empire', 'Inland Empire'],
    ['Central Europe', 'Central Europe'],
    ['Pacific Northwest', 'Pacific Northwest'],
    ['Hawai’i', 'Hawai’i'],
    ['東京', '東京'],
  ])('reads %j as %j', (said, area) => {
    expect(remoteArea(said)).toBe(area);
  });

  it.each([
    // Time zones.
    'Central European time',
    'EST',
    'CET',
    'CEST',
    'IST',
    'AEST',
    'within 3 hours of PST',
    'UTC+2',
    'GMT+1',
    'Eastern',
    'Pacific',
    'ET',
    'PT',
    // Nowhere in particular.
    'anywhere',
    'Anywhere!',
    'worldwide',
    'anywhere in the world',
    'Remote',
    '',
    '   ',
    // Sentences, which aren't for a location box, as some would tell a site more than a place.
    'I can only work from Texas',
    'Anywhere but Texas',
    'Not California',
    'I am a US citizen living in Germany',
    'Germany, but willing to move',
    'from home',
    // A list it can't read, rather than half of it.
    'North and South America',
    'Bosnia and Herzegovina',
    // A street, or anything else with a number in it.
    '123 Main St, Denver',
    'within 50 miles',
    // Too long to be a place.
    'San Francisco Bay Area in California',
    'x'.repeat(61),
  ])('looks with no location for %j', (said) => {
    expect(remoteArea(said)).toBe('');
  });
});
