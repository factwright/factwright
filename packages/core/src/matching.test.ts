import { describe, expect, it } from 'vitest';
import {
  companyMatch,
  hasOwnPosting,
  jobLikeness,
  otherPostings,
  postingKey,
  readTitle,
  sameJob,
  savedJobFor,
  titleFit,
  titlesFit,
} from './matching.ts';

describe('postingKey', () => {
  it('reads the applicant system’s ID, whichever host or page the link is on', () => {
    expect(
      [
        'https://boards.greenhouse.io/acme/jobs/4012345',
        'https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=linkedin',
        'https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345',
        'https://acme.example/careers/open-roles?gh_jid=4012345',
      ].map(postingKey),
    ).toEqual(Array(4).fill('greenhouse:4012345'));
    expect(postingKey('https://jobs.lever.co/acme/5F2B-77/apply')).toBe('lever:5f2b-77');
    expect(postingKey('https://jobs.ashbyhq.com/acme/7f3a/application')).toBe('ashby:7f3a');
    expect(postingKey('https://acme.example/careers?ashby_jid=7F3A')).toBe('ashby:7f3a');
    expect(postingKey('https://jobs.gem.com/acme/am9i')).toBe('gem:acme:am9i');
  });

  it('reads a Workable posting’s shortcode, the same on its application and its short link', () => {
    expect(
      [
        'https://apply.workable.com/seeq/j/1B6E0A1710/',
        'https://apply.workable.com/seeq/j/1B6E0A1710/apply/',
        'https://apply.workable.com/j/1B6E0A1710',
      ].map(postingKey),
    ).toEqual(Array(3).fill('workable:1b6e0a1710'));
    expect(postingKey('https://apply.workable.com/seeq')).toBeNull();
  });

  it('reads LinkedIn’s and Indeed’s IDs, whatever the link says around them', () => {
    expect(
      [
        'https://www.linkedin.com/jobs/view/4012345678/?refId=a1&trackingId=b2',
        'https://uk.linkedin.com/jobs/view/senior-engineer-at-acme-4012345678',
        'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=engineer',
      ].map(postingKey),
    ).toEqual(Array(3).fill('linkedin:4012345678'));
    expect(postingKey('https://www.indeed.com/viewjob?jk=ab12cd34')).toBe('indeed:ab12cd34');
    expect(postingKey('https://ca.indeed.com/jobs?q=engineer&vjk=AB12CD34')).toBe(
      'indeed:ab12cd34',
    );
  });

  it('reads a Workday posting’s ID, the same on its application, at the company’s own site', () => {
    expect(
      [
        'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Denver-CO/Product-Manager_R101',
        'https://acme.wd5.myworkdayjobs.com/External/job/Denver-CO/Product-Manager_R101?source=LinkedIn',
        'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Denver-CO/Product-Manager_R101/apply/applyManually',
        'https://acme.wd1.myworkdayjobs.com/en-US/External/details/Product-Manager_R101',
        'https://wd5.myworkdaysite.com/en-US/recruiting/acme/External/job/Denver-CO/Product-Manager_R101/apply',
      ].map(postingKey),
    ).toEqual(Array(5).fill('workday:acme:r101'));
    // A place with "_" in it isn't the posting: its ID ends the part after it.
    expect(
      postingKey('https://acme.wd5.myworkdayjobs.com/External/job/US_CO_Denver/Engineer_JR-0042'),
    ).toBe('workday:acme:jr-0042');
    // Another company's site on Workday is another posting, whatever its ID.
    expect(
      postingKey('https://globex.wd5.myworkdayjobs.com/en-US/Careers/job/Austin/Engineer_R101'),
    ).toBe('workday:globex:r101');
    expect(
      [
        'https://acme.wd5.myworkdayjobs.com/en-US/External',
        'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Denver-CO/Product-Manager',
        'https://www.myworkday.com/acme/d/home.htmld',
      ].map(postingKey),
    ).toEqual([null, null, null]);
  });

  it('reads an iCIMS posting’s number, the same on its application, at the company’s own site', () => {
    expect(
      [
        'https://careers-acme.icims.com/jobs/1234/product-manager/job',
        'https://careers-acme.icims.com/jobs/1234/product-manager/job?mobile=false&width=1140&in_iframe=1',
        'https://careers-acme.icims.com/jobs/1234/product-manager/candidate?from=login',
        'https://careers-acme.icims.com/jobs/1234/login',
      ].map(postingKey),
    ).toEqual(Array(4).fill('icims:careers-acme:1234'));
    // Another company's site, or another of its own, is another posting.
    expect(postingKey('https://careers-globex.icims.com/jobs/1234/engineer/job')).toBe(
      'icims:careers-globex:1234',
    );
    expect(
      [
        'https://careers-acme.icims.com/jobs/search?ss=1',
        'https://careers-acme.icims.com/jobs/intro',
        'https://www.icims.com/jobs/1234/',
      ].map(postingKey),
    ).toEqual([null, null, null]);
  });

  it('reads a Taleo posting’s number, the same on its application, at the company’s own site', () => {
    expect(
      [
        'https://acme.taleo.net/careersection/2/jobdetail.ftl?job=2600123&lang=en',
        'https://acme.taleo.net/careersection/ext/jobapply.ftl?job=2600123&lang=en&src=CWS-1',
        'https://ACME.taleo.net/careersection/2/jobdetail.ftl?job=2600123',
      ].map(postingKey),
    ).toEqual(Array(3).fill('taleo:acme:2600123'));
    // A company's own site for its Taleo career section, and Taleo Business Edition's.
    expect(
      postingKey('https://talentacquisition.acme.example/careersection/ca/jobapply.ftl?job=A1B2'),
    ).toBe('taleo:talentacquisition.acme.example:a1b2');
    expect(
      [
        'https://phf.tbe.taleo.net/phf01/ats/careers/v2/viewRequisition?org=ACME&cws=1&rid=4321',
        'https://phf.tbe.taleo.net/phf01/ats/careers/v2/applyRequisition?org=acme&cws=1&rid=4321',
      ].map(postingKey),
    ).toEqual(Array(2).fill('taleo:acme:4321'));
    expect(
      [
        'https://acme.taleo.net/careersection/2/jobsearch.ftl?lang=en',
        'https://acme.taleo.net/careersection/careersection/candidateacquisition/flow.jsf',
      ].map(postingKey),
    ).toEqual([null, null]);
  });

  it('reads a SuccessFactors requisition, the same on its posting and its application', () => {
    expect(
      [
        'https://career4.successfactors.com/career?company=acmeP&career_ns=job_listing&career_job_req_id=1000',
        'https://career17.sapsf.com/careers?company=acmeP&career_ns=job_application&career_job_req_id=1000&lang=en_US',
        'https://career5.successfactors.eu/sfcareer/jobreqcareer?jobId=1000&company=acmeP',
        'https://career-sa20.hr.cloud.sap/careers?company=acmeP&career_job_req_id=1000',
      ].map(postingKey),
    ).toEqual(Array(4).fill('successfactors:acmep:1000'));
    // A signed-in application page names neither, and a company's own career site has its own IDs.
    expect(
      [
        'https://career17.sapsf.com/portalcareer?_s.crb=abc',
        'https://jobs.acme.example/job/Denver-Analyst/1400000123/',
      ].map(postingKey),
    ).toEqual([null, null]);
  });

  it('gives none for a whole board, or a site it doesn’t know', () => {
    expect(
      [
        'https://boards.greenhouse.io/acme',
        'https://jobs.lever.co/acme',
        'https://www.linkedin.com/company/acme/jobs/',
        'https://acme.example/careers/42',
        'https://news.ycombinator.com/item?id=4567',
        'not a link',
      ].map(postingKey),
    ).toEqual(Array(6).fill(null));
  });
});

