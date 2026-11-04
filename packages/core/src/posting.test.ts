import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  htmlToText,
  jobPostingData,
  jobPostingFields,
  namesOnePosting,
  onFeedSite,
  postingRequests,
  postingSource,
  readPosting,
} from './posting.ts';

/** How long something takes, in milliseconds. */
function timed(work: () => unknown): number {
  const start = Date.now();
  work();
  return Date.now() - start;
}

describe('htmlToText', () => {
  it('keeps paragraphs, lists and headings, and drops scripts and navigation', () => {
    const html = `<nav>Menu</nav><h2>About the role</h2><p>Build the tools&nbsp;our engineers use.</p>
      <ul><li>Own CI</li><li>Mentor &amp; review</li></ul><script>track()</script><p>Remote, US</p>`;
    expect(htmlToText(html)).toBe(
      '### About the role\nBuild the tools our engineers use.\n\n- Own CI\n- Mentor & review\n\nRemote, US',
    );
  });

  it('decodes named and numbered entities', () => {
    expect(decodeEntities('Don&#8217;t &ndash; &#x2014; &lt;b&gt;')).toBe('Don’t – — <b>');
  });
});

describe('postingSource', () => {
  it.each([
    [
      'https://boards.greenhouse.io/acme/jobs/4012345',
      { kind: 'greenhouse', boards: ['acme'], id: '4012345' },
    ],
    [
      'https://careers.acme.example/jobs?gh_jid=4012345',
      { kind: 'greenhouse', boards: ['careers', 'careersacme'], id: '4012345', guessed: true },
    ],
    // Greenhouse's boards in the EU answer on its one job API too.
    [
      'https://job-boards.eu.greenhouse.io/acme/jobs/4012345101',
      { kind: 'greenhouse', boards: ['acme'], id: '4012345101' },
    ],
    [
      'https://jobs.lever.co/acme/0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
      { kind: 'lever', company: 'acme', id: '0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d' },
    ],
    [
      'https://jobs.gem.com/acme/staff-engineer-42',
      { kind: 'gem', board: 'acme', id: 'staff-engineer-42' },
    ],
    [
      'https://jobs.ashbyhq.com/acme/0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
      { kind: 'ashby', board: 'acme', id: '0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d' },
    ],
    ['https://acme.example/jobs/staff', { kind: 'page', url: 'https://acme.example/jobs/staff' }],
  ])('reads %s', (address, source) => {
    expect(postingSource(address)).toEqual(source);
  });

  it('asks each applicant system’s public API, encoding every part', () => {
    expect(postingRequests({ kind: 'greenhouse', boards: ['acme', 'acme co'], id: '42' })).toEqual([
      { url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/42', json: true },
      { url: 'https://boards-api.greenhouse.io/v1/boards/acme%20co/jobs/42', json: true },
    ]);
    // An iCIMS posting's page is a frame that loads later, so its frame's own view is read.
    expect(
      postingRequests({ kind: 'page', url: 'https://careers-acme.icims.com/jobs/17/nurse/job' }),
    ).toEqual([
      { url: 'https://careers-acme.icims.com/jobs/17/nurse/job?in_iframe=1', json: false },
    ]);
    expect(
      postingRequests({
        kind: 'page',
        url: 'https://careers-acme.icims.com/jobs/17/nurse/job?mode=job&in_iframe=1',
      }),
    ).toEqual([
      { url: 'https://careers-acme.icims.com/jobs/17/nurse/job?mode=job&in_iframe=1', json: false },
    ]);
    expect(postingRequests({ kind: 'page', url: 'https://www.icims.com/jobs/' })).toEqual([
      { url: 'https://www.icims.com/jobs/?in_iframe=1', json: false },
    ]);
    expect(postingRequests({ kind: 'page', url: 'https://notreallyicims.com/jobs/1' })).toEqual([
      { url: 'https://notreallyicims.com/jobs/1', json: false },
    ]);
    expect(postingRequests({ kind: 'page', url: 'https://acme.example/jobs' })).toEqual([
      { url: 'https://acme.example/jobs', json: false },
    ]);
  });
});

describe('readPosting', () => {
  it('reads Greenhouse, whose content comes HTML-escaped', () => {
    const posting = readPosting(
      { kind: 'greenhouse', boards: ['acme'], id: '42' },
      {
        title: 'Staff Engineer',
        company_name: 'Acme Robotics',
        location: { name: 'Remote, US' },
        content: '&lt;p&gt;Build tools.&lt;/p&gt;',
      },
    );
    // With its title and employer apart, for Add job to fill in.
    expect(posting).toEqual({
      text: 'Staff Engineer\nRemote, US\n\nBuild tools.',
      via: 'Greenhouse API',
      title: 'Staff Engineer',
      company: 'Acme Robotics',
    });
  });

  it('reads Lever, with its lists', () => {
    const posting = readPosting(
      { kind: 'lever', company: 'acme', id: 'x' },
      {
        text: 'Staff Engineer',
        categories: { location: 'Denver' },
        description: '<p>Build tools.</p>',
        lists: [{ text: 'What you bring', content: '<li>Go</li>' }],
      },
    );
    expect(posting?.text).toBe('Staff Engineer\nDenver\n\nBuild tools.\n\n## What you bring\n- Go');
  });

  it('reads Ashby, finding the job on its board and its pay', () => {
    const answer = {
      jobs: [
        { id: 'other', title: 'Designer' },
        {
          id: 'job-1',
          title: 'Staff Engineer',
          location: 'Remote',
          compensation: { compensationTierSummary: '$185K – $215K' },
          descriptionPlain: 'Build tools.',
        },
      ],
    };
    expect(readPosting({ kind: 'ashby', board: 'acme', id: 'job-1' }, answer)).toEqual({
      text: 'Staff Engineer\nRemote\nCompensation: $185K – $215K\n\nBuild tools.',
      via: 'Ashby API',
      title: 'Staff Engineer',
    });
    expect(readPosting({ kind: 'ashby', board: 'acme', id: 'gone' }, answer)).toBeNull();
  });

  it('reads a page’s JobPosting data first, and its main text otherwise', () => {
    const data = `<html><script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Staff Engineer',
      hiringOrganization: { name: 'Acme Robotics' },
      jobLocationType: 'TELECOMMUTE',
      baseSalary: {
        currency: 'USD',
        value: { minValue: 185000, maxValue: 215000, unitText: 'YEAR' },
      },
      description: '&lt;p&gt;Build tools.&lt;/p&gt;',
    })}</script><body>Ignored</body></html>`;
    expect(readPosting({ kind: 'page', url: 'https://acme.example' }, data)).toEqual({
      text: 'Staff Engineer\nAcme Robotics\nRemote\nPay: 185000–215000 USD YEAR\n\nBuild tools.',
      via: 'the page’s JobPosting data',
      title: 'Staff Engineer',
      company: 'Acme Robotics',
    });
    const plain =
      '<html><body><header>Logo</header><main><h1>Staff Engineer</h1><p>Build tools.</p></main></body></html>';
    expect(readPosting({ kind: 'page', url: 'https://acme.example' }, plain)).toEqual({
      text: '## Staff Engineer\nBuild tools.',
      via: 'the web page',
    });
  });

  it('gives nothing back for an answer without a posting', () => {
    expect(readPosting({ kind: 'greenhouse', boards: [], id: '1' }, { title: 'x' })).toBeNull();
    expect(readPosting({ kind: 'page', url: 'https://acme.example' }, { not: 'html' })).toBeNull();
  });
});

describe('namesOnePosting', () => {
  it.each([
    'https://job-boards.greenhouse.io/gitlab/jobs/8638232002',
    'https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b',
    'https://jobs.smartrecruiters.com/AECOM2/744000156427409-senior-project-manager',
    'https://www.amazon.jobs/en/jobs/10577480/program-manager-ii-amz26173-4',
    'https://amazon.jobs/jobs/10595883',
    'https://careers-aptiveresources.icims.com/jobs/4751/payroll-and-benefits-administrator/job',
    'https://uhg.taleo.net/careersection/10000/jobdetail.ftl?job=2380443&lang=en',
    'https://jobs.acme.example/12345',
    'https://careers.acme.example/senior-engineer?utm_source=linkedin',
    'https://www.fredrin.example/careers/senior-software-engineer',
    'https://news.ycombinator.com/item?id=49927319',
    'https://careers.acme.example/jobs?gh_jid=4012345',
  ])('names one job: %s', (link) => {
    expect(namesOnePosting(link)).toBe(true);
  });

  it.each([
    'https://job-boards.greenhouse.io/gitlab',
    'https://jobs.lever.co/acme?team=Engineering',
    'https://jobs.ashbyhq.com/acme',
    'https://www.acme.example/en/careers',
    'https://careers.acme.example/',
    'https://www.acme.example/careers/open-positions',
    'https://www.acme.example/jobs?page=2',
    'https://www.acme.example/careers/search?q=engineer',
    'not a link',
  ])('names a list of jobs, or none: %s', (link) => {
    expect(namesOnePosting(link)).toBe(false);
  });
});

describe('a Taleo posting’s page', () => {
  const url = 'https://acme.taleo.net/careersection/10000/jobdetail.ftl?job=2380443&lang=en';
  /** A page as Taleo makes one: its menus, and the posting in a hidden field its script shows. */
  const page = (parts: string[]) =>
    `<html><body><nav>Work Here</nav><main><p>Our Culture</p><p>Hiring Process</p></main>
    <input type="hidden" name="initialHistory" id="initialHistory" value="${parts
      .map(encodeURIComponent)
      .join('!|!')}" /></body></html>`;

  it('reads the posting from the page’s data, not the menus around it', () => {
    const block = '!*!<p>Plan the work\\: every step.</p><ul><li>Lead teams</li></ul>';
    const posting = readPosting(
      { kind: 'page', url },
      page(['ftlx0', 'Submission for the position', 'Project Manager', '2380443', block, block]),
    );
    // Each block is there twice, and the colon comes escaped.
    expect(posting).toEqual({
      text: 'Project Manager\n\nPlan the work: every step.\n\n- Lead teams',
      via: 'Taleo',
      title: 'Project Manager',
    });
  });

  it('reads the field itself, whatever a script says of it first', () => {
    const block = '!*!<p>Plan the work.</p>';
    const html = page(['Project Manager', '2380443', block]).replace(
      '<input',
      '<script>document.querySelector(\'[name="initialHistory"]\')</script><input',
    );
    expect(readPosting({ kind: 'page', url }, html)?.text).toBe(
      'Project Manager\n\nPlan the work.',
    );
  });

  it('reads nothing from a posting’s page without the posting, unless it has job data', () => {
    expect(readPosting({ kind: 'page', url }, page(['ftlx0', 'true']))).toEqual({
      text: '',
      via: 'Taleo',
    });
    const data = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Project Manager',
      description: 'Plan the work.',
    })}</script>`;
    expect(readPosting({ kind: 'page', url }, page(['ftlx0']) + data)?.via).toBe(
      'the page’s JobPosting data',
    );
    const search = 'https://acme.taleo.net/careersection/10000/jobsearch.ftl';
    expect(readPosting({ kind: 'page', url: search }, page(['ftlx0']))?.via).toBe('the web page');
  });

  it('reads a page of input tags left open in a moment', () => {
    const start = Date.now();
    readPosting({ kind: 'page', url }, `<input name="initialHistory" ${'<input '.repeat(200_000)}`);
    readPosting({ kind: 'page', url }, `<p>${' name="initialHistory"'.repeat(200_000)}`);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('a Workday posting’s page', () => {
  const source = {
    kind: 'page',
    url: 'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/Nurse_R1',
  } as const;
  const script = (available: string) =>
    `<script>window.workday = { siteId: "Careers", postingAvailable: ${available}, }</script>`;

  it('reads the posting’s own page rather than its page for applying, which can say it’s closed', () => {
    const address = (url: string) => postingRequests({ kind: 'page', url })[0]?.url;
    const posting = 'https://acme.wd1.myworkdayjobs.com/Careers/job/Nurse_R1';
    expect(address(`${posting}/apply`)).toBe(posting);
    expect(address(`${posting}/apply/applyManually?source=x`)).toBe(`${posting}?source=x`);
    expect(address(posting)).toBe(posting);
    expect(
      address('https://wd5.myworkdaysite.com/recruiting/acme/Careers/job/Nurse_R1/apply'),
    ).toBe('https://wd5.myworkdaysite.com/recruiting/acme/Careers/job/Nurse_R1');
    expect(address('https://acme.example/jobs/1/apply')).toBe('https://acme.example/jobs/1/apply');
    // A title that only starts with the word stays, and a long link takes as long as it is long.
    expect(address(`${posting}/Apply-Today_R2`)).toBe(`${posting}/Apply-Today_R2`);
    const start = Date.now();
    expect(address(`${posting}${'/apply'.repeat(200_000)}`)).toBe(posting);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('says the posting has closed when the page says so', () => {
    expect(readPosting(source, script('false'))).toEqual({
      text: '',
      via: 'Workday',
      closed: true,
    });
  });

  it('reads an open one’s job data as any other page’s', () => {
    const data = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Registered Nurse',
      description: 'Care for patients.',
    })}</script>`;
    const read = readPosting(source, `${script('true')}${data}`);
    expect(read?.closed).toBeUndefined();
    expect(read?.text).toContain('Registered Nurse');
  });

  it('takes no such word from a page on any other site', () => {
    const elsewhere = { kind: 'page', url: 'https://acme.example/jobs/1' } as const;
    expect(
      readPosting(elsewhere, `<main>${script('false')}Still hiring</main>`)?.closed,
    ).toBeUndefined();
  });
});

