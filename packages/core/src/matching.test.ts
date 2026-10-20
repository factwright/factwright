import { describe, expect, it } from 'vitest';
import {
  companyMatch,
  jobLikeness,
  otherPostings,
  postingKey,
  readTitle,
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
    const started = performance.now();
    expect(readTitle(`Senior${spaces}Engineer${'\t'.repeat(50_000)}x`).levels).toEqual(['senior']);
    expect(performance.now() - started).toBeLessThan(1000);
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