describe('otherPostings', () => {
  it('tells two postings on the same site apart, and says nothing across sites', () => {
    expect(otherPostings(['greenhouse:1'], ['greenhouse:2'])).toBe(true);
    expect(otherPostings(['greenhouse:1', 'linkedin:9'], ['linkedin:9'])).toBe(false);
    expect(otherPostings(['greenhouse:1'], ['linkedin:9'])).toBe(false);
    expect(otherPostings([], ['greenhouse:2'])).toBe(false);
  });
});

describe('readTitle', () => {
  it('writes out short forms and keeps the level apart', () => {
    expect(readTitle('Sr. SWE (Remote, US)')).toEqual({
      levels: ['senior'],
      words: ['engineer', 'software', 'us'],
      heads: ['engineer', 'us'],
    });
    expect(readTitle('Eng Mgr, Payments')).toEqual({
      levels: [],
      words: ['engineering', 'manager', 'payment'],
      heads: ['manager', 'payment'],
    });
    expect(readTitle('Software Eng II')).toMatchObject({
      levels: ['2'],
      words: ['engineer', 'software'],
    });
    expect(readTitle('Full-Stack Developer (m/w/d)')).toEqual({
      levels: [],
      words: ['developer', 'fullstack'],
      heads: ['developer'],
    });
  });

  it('reads a long title in one pass', () => {
    const spaces = ' '.repeat(50_000);
    const started = Date.now();
    expect(readTitle(`Senior${spaces}Engineer${'\t'.repeat(50_000)}x`).levels).toEqual(['senior']);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(readTitle('Staff Engineer - Platform – Berlin').heads).toEqual([
      'berlin',
      'engineer',
      'platform',
    ]);
  });
});