describe('jobPostingData', () => {
  it('says when a posting went up and when it closes, without their times', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Registered Nurse',
      datePosted: '2026-07-24T04:00:00Z',
      validThrough: '2027-07-24',
      description: '<p>Care for patients.</p>',
    })}</script>`;
    expect(jobPostingData(html)).toBe(
      'Registered Nurse\nPosted: 2026-07-24\nCloses: 2027-07-24\n\nCare for patients.',
    );
  });

  it('keeps a date as the page writes it when it isn’t in the usual form', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Store Manager',
      datePosted: 'October 3, 2026',
      description: 'Run the store.',
    })}</script>`;
    expect(jobPostingData(html)).toBe('Store Manager\nPosted: October 3, 2026\n\nRun the store.');
  });

  it('finds a JobPosting inside a graph, and skips broken data', () => {
    const html = `<script type="application/ld+json">{ broken</script>
      <script type="application/ld&#x2B;json">${JSON.stringify({
        '@graph': [
          { '@type': 'Organization', name: 'Acme' },
          {
            '@type': ['JobPosting'],
            title: 'Staff Engineer',
            jobLocation: [{ address: { addressLocality: 'Denver', addressRegion: 'CO' } }],
            description: 'Build tools.',
          },
        ],
      })}</script>`;
    expect(jobPostingData(html)).toBe('Staff Engineer\nDenver, CO\n\nBuild tools.');
    expect(jobPostingData('<p>No data</p>')).toBeNull();
  });
});

