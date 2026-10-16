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
    `<html><head><title>Senior Product Manager, Data | Tidewater</title><script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script></head><body>${body}</body></html>`,
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

  it('falls back to the page’s main text, without its navigation, footer, sidebar or forms', () => {
    const plain = page(`<html><head><title>Careers at Lumen Health</title>
      <meta property="og:site_name" content="Lumen Health"></head><body>
      <nav>Home About Careers</nav>
      <main><h1>Clinical Data Lead</h1><p>Join us.</p><aside>Similar jobs</aside>
        <form><label>Email <input></label></form><footer>© Lumen</footer></main>
      <footer>Privacy</footer></body></html>`);
    const job = readJobPage(plain, 'https://lumen.example/careers/clinical-data-lead', '');
    expect(job.title).toBe('Clinical Data Lead');
    expect(job.company).toBe('Lumen Health');
    expect(job.posting).toBe('Clinical Data Lead\n\nJoin us.');
    // Marked as the page's main text, which a save without the popup leaves out.
    expect(job.source).toBe('main');
  });

  it('reads the page as it is, and changes nothing in it', () => {
    const doc = withData(
      JOB_DATA,
      '<main><p>Shown.</p><nav>Menu</nav><script>window.ran = 1</script><ul><li>One</li></ul></main>',
    );
    const before = doc.documentElement.outerHTML;
    readJobPage(doc, 'https://a.example/jobs/1', '');
    expect(doc.documentElement.outerHTML).toBe(before);
  });

  it('never reads LinkedIn’s page around a posting it can’t find', () => {
    const linkedIn = page(`<html><head><title>Messaging | LinkedIn</title>
      <meta property="og:site_name" content="LinkedIn"></head><body>
      <main><h1>Messaging</h1><p>A private message.</p></main></body></html>`);
    const job = readJobPage(linkedIn, 'https://www.linkedin.com/messaging/thread/1/', '');
    expect(job.posting).toBe('');
    expect(job.source).toBe('page');
    expect(job.company).toBe('');
  });

  it('rewrites LinkedIn and Indeed addresses on their job pages only', () => {
    const blank = page('<title>x</title>');
    expect(
      readJobPage(blank, 'https://www.linkedin.com/feed/?currentJobId=4012345678', '').url,
    ).toBe('https://www.linkedin.com/feed/?currentJobId=4012345678');
    expect(readJobPage(blank, 'https://www.indeed.com/career-advice?jk=abc123', '').url).toBe(
      'https://www.indeed.com/career-advice?jk=abc123',
    );
    expect(readJobPage(blank, 'https://www.indeed.com/m/viewjob?jk=abc123&from=serp', '').url).toBe(
      'https://www.indeed.com/viewjob?jk=abc123',
    );
  });

  it('keeps a careers site’s route to a job after “#/”, and drops any other “#”', () => {
    const blank = page('<title>x</title>');
    expect(readJobPage(blank, 'https://careers.example.com/?utm_source=x#/jobs/42', '').url).toBe(
      'https://careers.example.com/#/jobs/42',
    );
    expect(readJobPage(blank, 'https://careers.example.com/#!/job/7', '').url).toBe(
      'https://careers.example.com/#!/job/7',
    );
    expect(readJobPage(blank, 'https://careers.example.com/jobs/7#apply', '').url).toBe(
      'https://careers.example.com/jobs/7',
    );
  });

  it('reads a list whose items are paragraphs one item to a line', () => {
    const listed = page(
      '<main><p>You will:</p><ul><li><p>Own the roadmap</p></li><li><p>Ship weekly</p></li><li></li></ul><p>Thanks.</p></main>',
    );
    expect(readJobPage(listed, 'https://a.example/jobs/1', '').posting).toBe(
      'You will:\n\n- Own the roadmap\n- Ship weekly\n\nThanks.',
    );
  });

  it('finds a posting under the page’s main entity, and reads a description encoded twice', () => {
    const twice = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      mainEntity: {
        ...JOB_DATA,
        description:
          '&lt;p&gt;Lead our &lt;b&gt;data platform&lt;/b&gt;.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Own it&lt;/li&gt;&lt;/ul&gt;',
      },
    };
    const job = readJobPage(withData(twice), 'https://a.example/jobs/1', '');
    expect(job.title).toBe('Senior Product Manager, Data');
    expect(job.posting).toBe('Lead our data platform.\n\n- Own it');
  });

  it('takes the posting for this page from a page with several', () => {
    const other = { ...JOB_DATA, title: 'Data Engineer', url: 'https://a.example/jobs/2' };
    const mine = { ...JOB_DATA, url: 'https://a.example/jobs/1/' };
    expect(readJobPage(withData([other, mine]), 'https://a.example/jobs/1', '').title).toBe(
      'Senior Product Manager, Data',
    );
    // With no address to go by, none: it can't tell which is this page's.
    const unnamed = [
      { ...other, url: undefined },
      { ...mine, url: undefined },
    ];
    expect(readJobPage(withData(unnamed), 'https://a.example/jobs/1', '').source).toBe('main');
  });

  it('leaves out job data the page no longer shows, as a single-page site can keep', () => {
    const stale = withData(
      { ...JOB_DATA, title: 'An Earlier Job' },
      `<div class="job-details-jobs-unified-top-card__job-title"><h1>Staff Engineer, Payments</h1></div>
       <div class="job-details-jobs-unified-top-card__company-name"><a>Northwind</a></div>
       <div class="jobs-description__content"><p>Build payments at scale.</p></div>`,
    );
    const job = readJobPage(stale, 'https://www.linkedin.com/jobs/view/4012345678/', '');
    expect(job).toMatchObject<Partial<PageJob>>({
      title: 'Staff Engineer, Payments',
      company: 'Northwind',
      posting: 'Build payments at scale.',
      source: 'page',
      pay: '',
    });
  });

  it('leaves out job data for another page of the site, on a site it doesn’t know', () => {
    const old = { ...JOB_DATA, title: 'Old Job', url: 'https://jobs.example.com/jobs/1' };
    const job = readJobPage(
      withData(old, '<main><h1>New Job</h1><p>The new posting.</p></main>'),
      'https://jobs.example.com/jobs/2',
      '',
    );
    expect(job).toMatchObject<Partial<PageJob>>({ title: 'New Job', source: 'main', pay: '' });
    expect(job.posting).toContain('The new posting.');
  });

  it('leaves out job data whose title the page doesn’t show, and keeps one it shows its way', () => {
    const read = (title: string, heading: string) =>
      readJobPage(
        withData({ ...JOB_DATA, title }, `<main><h1>${heading}</h1><p>Posting.</p></main>`),
        'https://jobs.example.com/jobs/2',
        '',
      );
    const stale = read('Product Designer', 'Data Engineer');
    expect(stale.source).toBe('main');
    expect(stale.title).toBe('Data Engineer');
    expect(read('Sr. Software Engineer', 'Senior Software Engineer').source).toBe('structured');
  });

  it('reads a title in the job data with entities, as the page shows it', () => {
    const doc = withData(
      { ...JOB_DATA, title: 'R&amp;D Engineer' },
      '<main><h1>R&amp;D Engineer</h1></main>',
    );
    const job = readJobPage(doc, 'https://jobs.example.com/rd', '');
    expect(job).toMatchObject<Partial<PageJob>>({
      title: 'R&D Engineer',
      company: 'Tidewater Analytics',
      source: 'structured',
    });
  });

  it('keeps tags a posting only mentions, as in “use <div>”', () => {
    const doc = withData({
      ...JOB_DATA,
      description: '<p>Build pages with &lt;div&gt; and &lt;canvas&gt;.</p>',
    });
    expect(readJobPage(doc, 'https://jobs.example.com/fe', '').posting).toBe(
      'Build pages with <div> and <canvas>.',
    );
  });

  it('takes the posting for this page’s route, on a careers site that keeps each job after “#/”', () => {
    const one = {
      ...JOB_DATA,
      title: 'Data Engineer',
      url: 'https://careers.example.com/#/jobs/1',
    };
    const two = { ...JOB_DATA, url: 'https://careers.example.com/#/jobs/2' };
    expect(
      readJobPage(withData([one, two]), 'https://careers.example.com/#/jobs/2', '').title,
    ).toBe('Senior Product Manager, Data');
  });

  it('takes what a job site shows over its job data when that’s much fuller', () => {
    const short = { ...JOB_DATA, title: 'Data Analyst', description: '<p>Analyze.</p>' };
    const indeed = withData(
      short,
      `<h1 data-testid="jobsearch-JobInfoHeader-title">Data Analyst</h1>
       <div id="jobDescriptionText"><p>${'Analyze things for the team. '.repeat(20)}</p></div>`,
    );
    const job = readJobPage(indeed, 'https://www.indeed.com/viewjob?jk=a1b2', '');
    expect(job.source).toBe('page');
    expect(job.posting).toContain('Analyze things for the team.');
  });

  it('drops Indeed’s hidden “- job post” from the title', () => {
    const indeed =
      page(`<body><h1 data-testid="jobsearch-JobInfoHeader-title"><span>Data Analyst</span><span class="sr-only"> - job post</span></h1>
      <div id="jobDescriptionText"><p>Analyze things.</p></div></body>`);
    expect(readJobPage(indeed, 'https://www.indeed.com/viewjob?jk=a1b2', '').title).toBe(
      'Data Analyst',
    );
  });

  it('never takes a job board’s or an applicant system’s name as the company', () => {
    for (const site of ['LinkedIn', 'Indeed', 'Glassdoor', 'Lever', 'Greenhouse', 'Workday']) {
      const board = page(`<html><head><meta property="og:site_name" content="${site}"></head>
        <body><main><h1>Data Lead</h1><p>Lead data.</p></main></body></html>`);
      expect(readJobPage(board, 'https://jobs.example.com/1', '').company, site).toBe('');
    }
    // A job that is with one, as its own data says, is.
    const atLinkedIn = withData({ ...JOB_DATA, hiringOrganization: { name: 'LinkedIn' } });
    expect(readJobPage(atLinkedIn, 'https://careers.linkedin.com/jobs/1', '').company).toBe(
      'LinkedIn',
    );
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