describe('titleFit', () => {
  const fit = (a: string, b: string) => titleFit(readTitle(a), readTitle(b));

  it('finds the same role however it’s written', () => {
    expect(fit('Senior Software Engineer', 'Sr. Software Engineer')).toBe('same');
    expect(fit('Software Engineer, Senior', 'Senior Software Engineer (Remote)')).toBe('same');
    expect(fit('Director of Engineering', 'Engineering Director')).toBe('same');
    expect(fit('Front-End Developer II', 'Frontend Developer 2')).toBe('same');
    expect(fit('ML Engineer', 'Machine Learning Engineer')).toBe('same');
  });

  it('finds a title that says more about the same work', () => {
    expect(fit('Staff Engineer', 'Staff Software Engineer')).toBe('more');
    expect(fit('Senior Engineer, Platform', 'Senior Engineer')).toBe('more');
    // A team named for a kind of work is still a team.
    expect(fit('Staff Engineer', 'Staff Engineer, Developer Tools')).toBe('more');
  });

  it('tells apart another level, another specialty, and another kind of work', () => {
    expect(fit('Software Engineer', 'Senior Software Engineer')).toBe('different');
    expect(fit('Staff Engineer', 'Senior Staff Engineer')).toBe('different');
    expect(fit('Software Engineer II', 'Software Engineer III')).toBe('different');
    expect(fit('Engineering Manager', 'Senior Engineering Manager')).toBe('different');
    expect(fit('Software Engineer (Backend)', 'Software Engineer (Frontend)')).toBe('apart');
    expect(fit('Hardware Engineer', 'Software Engineer')).toBe('apart');
    expect(fit('Software Engineer', 'Software Engineering Manager')).toBe('apart');
    expect(fit('Product Designer', 'Product Designer, Researcher')).toBe('different');
  });
});