describe('a page made to keep the app busy', () => {
  const page = { kind: 'page', url: 'https://acme.com/jobs/1' } as const;

  it('is read in a moment, however many tags it leaves open', () => {
    expect(timed(() => htmlToText('<nav'.repeat(40_000)))).toBeLessThan(1000);
    expect(timed(() => htmlToText('<li'.repeat(50_000)))).toBeLessThan(1000);
    expect(timed(() => htmlToText('<'.repeat(150_000)))).toBeLessThan(1000);
    expect(timed(() => readPosting(page, '<main'.repeat(30_000)))).toBeLessThan(1000);
    expect(timed(() => readPosting(page, '<body'.repeat(30_000)))).toBeLessThan(1000);
    expect(timed(() => jobPostingData('<script'.repeat(35_000)))).toBeLessThan(1000);
    expect(
      timed(() => jobPostingData(`<script ${'application/ld+json '.repeat(20_000)}`)),
    ).toBeLessThan(1000);
    expect(
      timed(() => jobPostingData('<script type="application/ld+json">'.repeat(40_000))),
    ).toBeLessThan(1000);
  });

  it('drops what it dropped before, and leaves an element nothing closes', () => {
    expect(
      htmlToText('<p>Build things</p><NAV>Menu</nav><SCRIPT>x()</script><p>Remote</p><form>Apply'),
    ).toBe('Build things\nRemote\nApply');
    expect(htmlToText('<p>a <> b <<i>c</i>> d</p>')).toBe('a <> b c> d');
    // A list item or heading tag runs to the next ">", whatever comes first.
    expect(htmlToText('<li<li>Item one</li>')).toBe('- Item one');
  });

  it('keeps the words after a list item or heading tag missing its ">"', () => {
    // The tag runs to the next ">", as a browser reads it, and the words after that stay.
    expect(htmlToText('<li</ul>Next paragraph<p>')).toBe('- Next paragraph');
    expect(htmlToText('<ul><li class="x"<b>Remote</b></li></ul>')).toBe('- Remote');
    expect(htmlToText('<h2<h3>Title</h3>')).toBe('### Title');
    expect(htmlToText('<h2 class="t"<span>Senior engineer</span></h2><p>Build things</p>')).toBe(
      '### Senior engineer\nBuild things',
    );
  });

  it('finds JSON-LD data however its script tag is written', () => {
    const data = '{"@type":"JobPosting","title":"Engineer","description":"Build things"}';
    expect(
      jobPostingData(`<script data-note="a<b" type="application/ld+json">${data}</script>`),
    ).toBe('Engineer\n\nBuild things');
  });

  it('reads a character number past the last one as "�", rather than failing', () => {
    expect(decodeEntities('a&#x110000;b&#99999999;c')).toBe('a�b�c');
  });
});

