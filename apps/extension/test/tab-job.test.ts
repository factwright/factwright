import { describe, expect, it } from 'vitest';
import { type PageJob, readJobPage } from '../src/page/read-job.ts';
import {
  companyFromAddress,
  fromTabTitle,
  isJobAddress,
  jobAddress,
  jobFromTab,
  looksLikeJob,
  needsChecking,
  toSave,
} from '../src/tab-job.ts';

const ADDRESSES = [
  'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=engineer',
  'https://www.linkedin.com/jobs/view/staff-engineer-at-northwind-4012345678/?trk=abc',
  'https://www.indeed.com/jobs?q=analyst&vjk=a1b2c3d4e5',
  'https://uk.indeed.com/viewjob?jk=abc123&from=serp',
  'https://jobs.example.com/pm-data?utm_source=x&team=data#apply',
  'https://www.linkedin.com/feed/?currentJobId=4012345678',
  'https://www.indeed.com/career-advice?jk=abc123',
  'https://www.indeed.com/m/basecamp/viewjob?viewtype=embedded&jk=abc123',
  'https://www.indeed.com/cmp/Acme/jobs?jk=abc123',
  'https://careers.example.com/?utm_source=x#/jobs/42',
  'https://careers.example.com/#!/job/7',
  'https://careers.example.com/#/jobs/42:~:text=Data',
  'https://jobs.example.com/jobs/42#:~:text=Senior',
  'not a link',
];

describe('a job’s own address', () => {
  it('is the same as reading the page gives', () => {
    for (const href of ADDRESSES) {
      const page = new DOMParser().parseFromString('<title>x</title>', 'text/html');
      expect(jobAddress(href), href).toBe(readJobPage(page, href, '').url);
    }
  });

  it('is the job’s own page on LinkedIn and Indeed, and the page without tracking elsewhere', () => {
    expect(jobAddress(ADDRESSES[0] ?? '')).toBe('https://www.linkedin.com/jobs/view/4012345678/');
    expect(jobAddress(ADDRESSES[2] ?? '')).toBe('https://www.indeed.com/viewjob?jk=a1b2c3d4e5');
    expect(jobAddress(ADDRESSES[4] ?? '')).toBe('https://jobs.example.com/pm-data?team=data');
  });
});

describe('whether an address is one job’s', () => {
  it('is, on LinkedIn and Indeed, only for a job’s own page', () => {
    expect(isJobAddress('https://www.linkedin.com/jobs/view/4012345678/')).toBe(true);
    expect(isJobAddress('https://www.linkedin.com/jobs/search/?keywords=engineer')).toBe(false);
    expect(isJobAddress('https://www.linkedin.com/feed/')).toBe(false);
    expect(isJobAddress('https://www.indeed.com/viewjob?jk=a1b2c3d4e5')).toBe(true);
    expect(isJobAddress('https://www.indeed.com/jobs?q=analyst')).toBe(false);
  });

  it('is, anywhere else, any page', () => {
    expect(isJobAddress('https://careers.example.com/#/jobs/42')).toBe(true);
    expect(isJobAddress('not a link')).toBe(false);
  });
});

describe('a company from a job’s address', () => {
  it('is the company’s own site’s name', () => {
    expect(companyFromAddress('https://careers.lumen.example/jobs/7')).toBe('Lumen');
    expect(companyFromAddress('https://www.fernway.com/careers/data-lead')).toBe('Fernway');
    expect(companyFromAddress('https://acme.wd5.myworkdayjobs.com/en-US/External/job/1')).toBe(
      'Acme',
    );
    expect(companyFromAddress('https://careers-acme.icims.com/jobs/1/job')).toBe('Acme');
  });

  it('is the company an applicant system’s address names', () => {
    expect(companyFromAddress('https://jobs.lever.co/harbor-and-pine/4f1c2b7e')).toBe(
      'Harbor and Pine',
    );
    expect(companyFromAddress('https://boards.greenhouse.io/fernway/jobs/123')).toBe('Fernway');
    expect(companyFromAddress('https://job-boards.greenhouse.io/fernway/jobs/123')).toBe('Fernway');
    expect(
      companyFromAddress('https://boards.greenhouse.io/embed/job_app?for=fernway&token=123'),
    ).toBe('Fernway');
    expect(companyFromAddress('https://jobs.ashbyhq.com/northwind/9a8b')).toBe('Northwind');
    expect(companyFromAddress('https://apply.workable.com/tidewater/j/ABC123/')).toBe('Tidewater');
  });

  it('is none on a job board', () => {
    for (const url of [
      'https://www.linkedin.com/jobs/view/4012345678/',
      'https://uk.indeed.com/viewjob?jk=abc',
      'https://www.glassdoor.co.uk/job-listing/x',
      'https://www.ziprecruiter.com/c/Acme/Job/1',
      'https://wellfound.com/jobs/1',
      'https://news.ycombinator.com/item?id=41000002',
      'not a link',
    ]) {
      expect(companyFromAddress(url), url).toBe('');
    }
  });
});

