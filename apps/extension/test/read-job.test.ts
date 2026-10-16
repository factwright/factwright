import { describe, expect, it } from 'vitest';
import { type PageJob, readJobPage } from '../src/page/read-job.ts';

/** A page as the browser would have it. */
const page = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/** A posting's job data, as job sites publish it for search engines. */
const JOB_DATA = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Senior Product Manager, Data',
  hiringOrganization: { '@type': 'Organization', name: 'Tidewater Analytics' },
  jobLocation: [
    {
      '@type': 'Place',
      address: { addressLocality: 'Chicago', addressRegion: 'IL', addressCountry: 'US' },
    },
  ],
  jobLocationType: 'TELECOMMUTE',
  baseSalary: {
    '@type': 'MonetaryAmount',
    currency: 'USD',
    value: { '@type': 'QuantitativeValue', minValue: 150000, maxValue: 180000, unitText: 'YEAR' },
  },
  employmentType: ['FULL_TIME'],
  datePosted: '2026-10-14T09:00:00Z',
  description:
    '<p>Lead our <b>data platform</b>.</p><h3>What you’ll do</h3><ul><li>Own the roadmap</li><li>Ship weekly</li></ul><script>alert(1)</script>',
};

const withData = (data: unknown, body = '<main><h1>Elsewhere</h1></main>') =>
  page(
    // Job sites write "<" in their job data as \u003c, so a "</script>" in it can't end it early.
    `<html><head><title>Senior PM | Tidewater</title><script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script></head><body>${body}</body></html>`,
  );

describe('reading a job page', () => {
  it('takes the job’s own data first: title, company, place, pay, kind and posting', () => {
    const job = readJobPage(
      withData(JOB_DATA),
      'https://jobs.example.com/pm-data?utm_source=x#apply',
      '',
    );
    expect(job).toMatchObject<Partial<PageJob>>({
      url: 'https://jobs.example.com/pm-data',
      site: 'jobs.example.com',
      title: 'Senior Product Manager, Data',
      company: 'Tidewater Analytics',
      location: 'Remote; Chicago, IL, US',
      pay: 'USD 150,000–180,000 a year',
      employment: 'Full time',
      posted: '2026-10-14',
      source: 'structured',
    });
    expect(job.posting).toBe(
      'Lead our data platform.\n\nWhat you’ll do\n\n- Own the roadmap\n- Ship weekly',
    );
    expect(job.posting).not.toContain('alert');
  });

  it('finds the job data inside a graph, or a list', () => {
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebPage' }, JOB_DATA],
    };
    expect(readJobPage(withData(graph), 'https://a.example/jobs/1', '').title).toBe(
      'Senior Product Manager, Data',
    );
    expect(readJobPage(withData([JOB_DATA]), 'https://a.example/jobs/1', '').company).toBe(
      'Tidewater Analytics',
    );
  });

  it('reads a signed-in LinkedIn job, and keeps the job’s own address', () => {
    const linkedIn = page(`<html><head><title>(3) Jobs | LinkedIn</title></head><body>
      <div class="job-details-jobs-unified-top-card__job-title"><h1>Staff Engineer, Payments</h1></div>
      <div class="job-details-jobs-unified-top-card__company-name"><a>Northwind</a></div>
      <div class="job-details-jobs-unified-top-card__primary-description-container"><span class="tvm__text">Austin, TX</span></div>
      <div class="jobs-description__content"><h2>About the job</h2><p>Build payments at scale.</p><ul><li>Go</li><li>Postgres</li></ul></div>
    </body></html>`);
    const job = readJobPage(
      linkedIn,
      'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=staff%20engineer',
      '',
    );
    expect(job).toMatchObject<Partial<PageJob>>({
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
      site: 'linkedin.com',
      title: 'Staff Engineer, Payments',
      company: 'Northwind',
      location: 'Austin, TX',
      source: 'page',
    });
    expect(job.posting).toBe('About the job\n\nBuild payments at scale.\n\n- Go\n- Postgres');
    expect(job.pageUrl).toContain('keywords=');
  });

  it('keeps a LinkedIn job page’s address without its tracking', () => {
    const job = readJobPage(
      page('<body><div class="jobs-description__content">Posting</div></body>'),
      'https://www.linkedin.com/jobs/view/staff-engineer-at-northwind-4012345678/?trk=abc',
      '',
    );
    expect(job.url).toBe('https://www.linkedin.com/jobs/view/4012345678/');
  });

  it('reads an Indeed job from its search, as the job’s own page', () => {
    const indeed = page(`<body>
      <h1 data-testid="jobsearch-JobInfoHeader-title">Data Analyst</h1>
      <div data-testid="inlineHeader-companyName">Fernway</div>
      <div id="jobDescriptionText"><p>Analyze things.</p></div></body>`);
    const job = readJobPage(indeed, 'https://www.indeed.com/jobs?q=analyst&vjk=a1b2c3d4e5', '');
    expect(job.url).toBe('https://www.indeed.com/viewjob?jk=a1b2c3d4e5');
    expect(job.title).toBe('Data Analyst');
    expect(job.company).toBe('Fernway');
    expect(job.posting).toBe('Analyze things.');
  });

  it('uses the text you selected as the posting, for a page it can’t read well', () => {
    const selected = `We're hiring a designer. ${'You will design things. '.repeat(12)}`;
    const job = readJobPage(withData(JOB_DATA), 'https://a.example/jobs/1', selected);
    expect(job.source).toBe('selection');
    expect(job.posting).toBe(selected.trim());
    // The job's data still names it.
    expect(job.title).toBe('Senior Product Manager, Data');
  });

  it('ignores a short selection, such as a word', () => {
    expect(readJobPage(withData(JOB_DATA), 'https://a.example/jobs/1', 'data').source).toBe(
      'structured',
    );
  });

  it('falls back to the page’s main text, without its navigation or footer', () => {
    const plain = page(`<html><head><title>Careers at Lumen Health</title>
      <meta property="og:site_name" content="Lumen Health"></head><body>
      <nav>Home About Careers</nav>
      <main><h1>Clinical Data Lead</h1><p>Join us.</p><footer>© Lumen</footer></main>
      <footer>Privacy</footer></body></html>`);
    const job = readJobPage(plain, 'https://lumen.example/careers/clinical-data-lead', '');
    expect(job.title).toBe('Clinical Data Lead');
    expect(job.company).toBe('Lumen Health');
    expect(job.posting).toBe('Clinical Data Lead\n\nJoin us.');
    expect(job.source).toBe('page');
  });

  it('leaves out what the page hides', () => {
    const hidden = page(
      '<main><p>Shown.</p><p hidden>Hidden.</p><p aria-hidden="true">Also hidden.</p><p style="display: none">Not shown.</p></main>',
    );
    expect(readJobPage(hidden, 'https://a.example/jobs/1', '').posting).toBe('Shown.');
  });

  it('caps a very long posting', () => {
    const long = page(`<main><p>${'word '.repeat(40_000)}</p></main>`);
    expect(readJobPage(long, 'https://a.example/jobs/1', '').posting.length).toBe(100_000);
  });

  it('runs on its own, as the browser sends it into the page, with nothing from around it', () => {
    const alone = new Function(`return (${readJobPage.toString()})`)() as typeof readJobPage;
    expect(alone(withData(JOB_DATA), 'https://a.example/jobs/1', '').company).toBe(
      'Tidewater Analytics',
    );
  });
});