describe('titlesFit', () => {
  it('takes the same as any title a job goes by, but never more than one it’s apart from', () => {
    const titles = ['Software Engineer', 'Software Engineer, Platform'].map(readTitle);
    expect(titlesFit(titles, readTitle('Software Engineer, Platform'))).toBe('same');
    expect(titlesFit(titles, readTitle('Software Engineer, Platform Tools'))).toBe('more');
    expect(titlesFit(titles, readTitle('Software Engineer, Payments'))).toBe('different');
  });
});

describe('companyMatch', () => {
  const name = (company: string, companyKey: string) => ({ company, companyKey });

  it('finds a company written longer or shorter, but never by a word any company has', () => {
    expect(companyMatch(name('Acme', 'acme'), name('Acme Robotics', 'acme-robotics'))).toBe(
      'related',
    );
    expect(
      companyMatch(name('DeepMind', 'deepmind'), name('Google DeepMind', 'google-deepmind')),
    ).toBe('related');
    expect(companyMatch(name('AI', 'ai'), name('Scale AI', 'scale-ai'))).toBe('different');
    expect(companyMatch(name('Meta', 'meta'), name('Metabase', 'metabase'))).toBe('different');
    expect(companyMatch(name('Acme', 'acme'), name('Acme, Inc.', 'acme'))).toBe('same');
  });

  it('compares names with no key by the names themselves', () => {
    expect(companyMatch(name('株式会社メルカリ', ''), name('株式会社メルカリ ', ''))).toBe('same');
    expect(companyMatch(name('株式会社メルカリ', ''), name('メルカリ', ''))).toBe('different');
    expect(companyMatch(name('株式会社メルカリ', ''), name('Mercari', 'mercari'))).toBe(
      'different',
    );
  });
});

describe('jobLikeness', () => {
  const job = (company: string, companyKey: string, role: string, ...links: string[]) => ({
    company,
    companyKey,
    role,
    links: links.map((url) => ({ url })),
  });

  it('says how likely two jobs are one', () => {
    const acme = job(
      'Acme Robotics',
      'acme-robotics',
      'Staff Engineer',
      'https://jobs.lever.co/acme/1',
    );
    expect(
      jobLikeness(acme, job('Bluewave', 'bluewave', 'Engineer', 'https://jobs.lever.co/acme/1')),
    ).toBe('posting');
    expect(jobLikeness(acme, job('Acme', 'acme', 'Staff Engineer'))).toBe('role');
    expect(
      jobLikeness(acme, job('Acme Robotics', 'acme-robotics', 'Staff Software Engineer')),
    ).toBe('role');
    expect(jobLikeness(acme, job('Acme', 'acme', 'Staff Software Engineer'))).toBe('company');
    expect(
      jobLikeness(
        acme,
        job('Acme Robotics', 'acme-robotics', 'Staff Engineer', 'https://jobs.lever.co/acme/2'),
      ),
    ).toBe('company');
    expect(jobLikeness(acme, job('Lumen Health', 'lumen-health', 'Staff Engineer'))).toBeNull();
  });
});

describe('hasOwnPosting', () => {
  it('counts a link to one job, and not a board, a Hacker News post or a company’s site', () => {
    const links = (...urls: string[]) => ({ links: urls.map((url) => ({ url })) });
    expect(hasOwnPosting(links('https://apply.workable.com/seeq/j/1B6E0A1710/'))).toBe(true);
    expect(hasOwnPosting(links('https://www.linkedin.com/jobs/view/4012345678/'))).toBe(true);
    expect(hasOwnPosting(links('https://acme.example/careers/42'))).toBe(true);
    expect(
      hasOwnPosting(
        links(
          'https://apply.workable.com/seeq',
          'https://news.ycombinator.com/item?id=45678901',
          'https://seeq.com',
        ),
      ),
    ).toBe(false);
    expect(hasOwnPosting(links())).toBe(false);
  });
});