describe('a tab’s title', () => {
  it('names the job and company as job sites write them', () => {
    expect(fromTabTitle('(3) Staff Engineer, Payments | Northwind | LinkedIn')).toEqual({
      role: 'Staff Engineer, Payments',
      company: 'Northwind',
    });
    expect(fromTabTitle('Northwind hiring Staff Engineer in Austin, TX | LinkedIn')).toEqual({
      role: 'Staff Engineer',
      company: 'Northwind',
    });
    expect(fromTabTitle('Job Application for Data Lead at Fernway')).toEqual({
      role: 'Data Lead',
      company: 'Fernway',
    });
    expect(fromTabTitle('Senior Engineer - Platform - Acme')).toEqual({
      role: 'Senior Engineer',
      company: 'Acme',
    });
    expect(fromTabTitle('Careers')).toEqual({ role: 'Careers', company: '' });
  });

  it('names nothing for a search, or a site’s own page', () => {
    for (const title of [
      '(3) Jobs | LinkedIn',
      'Software Engineer Jobs, Employment in Austin, TX | Indeed.com',
      '1,204 Data Analyst jobs in United States',
      'Feed | LinkedIn',
    ]) {
      expect(fromTabTitle(title), title).toEqual({ role: '', company: '' });
    }
  });
});

describe('the job to save', () => {
  it('takes no company from a job board’s page that names none', () => {
    const job = jobFromTab('https://www.linkedin.com/jobs/view/4012345678/', 'Jobs | LinkedIn');
    expect(toSave(job)).toMatchObject({ company: '', role: '' });
  });

  it('takes the company from the site when the page names none', () => {
    const job = jobFromTab('https://careers.lumen.example/jobs/7', 'Clinical Data Lead');
    expect(toSave(job)).toEqual({
      url: 'https://careers.lumen.example/jobs/7',
      site: 'careers.lumen.example',
      company: 'Lumen',
      role: 'Clinical Data Lead',
      pay: '',
      posting: '',
    });
  });
});

describe('whether a page looks like a job’s', () => {
  /** A page on a site it doesn't know, as reading it gives: its main text, and nothing more. */
  const unknown = (href: string, title: string, text: string) =>
    readJobPage(
      new DOMParser().parseFromString(`<title>${title}</title><main>${text}</main>`, 'text/html'),
      href,
      '',
    );
  const POSTING =
    '<h2>What you’ll do</h2><p>Run our data platform.</p><h2>Requirements</h2><p>Five years of SQL.</p><p>$120,000 – $150,000 a year. Fernway is an equal opportunity employer.</p>';

  it('does for a posting on a careers site it doesn’t know, by its address, title or words', () => {
    // Its address and title alone.
    const careers = unknown(
      'https://www.fernway.example/careers/data-lead',
      'Data Lead | Fernway',
      '<p>Join us.</p>',
    );
    expect(careers.source).toBe('main');
    expect(looksLikeJob(careers, null)).toBe(true);
    // A careers site's route after "#/", and a query naming a job, as an embedded board's does.
    expect(
      looksLikeJob(unknown('https://fernway.example/#/openings/7', 'Data Lead', ''), null),
    ).toBe(true);
    expect(
      looksLikeJob(
        unknown('https://fernway.example/about?gh_jid=4461450008', 'Data Lead', ''),
        null,
      ),
    ).toBe(true);
    // What it says alone, at an address and under a title that say nothing of jobs.
    expect(looksLikeJob(unknown('https://fernway.example/p/7a1c', 'Fernway', POSTING), null)).toBe(
      true,
    );
  });

  it('does for a job’s own data, a job site’s own posting, or text you selected', () => {
    const read = (source: PageJob['source'], posting = 'Run our data platform.') => ({
      ...jobFromTab('https://fernway.example/p/7a1c', 'Fernway'),
      posting,
      source,
    });
    expect(looksLikeJob(read('structured'), null)).toBe(true);
    expect(looksLikeJob(read('page'), null)).toBe(true);
    expect(looksLikeJob(read('selection'), null)).toBe(true);
    // Where only its data or a job site's layout says it is.
    expect(looksLikeJob({ ...read('main'), location: 'Austin, TX' }, null)).toBe(true);
    expect(looksLikeJob(read('main'), null)).toBe(false);
    expect(looksLikeJob(read('page', ''), null)).toBe(false);
  });

  it('does for any page of an applicant system’s, and leaves LinkedIn and Indeed to their addresses', () => {
    expect(
      looksLikeJob(unknown('https://jobs.lever.co/harbor-and-pine', 'Harbor & Pine', ''), null),
    ).toBe(true);
    expect(
      looksLikeJob(
        unknown('https://acme.wd5.myworkdayjobs.com/en-US/External', 'Careers', ''),
        null,
      ),
    ).toBe(true);
    // LinkedIn's feed isn't one job's page, which the popup and a save without it say instead.
    const feed = unknown('https://www.linkedin.com/feed/', 'Feed | LinkedIn', '');
    expect(looksLikeJob(feed, null)).toBe(true);
    expect(needsChecking(feed, toSave(feed), null)).toMatch(/one job/);
  });

  it('gives a page it can’t read, or a LinkedIn job by its link alone, the benefit of the doubt', () => {
    const pdf = jobFromTab('https://example.com/annual-report.pdf', 'annual-report.pdf');
    expect(looksLikeJob(pdf, 'unreadable')).toBe(true);
    const linkOnly = jobFromTab(
      'https://www.linkedin.com/jobs/view/4012345678/',
      'Jobs | LinkedIn',
    );
    expect(looksLikeJob(linkOnly, 'linkedin-link-only')).toBe(true);
  });

  it('doesn’t for a search engine’s results, whatever they say', () => {
    for (const href of [
      'https://www.google.com/search?q=data+lead+jobs',
      'https://www.google.co.uk/search?q=data+lead+jobs&oq=data',
      'https://www.bing.com/search?q=data+lead+jobs',
      'https://duckduckgo.com/?q=data+lead+jobs',
      'https://search.yahoo.com/search?p=data+lead+jobs',
    ]) {
      expect(looksLikeJob(unknown(href, 'data lead jobs - Search', POSTING), null), href).toBe(
        false,
      );
    }
    // A search engine's other pages, such as its own careers site, are read as any other.
    expect(
      looksLikeJob(
        unknown(
          'https://www.google.com/about/careers/applications/jobs/results/123-data-lead',
          'Data Lead — Careers',
          '',
        ),
        null,
      ),
    ).toBe(true);
  });

  it('doesn’t for a page with no sign of a job, or only one', () => {
    for (const [href, title, text] of [
      [
        'https://weather.example/today/chicago',
        'Chicago, IL Weather Forecast',
        '<p>Today: sunny, with a high of 61°F. Hourly forecast: wind 10 miles per hour.</p>',
      ],
      [
        'https://news.example/2026/10/24/council-budget',
        'Council passes the city’s budget',
        '<p>The budget adds benefits for the city’s parks and libraries.</p>',
      ],
      // A title that names a role, on a page that says nothing else of a job.
      [
        'https://docs.example/python/guide',
        'The Python Developer’s Guide',
        '<p>Install Python, then run the script.</p>',
      ],
      // An address about jobs, on a page that says nothing else of one.
      ['https://fernway.example/careers', 'Fernway', '<p>Our story, from 1998.</p>'],
    ] as const) {
      expect(looksLikeJob(unknown(href, title, text), null), href).toBe(false);
    }
  });
});