describe('reading a posting on Recruitee or Workable', () => {
  it('reads it from the system’s public feed, by the names in its link', () => {
    const recruitee = postingSource('https://bunq.recruitee.com/o/data-scientist-3?source=hn');
    expect(recruitee).toEqual({ kind: 'recruitee', board: 'bunq', id: 'data-scientist-3' });
    expect(postingRequests(recruitee)).toEqual([
      { url: 'https://bunq.recruitee.com/api/offers/data-scientist-3', json: true },
    ]);
    expect(
      readPosting(recruitee, {
        offer: {
          title: 'Data Scientist',
          location: 'Amsterdam',
          description: '<p>Build models.</p>',
          requirements: '<ul><li>Python</li></ul>',
        },
      }),
    ).toEqual({
      text: 'Data Scientist\nAmsterdam\n\nBuild models.\n\n- Python',
      via: 'Recruitee API',
      title: 'Data Scientist',
    });

    const workable = postingSource('https://apply.workable.com/seeq/j/1B6E0A1710/apply');
    expect(workable).toEqual({ kind: 'workable', board: 'seeq', id: '1B6E0A1710' });
    expect(postingRequests(workable)).toEqual([
      { url: 'https://apply.workable.com/api/v2/accounts/seeq/jobs/1B6E0A1710', json: true },
    ]);
    expect(
      readPosting(workable, {
        title: 'Staff Engineer',
        remote: true,
        location: { country: 'United States', city: null, region: null },
        description: '<p>Build things.</p>',
        requirements: '<p>Ten years.</p>',
        benefits: '<p>Dental.</p>',
      }),
    ).toEqual({
      text: 'Staff Engineer\nUnited States\nRemote\n\nBuild things.\n\nTen years.\n\nDental.',
      via: 'Workable API',
      title: 'Staff Engineer',
    });
  });

  it.each([
    'https://apply.workable.com/j/1B6E0A1710',
    'https://apply.workable.com/seeq',
    'https://bunq.recruitee.com/',
    'https://jobs.smartrecruiters.com/Sodexo/744000158662429',
    'https://eswt.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/24825',
    'https://a.b.recruitee.com.evil.example/o/nurse',
  ])('reads %s as a page, through no feed', (link) => {
    expect(postingSource(link).kind).toBe('page');
  });

  it('reads a Recruitee link by its language too', () => {
    expect(postingSource('https://bunq.recruitee.com/l/en/o/data-scientist-3')).toEqual({
      kind: 'recruitee',
      board: 'bunq',
      id: 'data-scientist-3',
    });
  });

  it('knows the feeds’ own sites', () => {
    for (const site of [
      'https://boards-api.greenhouse.io/x',
      'https://api.lever.co/x',
      'https://api.ashbyhq.com/x',
      'https://api.gem.com/x',
      'https://acme.recruitee.com/x',
      'https://apply.workable.com/x',
    ]) {
      expect(onFeedSite(site), site).toBe(true);
    }
    for (const site of ['https://evil.example/x', 'https://greenhouse.io.evil.example/x']) {
      expect(onFeedSite(site), site).toBe(false);
    }
  });

  it('takes a name that could change where its feed’s request goes as no feed at all', () => {
    for (const link of [
      'https://bunq.recruitee.com/o/..%2F..%2Fadmin',
      'https://bunq.recruitee.com/o/%E0%A4%A',
      'https://apply.workable.com/seeq/j/AB%2F..%2FCD',
      'https://apply.workable.com/..%2Fadmin/j/ABC',
    ]) {
      expect(postingSource(link).kind, link).toBe('page');
    }
  });

  it('finds nothing in an empty or hostile answer', () => {
    const recruitee = postingSource('https://bunq.recruitee.com/o/data-scientist-3');
    const workable = postingSource('https://apply.workable.com/seeq/j/ABC');
    for (const answer of [null, 'text', 42, [], {}, { offer: 'x' }, { offer: {} }]) {
      expect(readPosting(recruitee, answer)).toBeNull();
      expect(readPosting(workable, answer)).toBeNull();
    }
  });
});