describe('savedJobFor', () => {
  const job = (id: string, company: string, role: string, ...links: string[]) => ({
    id,
    company,
    companyKey: '',
    role,
    links: links.map((url) => ({ url, label: 'Posting' })),
  });
  const page = (
    url: string,
    company = 'Seeq',
    role = 'AI Software Engineer - Staff/Principal',
  ) => ({
    url,
    company,
    role,
  });
  // Seeq's job as a Hacker News search found it: by its company's whole board, and the post.
  const found = job(
    'seeq--ai-software-engineer-staff-principal',
    'Seeq',
    'AI Software Engineer, Staff/Principal',
    'https://apply.workable.com/seeq',
    'https://news.ycombinator.com/item?id=45678901',
  );

  it('finds the job with the same posting, however its link is written, at any company', () => {
    const saved = job('acme--engineer', 'Acme', 'Engineer', 'https://jobs.lever.co/acme/5f2b-77');
    expect(
      savedJobFor([saved], page('https://jobs.lever.co/acme/5F2B-77/apply', 'Acme', 'Engineer')),
    ).toEqual({ job: saved, how: 'same' });
    expect(
      savedJobFor([saved], page('https://jobs.lever.co/acme/5f2b-77?lever-source=x', 'Other')),
    ).toEqual({ job: saved, how: 'same' });
  });

  it('takes a save from an application as the posting saved from the job’s own page', () => {
    const ashby = job(
      'acme--staff-engineer',
      'Acme',
      'Staff Engineer',
      'https://jobs.ashbyhq.com/acme/8d2f4b61-07ae-4f39-b5c2-e94a1c6d3f80',
    );
    const lever = job(
      'globex--designer',
      'Globex',
      'Designer',
      'https://jobs.lever.co/globex/6f0c2e1a-9d4b-4c7e-8a35-2b9e7d10f4c6',
    );
    expect(
      savedJobFor(
        [ashby, lever],
        page(
          'https://jobs.ashbyhq.com/acme/8d2f4b61-07ae-4f39-b5c2-e94a1c6d3f80/application',
          'Acme',
          'Staff Engineer',
        ),
      ),
    ).toEqual({ job: ashby, how: 'same' });
    expect(
      savedJobFor(
        [ashby, lever],
        page(
          'https://jobs.lever.co/globex/6f0c2e1a-9d4b-4c7e-8a35-2b9e7d10f4c6/apply',
          'Globex',
          'Designer',
        ),
      ),
    ).toEqual({ job: lever, how: 'same' });
  });

  it('joins the same role to a job with no posting of its own, as Seeq’s Hacker News find', () => {
    expect(savedJobFor([found], page('https://apply.workable.com/seeq/j/1B6E0A1710/'))).toEqual({
      job: found,
      how: 'joins',
    });
    // A page with no posting of its own joins a job that has one.
    const posted = job(
      'seeq--ai-software-engineer-staff-principal',
      'Seeq',
      'AI Software Engineer, Staff/Principal',
      'https://apply.workable.com/seeq/j/1B6E0A1710/',
    );
    expect(savedJobFor([posted], page('https://apply.workable.com/seeq'))).toEqual({
      job: posted,
      how: 'joins',
    });
  });

  it('takes the one job with the same role and another posting as the role, not to join', () => {
    const linkedIn = job(
      'acme--staff-engineer',
      'Acme',
      'Staff Engineer',
      'https://www.linkedin.com/jobs/view/4012345678/',
    );
    const greenhouse = page(
      'https://job-boards.greenhouse.io/acme/jobs/4012345',
      'Acme',
      'Staff Engineer',
    );
    expect(savedJobFor([linkedIn], greenhouse)).toEqual({ job: linkedIn, how: 'role' });
    // Two of them, it can't tell which.
    const other = job(
      'acme--staff-engineer-2',
      'Acme',
      'Staff Engineer',
      'https://acme.example/careers/42',
    );
    expect(savedJobFor([linkedIn, other], greenhouse)).toBeNull();
  });

  it('joins only the one job it can’t be mistaken for: the same company and title', () => {
    const post = page('https://news.ycombinator.com/item?id=45678901', 'Acme', 'Software Engineer');
    // Two that say more about the same work: either could be it, so neither is joined.
    const payments = job('acme--software-engineer-payments', 'Acme', 'Software Engineer, Payments');
    const platform = job('acme--software-engineer-platform', 'Acme', 'Software Engineer, Platform');
    expect(savedJobFor([payments, platform], post)).toBeNull();
    expect(savedJobFor([payments], post)).toEqual({ job: payments, how: 'role' });
    // A company whose name only holds the page's is another company to join.
    const apple = job('apple--software-engineer', 'Apple', 'Software Engineer');
    const greenhouse = page(
      'https://job-boards.greenhouse.io/alg/jobs/4012345',
      'Apple Leisure Group',
      'Software Engineer',
    );
    expect(savedJobFor([apple], greenhouse)).toEqual({ job: apple, how: 'role' });
    // Two the same: it can't tell which.
    const twin = { ...found, id: `${found.id}-2` };
    expect(
      savedJobFor([found, twin], page('https://apply.workable.com/seeq/j/1B6E0A1710/')),
    ).toBeNull();
  });

  it('finds none for another posting on the same site, another role, or another company', () => {
    const lever = job(
      'acme--staff-engineer',
      'Acme',
      'Staff Engineer',
      'https://jobs.lever.co/acme/5f2b-77',
    );
    expect(
      savedJobFor([lever], page('https://jobs.lever.co/acme/9d2e', 'Acme', 'Staff Engineer')),
    ).toBeNull();
    expect(
      savedJobFor(
        [found],
        page('https://apply.workable.com/seeq/j/0BEAE8BEA3/', 'Seeq', 'Analytics Engineer'),
      ),
    ).toBeNull();
    expect(
      savedJobFor([found], page('https://apply.workable.com/acme/j/1C2D3E4F50/', 'Acme')),
    ).toBeNull();
  });
});