describe('a save without the popup', () => {
  const read = (overrides: Partial<PageJob>): PageJob => ({
    ...jobFromTab('https://jobs.lever.co/harbor-and-pine/4f1c', 'Senior PM'),
    title: 'Senior PM',
    company: 'Harbor & Pine',
    posting: 'Lead the roadmap.',
    source: 'structured',
    ...overrides,
  });

  it('saves what looks like one job', () => {
    const page = read({});
    expect(needsChecking(page, toSave(page), null)).toBeNull();
    const selected = read({ source: 'selection', url: 'https://lumen.example/careers' });
    expect(needsChecking(selected, toSave(selected), null)).toBeNull();
    // A LinkedIn job by its link alone, as the person chose.
    const linkOnly = jobFromTab(
      'https://www.linkedin.com/jobs/view/4012345678/',
      'Staff Engineer | Northwind | LinkedIn',
    );
    expect(needsChecking(linkOnly, toSave(linkOnly), 'linkedin-link-only')).toBeNull();
  });

  it('has anything else checked in the popup first', () => {
    const main = read({ source: 'main', url: 'https://lumen.example/careers/7' });
    expect(needsChecking(main, toSave(main), null)).toMatch(/posting/);
    const search = read({ url: 'https://www.linkedin.com/jobs/search/?keywords=pm' });
    expect(needsChecking(search, toSave(search), null)).toMatch(/one job/);
    const nameless = read({ company: '', url: 'https://www.indeed.com/viewjob?jk=a1' });
    expect(needsChecking(nameless, toSave(nameless), null)).toMatch(/company/);
    const untitled = read({ title: '' });
    expect(needsChecking(untitled, toSave(untitled), null)).toMatch(/title/);
    // A page with no posting it could find, such as one inside a form, or one it can't read.
    const empty = read({ posting: '' });
    expect(needsChecking(empty, toSave(empty), null)).toMatch(/posting/);
    const pdf = jobFromTab('https://example.com/annual-report.pdf', 'annual-report.pdf');
    expect(needsChecking(pdf, toSave(pdf), 'unreadable')).toMatch(/can’t read/);
    // A page that doesn't look like a job's at all, though it names a title and a company.
    const weather = read({
      url: 'https://weather.example/today/chicago',
      title: 'Chicago, IL Weather Forecast',
      company: 'Weather Example',
      posting: 'Today: sunny, with a high of 61°F.',
      source: 'main',
    });
    expect(needsChecking(weather, toSave(weather), null)).toBe(
      'This doesn’t look like a job posting.',
    );
  });
});