describe('job data built to break a reader', () => {
  const page = (more: unknown) =>
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Nurse',
      description: 'Care for patients.',
      ...(more as object),
    })}</script>`;

  it.each([
    [{ baseSalary: { value: { minValue: { toString: 1 } } } }],
    [{ baseSalary: { value: { minValue: [[[]]], maxValue: { valueOf: 1 } } } }],
    [{ baseSalary: { value: { value: { toString: 1 } } } }],
    [{ baseSalary: 'a lot' }],
  ])('leaves out what isn’t an amount: %j', (more) => {
    const data = jobPostingFields(page(more));
    expect(data?.title).toBe('Nurse');
    expect(data?.pay ?? '').not.toContain('[object');
  });

  it('reads an amount as it should', () => {
    const value = { minValue: 40, maxValue: '50', unitText: 'HOUR' };
    expect(jobPostingFields(page({ baseSalary: { currency: 'USD', value } }))?.pay).toBe(
      '40–50 USD HOUR',
    );
    expect(
      jobPostingData(page({ baseSalary: { currency: 'USD', value: { value: 45 } } })),
    ).toContain('Pay: 45 USD');
  });

  it('spells out a title a site escaped twice', () => {
    expect(jobPostingFields(page({ title: 'Sales &amp; Service' }))?.title).toBe('Sales & Service');
  });
});

describe('a page whose job data is a teaser', () => {
  const page = (description: string, body: string) =>
    `<html><script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Nurse',
      description,
    })}</script><body><main>${body}</main></body></html>`;
  const source = { kind: 'page', url: 'https://www.usajobs.gov/job/1' } as const;

  it('gives the page’s text too, when that’s where the posting is', () => {
    const body = `<p>${'The duties of this job, at length. '.repeat(40)}</p>`;
    const read = readPosting(source, page('A short summary.', body));
    expect(read?.via).toBe('the page’s JobPosting data and its text');
    expect(read?.text).toContain('A short summary.');
    expect(read?.text).toContain('The duties of this job');
  });

  it('gives only the job data when that’s all there is, or it’s long', () => {
    expect(readPosting(source, page('A short summary.', ''))?.via).toBe(
      'the page’s JobPosting data',
    );
    const full = 'All the duties of this job, at length. '.repeat(60);
    const read = readPosting(source, page(full, '<p>Menus and other words.</p>'));
    expect(read?.via).toBe('the page’s JobPosting data');
    expect(read?.text).not.toContain('Menus');
  });
});