describe('sameJob', () => {
  const job = (company: string, role: string, ...links: string[]) => ({
    company,
    companyKey: '',
    role,
    links: links.map((url) => ({ url, label: 'Posting' })),
  });
  // Seeq's job as a Hacker News search found it, by its company's board, and as the browser saved
  // it, from its own posting.
  const board = job(
    'Seeq',
    'AI Software Engineer, Staff/Principal',
    'https://apply.workable.com/seeq',
  );
  const posted = job(
    'Seeq',
    'AI Software Engineer - Staff/Principal',
    'https://apply.workable.com/seeq/j/1B6E0A1710/',
  );

  it('is sure of the same posting, at any company', () => {
    const other = job('Workable', 'AI Engineer', 'https://apply.workable.com/seeq/j/1B6E0A1710');
    expect(sameJob(posted, other)).toBe('posting');
  });

  it('is sure of the same role at the same company when one has no posting of its own', () => {
    expect(sameJob(board, posted)).toBe('role');
    expect(sameJob(posted, board)).toBe('role');
    expect(sameJob(job('Seeq', 'AI Software Engineer, Staff/Principal'), posted)).toBe('role');
  });

  it('leaves the rest to the user: two postings, a title saying more, a company written longer', () => {
    const another = job(
      'Seeq',
      'AI Software Engineer, Staff/Principal',
      'https://apply.workable.com/seeq/j/2C7F1B2821/',
    );
    expect(sameJob(posted, another)).toBeNull();
    expect(
      sameJob(board, job('Seeq', 'Staff AI Software Engineer, Analytics Platform')),
    ).toBeNull();
    expect(
      sameJob(board, job('Seeq Corporation Labs', 'AI Software Engineer, Staff/Principal')),
    ).toBeNull();
    expect(sameJob(board, job('Seeq', 'Product Manager'))).toBeNull();
    expect(sameJob(board, job('Acme', 'AI Software Engineer, Staff/Principal'))).toBeNull();
  });
});
