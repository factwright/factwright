import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { postingKey } from '@factwright/core';
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

const withData = (
  data: unknown,
  body = '<main><h1>Senior Product Manager, Data</h1><p>Apply today.</p></main>',
) =>
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

  it('leaves out an application form built without a form element, and keeps the posting beside it', () => {
    const careers = page(`<html><head><title>Data Lead | Lumen Health</title></head><body><main>
      <h1>Data Lead</h1>
      <div class="description"><h2>What you’ll do</h2><p>Run our data platform.</p></div>
      <div class="apply">
        <h2>Apply for this job</h2>
        <div class="field"><div class="label">First name *</div><input name="first"></div>
        <div class="field"><label for="mail">Email</label><input id="mail" type="email">
          <p class="hint">We’ll write to you here.</p></div>
        <div class="field"><span>Resume</span><input type="file"><span>Attach</span></div>
        <section><h3>Voluntary self-identification</h3>
          <p>${'We’re an equal opportunity employer, and answering is up to you. '.repeat(20)}</p>
          <div class="field"><p>Will you need a visa?</p>
            <label><input type="radio" name="visa" value="yes"> Yes</label>
            <label><input type="radio" name="visa" value="no"> No</label></div>
          <div class="field"><span>How did you hear about us?</span>
            <button type="button" aria-haspopup="listbox">Select…</button></div></section>
        <button type="submit">Submit application</button>
      </div></main></body></html>`);
    const job = readJobPage(careers, 'https://lumen.example/careers/data-lead', '');
    expect(job.source).toBe('main');
    expect(job.posting).toBe('Data Lead\n\nWhat you’ll do\n\nRun our data platform.');
    // A page that's all its form, its questions among its own words, has no posting there.
    const form =
      page(`<main><h1>Apply: Data Lead</h1><p>${'Tell us about yourself. '.repeat(30)}</p>
      <div><span>First name</span><input></div><div><span>Email</span><input type="email"></div>
      <p>Attach your resume.</p><div><input type="file"></div></main>`);
    expect(readJobPage(form, 'https://lumen.example/careers/data-lead/apply', '')).toMatchObject<
      Partial<PageJob>
    >({ posting: '', source: 'page' });
  });

  it('keeps a posting whole beside a box or two that aren’t an application', () => {
    const about = 'Pull great shots for our regulars every morning, and keep the bar spotless. ';
    const at = 'https://bean.example/jobs/barista';
    // A menu's box to tick, on a page with no main part.
    const menu = page(`<body><div class="page"><div class="top"><input type="checkbox" id="menu">
      <label for="menu">Menu</label></div><h1>Barista</h1><p>${about.repeat(4)}</p></div></body>`);
    expect(readJobPage(menu, at, '').posting).toBe(`Menu\n\nBarista\n\n${about.repeat(4).trim()}`);
    // A link to copy and a search box, beside a short posting.
    const shared = page(`<main><article><h1>Barista</h1><p>${about.repeat(4)}</p>
      <div class="share"><span>Copy its link</span><input readonly value="${at}"></div>
      <div class="search"><span>Search jobs</span><input type="search"></div></article></main>`);
    expect(readJobPage(shared, at, '').posting).toBe(
      `Barista\n\n${about.repeat(4).trim()}\n\nCopy its link\n\nSearch jobs`,
    );
    // Parts that open one at a time, each a radio button of one set.
    const parts = ['What you’ll do', 'What you’ll need']
      .map(
        (name, at) =>
          `<div class="part"><input type="radio" name="parts" id="part-${at}"><label for="part-${at}">${name}</label><div><p>${about}</p></div></div>`,
      )
      .join('');
    expect(readJobPage(page(`<main><h1>Barista</h1>${parts}</main>`), at, '').posting).toBe(
      `Barista\n\nWhat you’ll do\n\n${about.trim()}\n\nWhat you’ll need\n\n${about.trim()}`,
    );
    // A newsletter's form inside the posting.
    const newsletter = page(`<main><div class="posting"><h1>Barista</h1><p>${about}</p>
      <form><input name="first"><input name="last"><input type="email"><button>Sign up</button></form>
      </div></main>`);
    expect(readJobPage(newsletter, at, '').posting).toBe(`Barista\n\n${about.trim()}`);
  });

  it('reads no posting on a page of an application that runs over several', () => {
    const workday = readJobPage(
      page(
        readFileSync(
          join(import.meta.dirname, 'fixtures', 'workday-application-questions.html'),
          'utf8',
        ),
      ),
      'https://larkspur.wd1.myworkdayjobs.com/en-US/External/job/Austin/Senior-Product-Manager_R123/apply/applyManually',
      '',
    );
    expect(workday).toMatchObject<Partial<PageJob>>({ posting: '', source: 'page' });
    // iCIMS's, in its frame, which the popup reads for the job.
    const icims = readJobPage(
      page(readFileSync(join(import.meta.dirname, 'fixtures', 'icims-eeo.html'), 'utf8')),
      'https://careers-bramblecrest.icims.com/jobs/4821/robotics-software-engineer/candidate?in_iframe=1',
      '',
    );
    expect(icims.posting).toBe('');
    const stepped = page(`<main><ol><li aria-current="step">Your details</li><li>Questions</li></ol>
      <p>${'Our hiring team reads every application. '.repeat(40)}</p></main>`);
    expect(readJobPage(stepped, 'https://lumen.example/apply/2', '').posting).toBe('');
  });

  it('reads a page with thousands of boxes to tick quickly', () => {
    const boxes = Array.from(
      { length: 3000 },
      (_, at) => `<label><input type="checkbox" name="skills" value="${at}"> Skill ${at}</label>`,
    ).join('');
    const doc = page(`<main><h1>Data Lead</h1><p>Lead data.</p><div>${boxes}</div></main>`);
    const start = performance.now();
    expect(readJobPage(doc, 'https://lumen.example/careers/7', '').posting).toContain('Lead data.');
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('reads no application form as a job site’s posting, as Ashby’s is on its application’s tab', () => {
    // The form in the pane beside the job's title, where the posting's tab shows the posting.
    const tab = readFileSync(
      join(import.meta.dirname, 'fixtures', 'ashby-application.html'),
      'utf8',
    )
      .replace(
        '<main>',
        '<main><div class="ashby-job-posting-left-pane"><h1 class="ashby-job-posting-heading">Staff Engineer, Integrations</h1></div><div class="ashby-job-posting-right-pane">',
      )
      .replace('</main>', '</div></main>');
    const at =
      'https://jobs.ashbyhq.com/tidewater/1f2e3d4c-5b6a-4980-a1b2-c3d4e5f60718/application';
    // Its job data's posting, where it has one.
    const data = { ...JOB_DATA, title: 'Staff Engineer, Integrations' };
    const withPosting = tab.replace(
      '</head>',
      `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script></head>`,
    );
    expect(readJobPage(page(withPosting), at, '')).toMatchObject<Partial<PageJob>>({
      source: 'structured',
      posting: 'Lead our data platform.\n\nWhat you’ll do\n\n- Own the roadmap\n- Ship weekly',
    });
    // Or else the page's main text, without the form.
    const job = readJobPage(page(tab), at, '');
    expect(job).toMatchObject<Partial<PageJob>>({
      source: 'main',
      posting: 'Staff Engineer, Integrations',
    });
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
    // With no address to go by, the one the page shows.
    const unnamed = [
      { ...other, url: undefined },
      { ...mine, url: undefined },
    ];
    expect(readJobPage(withData(unnamed), 'https://a.example/jobs/1', '').title).toBe(
      'Senior Product Manager, Data',
    );
    // And none when it shows both, as a list of jobs does: it can't tell which is this page's.
    const both = withData(
      unnamed,
      '<main><h2>Data Engineer</h2><h2>Senior Product Manager, Data</h2></main>',
    );
    expect(readJobPage(both, 'https://a.example/jobs', '').source).toBe('main');
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

  it('leaves out job data whose title the page doesn’t show word for word', () => {
    const read = (title: string, heading: string) =>
      readJobPage(
        withData({ ...JOB_DATA, title }, `<main><h1>${heading}</h1><p>Posting.</p></main>`),
        'https://jobs.example.com/jobs/2',
        '',
      );
    const stale = read('Product Designer', 'Data Engineer');
    expect(stale.source).toBe('main');
    expect(stale.title).toBe('Data Engineer');
    // Even another way of putting it, which the popup shows to check, from the page's own text.
    expect(read('Sr. Software Engineer', 'Senior Software Engineer').source).toBe('main');
    expect(read('Software Engineer', 'Software Engineer (Remote)').source).toBe('main');
    // Its case and punctuation are its own.
    expect(read('Software engineer – Payments', 'SOFTWARE ENGINEER, PAYMENTS').source).toBe(
      'structured',
    );
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

  it('never takes another job’s data from a similar title, a link to it, or words in the text', () => {
    const read = (data: unknown, body: string, url = 'https://jobs.example.com/jobs/2-pm') =>
      readJobPage(withData(data, body), url, '');
    // A similar job's link, beside this job's own heading.
    const similar = '<main><h1>Product Manager</h1><a href="/jobs/1">Data Engineer</a></main>';
    expect(read({ ...JOB_DATA, title: 'Data Engineer' }, similar).source).toBe('main');
    // Its words inside other words, or across a sentence.
    const words = '<main><h1>Senior Data Scientist</h1><p>Join our software engineers.</p></main>';
    expect(read({ ...JOB_DATA, title: 'Software Engineer' }, words).source).toBe('main');
    // A heading in a list of other jobs further down this one's page.
    const list =
      '<main><h1>Product Manager</h1><h2>About the role</h2><h2>What you’ll do</h2><section><h3>Data Engineer</h3></section></main>';
    expect(read({ ...JOB_DATA, title: 'Data Engineer' }, list).source).toBe('main');
    expect(read({ ...JOB_DATA, title: 'Product Manager' }, list).source).toBe('structured');
    // A title with no words in it at all.
    expect(read({ ...JOB_DATA, title: '🚀' }, '<main><h1>🚀</h1></main>').source).toBe('main');
    // A job site's own title for a job much like it.
    const workday = withData(
      {
        ...JOB_DATA,
        title: 'Registered Nurse - ICU',
        url: 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Registered-Nurse---ICU_R100',
      },
      `<h2 data-automation-id="jobPostingHeader">Registered Nurse - Emergency Department</h2>
       <div data-automation-id="jobPostingDescription"><p>Care for patients.</p></div>`,
    );
    const nurse = readJobPage(
      workday,
      'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Registered-Nurse---Emergency_R200',
      '',
    );
    expect(nurse).toMatchObject<Partial<PageJob>>({
      title: 'Registered Nurse - Emergency Department',
      source: 'page',
      posting: 'Care for patients.',
    });
  });

  it('never takes an address that names no page, or no job, as this page’s', () => {
    const page = 'https://careers.acme.example/jobs/2-product-manager';
    const body = '<main><h1>Product Manager</h1></main>';
    for (const url of ['', '#', '?', 'https://careers.acme.example/careers']) {
      const doc = withData({ ...JOB_DATA, title: 'Data Engineer', url }, body);
      expect(readJobPage(doc, page, '').source, url).toBe('main');
    }
    // A page of several jobs, each at its own place on it.
    const anchored = withData(
      { ...JOB_DATA, title: 'Data Engineer', url: 'https://careers.acme.example/careers#job-1' },
      '<main><h1>Data Engineer</h1><h1>Product Manager</h1></main>',
    );
    expect(readJobPage(anchored, 'https://careers.acme.example/careers#job-2', '').source).toBe(
      'main',
    );
    // An address in a list is read by its first.
    const listed = withData(
      { ...JOB_DATA, title: 'Data Engineer', url: ['https://careers.acme.example/jobs/1'] },
      '<main><h1>Data Engineer</h1></main>',
    );
    expect(readJobPage(listed, page, '').source).toBe('main');
  });

  it('never takes job data by its title alone once a single-page site has moved on', () => {
    const doc = withData(
      { ...JOB_DATA, title: 'Data Engineer' },
      '<main><h1>Product Manager</h1><h2>Similar jobs</h2><h3>Data Engineer</h3></main>',
    );
    const now = 'https://careers.acme.example/jobs/2-product-manager';
    const before = 'https://careers.acme.example/jobs/1-data-engineer';
    expect(readJobPage(doc, now, '', before).source).toBe('main');
    // But the data whose own address is this page's, as such a site's would be.
    const own = withData(
      { ...JOB_DATA, title: 'Product Manager', url: now },
      '<main><h1>Product Manager</h1></main>',
    );
    expect(readJobPage(own, now, '', before).source).toBe('structured');
    // And a heading the page hides, such as the job it showed before, is no heading.
    const hidden = withData(
      { ...JOB_DATA, title: 'Data Engineer' },
      '<main><div hidden><h1>Data Engineer</h1></div><h1>Product Manager</h1></main>',
    );
    expect(readJobPage(hidden, now, '').source).toBe('main');
  });

  it('never steps through a URL’s own query, which Firefox’s sandbox for extensions can’t', () => {
    const proto = URLSearchParams.prototype as unknown as Record<string | symbol, unknown>;
    const names = ['keys', 'values', 'entries', 'forEach', Symbol.iterator] as const;
    const kept = names.map((name) => proto[name]);
    const refuse = () => {
      throw new TypeError('url.searchParams.keys() is not iterable');
    };
    for (const name of names) proto[name] = refuse;
    try {
      const job = readJobPage(
        withData({ ...JOB_DATA, url: 'https://jobs.example.com/job?id=2' }),
        'https://jobs.example.com/job?id=2&utm_source=x#apply',
        '',
      );
      expect(job).toMatchObject<Partial<PageJob>>({
        url: 'https://jobs.example.com/job?id=2',
        source: 'structured',
      });
      expect(
        readJobPage(page('<title>x</title>'), 'https://www.indeed.com/jobs?q=a&vjk=a1b2', '').url,
      ).toBe('https://www.indeed.com/viewjob?jk=a1b2');
    } finally {
      names.forEach((name, at) => {
        proto[name] = kept[at];
      });
    }
  });

  it('takes no job data whose own address leaves out a place on the page it moved to', () => {
    const data = (url: string) =>
      withData(
        { ...JOB_DATA, title: 'Data Engineer', url },
        '<main><h2>Open roles</h2><h3>Data Engineer</h3><h3>Product Manager</h3></main>',
      );
    for (const board of [
      'https://acme.example/hash-board?team=data',
      'https://acme.example/hash-board-7',
    ]) {
      expect(readJobPage(data(board), `${board}#job-2`, '', `${board}#job-1`).source, board).toBe(
        'main',
      );
      // Where it loaded, it's the page's own.
      expect(readJobPage(data(board), `${board}#job-1`, '', `${board}#job-1`).source, board).toBe(
        'structured',
      );
    }
  });

  it('takes no account of a link’s “#:~:text=”, which only highlights words', () => {
    const page = 'https://jobs.example.com/jobs/42-senior-pm';
    const job = readJobPage(withData(JOB_DATA), page, '', `${page}#:~:text=Senior`);
    expect(job.source).toBe('structured');
    expect(readJobPage(withData(JOB_DATA), `${page}#:~:text=Senior`, '').url).toBe(page);
  });

  it('counts moving to another place on the page, as “#job-2”, as moving on', () => {
    const doc = withData(
      { ...JOB_DATA, title: 'Data Engineer' },
      '<main><h2>Open roles</h2><h3>Data Engineer</h3><h3>Product Manager</h3></main>',
    );
    const careers = 'https://careers.acme.example/hash-careers';
    expect(readJobPage(doc, `${careers}#job-2`, '', `${careers}#job-1`).source).toBe('main');
    expect(readJobPage(doc, `${careers}#job-2`, '', careers).source).toBe('main');
  });

  it('reads a description full of things that nearly are tags quickly', () => {
    const start = performance.now();
    const doc = withData({ ...JOB_DATA, description: '&lt;a'.repeat(100_000) });
    readJobPage(doc, 'https://jobs.example.com/x', '');
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('takes the posting at this page’s address, though the page puts its title another way', () => {
    const mine = {
      ...JOB_DATA,
      title: 'Sr. Product Mgr - Remote US',
      url: 'https://jobs.example.com/jobs/7',
    };
    const other = { ...JOB_DATA, title: 'Data Engineer', url: undefined };
    const doc = withData(
      [other, mine],
      '<main><div class="title">Senior Product Manager</div><aside><h3>Data Engineer</h3></aside></main>',
    );
    expect(readJobPage(doc, 'https://jobs.example.com/jobs/7?utm_source=x', '').title).toBe(
      'Sr. Product Mgr - Remote US',
    );
  });

  it('reads a description that mentions tags beside its own markup', () => {
    const doc = withData({
      ...JOB_DATA,
      description:
        '<p>Know when to use &lt;br&gt;, &lt;textarea&gt; and &lt;select&gt;.</p><p>About the team.</p>',
    });
    expect(readJobPage(doc, 'https://jobs.example.com/fe', '').posting).toBe(
      'Know when to use <br>, <textarea> and <select>.\n\nAbout the team.',
    );
  });

  it('reads a description encoded twice with only line breaks and bold', () => {
    const doc = withData({
      ...JOB_DATA,
      description: '&lt;b&gt;Responsibilities&lt;/b&gt;&lt;br&gt;- Build things',
    });
    expect(readJobPage(doc, 'https://jobs.example.com/x', '').posting).toBe(
      'Responsibilities\n- Build things',
    );
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
    // The page lists both, beside the one it shows.
    const doc = withData(
      [one, two],
      '<main><h1>Senior Product Manager, Data</h1><aside>Data Engineer</aside></main>',
    );
    expect(readJobPage(doc, 'https://careers.example.com/#/jobs/2', '').title).toBe(
      'Senior Product Manager, Data',
    );
    expect(readJobPage(doc, 'https://careers.example.com/#/jobs/1', '').title).toBe(
      'Data Engineer',
    );
  });

  it('leaves out job data for another job, even at an address that differs only by its query', () => {
    const old = { ...JOB_DATA, title: 'Old Job', url: 'https://jobs.example.com/job?id=1' };
    const glassdoor = withData(
      { ...old, url: 'https://www.glassdoor.com/job-listing/x.htm?jl=1001' },
      `<div data-test="job-title">New Job</div>
       <div id="JobDescriptionContainer"><p>The new posting.</p></div>`,
    );
    const shown = readJobPage(glassdoor, 'https://www.glassdoor.com/job-listing/x.htm?jl=2002', '');
    expect(shown).toMatchObject<Partial<PageJob>>({ title: 'New Job', source: 'page', pay: '' });
    const elsewhere = withData(old, '<main><h1>New Job</h1><p>The new posting.</p></main>');
    expect(readJobPage(elsewhere, 'https://jobs.example.com/job?id=2', '').source).toBe('main');
  });

  it('tells two jobs with one title apart by their address’s query', () => {
    const place = (city: string) => [{ address: { addressLocality: city } }];
    const austin = { ...JOB_DATA, jobLocationType: undefined, jobLocation: place('Austin') };
    const boston = { ...JOB_DATA, jobLocationType: undefined, jobLocation: place('Boston') };
    const doc = withData([
      { ...austin, url: 'https://jobs.example.com/job?id=1&utm_source=x' },
      { ...boston, url: 'https://jobs.example.com/job?id=2' },
    ]);
    expect(readJobPage(doc, 'https://jobs.example.com/job?id=1', '').location).toBe('Austin');
    expect(readJobPage(doc, 'https://jobs.example.com/job?id=2&ref=feed', '').location).toBe(
      'Boston',
    );
  });

  it('checks job data against the page’s body, not its head, which a single-page site can leave', () => {
    const stale = page(`<html><head><title>Old Job | Acme</title>
      <meta property="og:title" content="Old Job">
      <script type="application/ld+json">${JSON.stringify({ ...JOB_DATA, title: 'Old Job' })}</script>
      </head><body><main><h1>New Job</h1><p>The new posting.</p></main></body></html>`);
    expect(readJobPage(stale, 'https://jobs.example.com/2', '').source).toBe('main');
    // A logo's heading first, and a tab's title with only the company's name, are fine.
    const logo = withData(
      JOB_DATA,
      '<header><h1>Acme</h1></header><main><h2>Senior Product Manager, Data</h2></main>',
    );
    expect(readJobPage(logo, 'https://jobs.example.com/2', '')).toMatchObject<Partial<PageJob>>({
      title: 'Senior Product Manager, Data',
      company: 'Tidewater Analytics',
      source: 'structured',
    });
  });

  it('keeps job data whose own address leaves out the page’s words, or isn’t one', () => {
    const canonical = { ...JOB_DATA, url: 'https://jobs.example.com/jobs/42' };
    const odd = { ...JOB_DATA, url: { href: 'x' } };
    for (const data of [canonical, odd]) {
      expect(
        readJobPage(withData(data), 'https://jobs.example.com/en-us/jobs/42-senior-pm', '').source,
      ).toBe('structured');
    }
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

  it('reads which job SmartRecruiters’ application is for, page by page, as its tab’s title says', () => {
    const at =
      'https://jobs.smartrecruiters.com/oneclick-ui/company/SaltmarshRobotics/publication/5a1c0de4-2b8f-4e7a-9d31-0c6e2f8b7a15';
    for (const [name, href] of [
      ['smartrecruiters-application', `${at}?dcr_ci=SaltmarshRobotics`],
      ['smartrecruiters-screening', `${at}/screening?dcr_ci=SaltmarshRobotics`],
    ] as const) {
      const job = readJobPage(
        page(readFileSync(join(import.meta.dirname, 'fixtures', `${name}.html`), 'utf8')),
        href,
        '',
      );
      expect(job).toMatchObject({
        title: 'Robotics Software Intern',
        company: 'Saltmarsh Robotics',
        location: 'Denver, CO, USA',
      });
    }
  });

  it('gives SuccessFactors’ application, at your session’s address, its posting’s own', () => {
    const job = readJobPage(
      page(
        readFileSync(
          join(import.meta.dirname, 'fixtures', 'successfactors-application.html'),
          'utf8',
        ),
      ),
      'https://career17.sapsf.com/portalcareer?_s.crb=sample',
      '',
    );
    expect(job).toMatchObject({
      url: 'https://career17.sapsf.com/sfcareer/jobreqcareer?jobId=1042&company=copperlineP',
      pageUrl: 'https://career17.sapsf.com/portalcareer?_s.crb=sample',
      title: 'Field Data Analyst',
    });
    expect(postingKey(job.url)).toBe('successfactors:copperlinep:1042');
  });

  it('reads which job iCIMS’s application is for, in its frame, from its tab’s title and its portal', () => {
    const job = readJobPage(
      page(readFileSync(join(import.meta.dirname, 'fixtures', 'icims-candidate.html'), 'utf8')),
      'https://careers-bramblecrest.icims.com/jobs/4821/robotics-software-engineer/candidate?from=login&in_iframe=1',
      '',
    );
    expect(job).toMatchObject({ title: 'Robotics Software Engineer', company: 'Bramblecrest' });
    expect(postingKey(job.url)).toBe('icims:careers-bramblecrest:4821');
  });

  it('reads which job Taleo’s application is for, from its banner and its site', () => {
    const job = readJobPage(
      page(readFileSync(join(import.meta.dirname, 'fixtures', 'taleo-personal.html'), 'utf8')),
      'https://bramblecote.taleo.net/careersection/careersection/candidateacquisition/flow.jsf',
      '',
    );
    expect(job).toMatchObject({ title: 'Fleet Data Analyst', company: 'Bramblecote' });
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
    // And beside an application form built without a form element.
    const form = '<div><input name="a"><input name="b"><input type="email"></div>';
    expect(
      alone(page(`<main><p>Lead data.</p>${form}</main>`), 'https://a.example/jobs/1', '').posting,
    ).toBe('Lead data.');
  });
});
