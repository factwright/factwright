import { describe, expect, it } from 'vitest';
import { collectJobs, type KnownJob } from './jobs.ts';
import { companyKey } from './keys.ts';
import { normalizeUrl } from './links.ts';
import { jobIdFor, shortCode } from './new-job.ts';
import type {
  FitCheckRecord,
  FolderRecord,
  OutreachRecord,
  SalaryRecord,
  SearchDetail,
  SearchRecord,
  ToolRecord,
  UnmaskRecord,
} from './records.ts';

const ASHBY = 'https://jobs.ashbyhq.com/acme/7f3a';

const NO_DETAIL: SearchDetail = {
  why: [],
  gaps: [],
  flags: [],
  pick: null,
  what: null,
  stage: null,
  apply: null,
  note: null,
  parts: {},
  partsWhy: {},
  tags: [],
  report: null,
};

function search(company: string, role: string, extra: Partial<SearchRecord> = {}): SearchRecord {
  return {
    tool: 'search',
    key: `2026-10-hn:${company}:${role}`,
    date: '2026-10-05',
    company,
    role,
    links: [],
    source: 'HN October 2026',
    folder: '2026-10-hn',
    run: 1,
    job: null,
    pay: null,
    location: null,
    tier: 'good',
    score: 70,
    kind: null,
    detail: NO_DETAIL,
    ...extra,
  };
}

function fitCheck(company: string, role: string, extra: Partial<FitCheckRecord> = {}) {
  const record: FitCheckRecord = {
    tool: 'fit-check',
    key: `2026-10-07:${company}:${role}`,
    date: '2026-10-07',
    company,
    role,
    links: [],
    verdict: 'Strong',
    score: 82,
    pay: null,
    note: null,
    ...extra,
  };
  return record;
}

function folder(company: string, role: string, extra: Partial<FolderRecord> = {}): FolderRecord {
  return {
    tool: 'folder',
    key: `2026-10-07-${company}`,
    folder: `2026-10-07-${company}`,
    date: '2026-10-07',
    company,
    role,
    links: [],
    pay: null,
    location: null,
    fit: null,
    foundVia: null,
    format: null,
    style: null,
    kind: null,
    files: [],
    letters: [],
    docs: {},
    ...extra,
  };
}

const salary = (company: string, role: string, estimate: string): SalaryRecord => ({
  tool: 'salary',
  key: `2026-10-09:${company}:${role}`,
  date: '2026-10-09',
  company,
  role,
  links: [],
  estimate,
  confidence: 'Medium',
});

const unmask = (company: string, role: string, listing: string): UnmaskRecord => ({
  tool: 'unmask',
  key: `2026-10-04:${company}:${role}`,
  date: '2026-10-04',
  company,
  role,
  links: [],
  listing,
  apply: null,
});

const outreach = (slug: string, company: string): OutreachRecord => ({
  tool: 'outreach',
  key: `2026-10-10-${slug}.md`,
  date: '2026-10-10',
  company,
  companySlug: slug,
  role: '',
  links: [],
});

/** Later runs of a search, a month on. */
const NOVEMBER = { folder: '2026-11-hn', source: 'HN November 2026', date: '2026-11-03' };
const LATER_NOVEMBER = {
  folder: '2026-11-20-linkedin',
  source: 'LinkedIn Nov 20',
  date: '2026-11-20',
};

const posting = (url: string) => ({ links: [{ url, label: 'Posting' }] });

const RESUME = {
  path: 'applications/acme/resume.pdf',
  name: 'resume.pdf',
  format: 'pdf' as const,
  size: 52_000,
  modified: '2026-10-07T15:00:00.000Z',
};

describe('collectJobs', () => {
  it('keeps every search run that found a job, once each, oldest first, and says the newest', () => {
    const later = { folder: '2026-11-hn', source: 'HN November 2026', date: '2026-11-03' };
    const [job] = collectJobs([
      search('Acme Robotics', 'Staff Engineer', { ...later, key: 'nov:acme', score: 60 }),
      search('Acme Robotics', 'Staff Engineer', { key: 'oct:acme', score: 80 }),
      search('Acme Robotics', 'Staff Engineer', { key: 'oct:acme-again', score: 75 }),
    ]);
    expect(job?.searches).toEqual([
      { folder: '2026-10-hn', source: 'HN October 2026', date: '2026-10-05' },
      later,
    ]);
    // The newest run is what's true of the job now, and it found the job again.
    expect(job?.search).toMatchObject({ source: 'HN November 2026', score: 60, again: true });
  });

  it('names a job at a company with no Latin letters by its link, as Add job does', () => {
    const link = 'https://example.jp/jobs/123';
    const [job] = collectJobs([
      search('株式会社テスト', 'エンジニア', { links: [{ url: link, label: 'Posting' }] }),
    ]);
    expect(job?.id).toBe(jobIdFor('株式会社テスト', 'エンジニア', shortCode(normalizeUrl(link))));
  });

  it('gives a job it finds the ID Add job and Save to Factwright would, cut to fit a folder', () => {
    const role =
      'Senior Software Engineer, Machine Learning Infrastructure - Distributed Training Platform';
    const [job] = collectJobs([search('Acme Robotics', role)]);
    expect(job?.id).toBe(jobIdFor('Acme Robotics', role));
    expect(job?.id.length).toBeLessThanOrEqual(142);
  });

  it('joins one job’s records across skills by its own link', () => {
    const posting = [{ url: ASHBY, label: 'Posting' }];
    const jobs = collectJobs([
      search('Acme Robotics', 'Staff Engineer, Developer Tools', { links: posting, score: 85 }),
      fitCheck('Acme Robotics, Inc.', 'Staff Engineer (Tools)', {
        links: posting,
        note: 'Build tooling',
      }),
      folder('Acme Robotics', 'Staff Engineer, Developer Tools', {
        links: [{ url: `${ASHBY}?utm_source=hn`, label: 'Ashby' }],
        files: [RESUME],
        pay: '$185k–$215k',
        location: 'Remote, US',
      }),
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'acme-robotics--staff-engineer-developer-tools',
      company: 'Acme Robotics',
      role: 'Staff Engineer, Developer Tools',
      link: ASHBY,
      links: posting,
      location: 'Remote, US',
      pay: { text: '$185k–$215k', min: 185_000, max: 215_000, source: 'listed' },
      source: 'HN October 2026',
      fit: { verdict: 'Strong', score: 82, date: '2026-10-07' },
      search: { tier: 'good', score: 85, source: 'HN October 2026' },
      searches: [{ folder: '2026-10-hn', source: 'HN October 2026', date: '2026-10-05' }],
      folder: '2026-10-07-Acme Robotics',
      stage: 'review',
      firstSeen: '2026-10-05',
      lastActivity: '2026-10-07',
      summary: 'Build tooling',
      files: [RESUME],
    });
    expect(jobs[0]?.events.map((event) => event.title)).toEqual([
      'Found in HN October 2026: Good 85',
      'Resume built',
      'Fit check: Strong 82',
    ]);
  });

  it('keeps a job’s cover letter apart from its resumes, dated by its file', () => {
    const letter = {
      ...RESUME,
      path: 'applications/2026-10-07-acme/AlexRiveraCoverLetter10142026_Acme.pdf',
      name: 'AlexRiveraCoverLetter10142026_Acme.pdf',
      modified: new Date(2026, 9, 14, 12).toISOString(),
    };
    const [job] = collectJobs([
      folder('Acme Robotics', 'Staff Engineer', { files: [RESUME], letters: [letter] }),
    ]);
    expect(job?.files).toEqual([RESUME]);
    expect(job?.letters).toEqual([letter]);
    expect(job?.events.map(({ title, date }) => [title, date])).toEqual([
      ['Resume built', '2026-10-07'],
      ['Cover letter written', '2026-10-14'],
    ]);
    // A letter copied in from elsewhere keeps its old date, but the job came first.
    const old = { ...letter, modified: new Date(2026, 8, 1, 12).toISOString() };
    const [copied] = collectJobs([folder('Acme Robotics', 'Staff Engineer', { letters: [old] })]);
    expect(copied?.events.find((event) => event.tool === 'letter')?.date).toBe('2026-10-07');
  });

  it('takes a job’s kind from its fit check, or else the newest search that gave one', () => {
    const [found] = collectJobs([
      search('Acme Robotics', 'Program Manager', { key: 'a', score: 90, kind: 'developer' }),
      search('Acme Robotics', 'Program Manager', {
        ...NOVEMBER,
        key: 'b',
        score: 60,
        kind: 'project-manager',
      }),
      search('Acme Robotics', 'Program Manager', { ...LATER_NOVEMBER, key: 'c', score: 70 }),
    ]);
    expect(found?.kindFound).toBe('project-manager');
    const [checked] = collectJobs([
      search('Acme Robotics', 'Program Manager', { kind: 'project-manager' }),
      folder('Acme Robotics', 'Program Manager', { kind: 'developer' }),
    ]);
    expect(checked?.kindFound).toBe('developer');
    expect(collectJobs([search('Acme Robotics', 'Program Manager')])[0]?.kindFound).toBeNull();
  });

  it('matches roles worded differently at the same company', () => {
    const jobs = collectJobs([
      search('Northwind Labs', 'Senior Software Engineer, Platform'),
      fitCheck('Northwind Labs', 'Senior Platform Software Engineer'),
      folder('Northwind Labs', 'Senior Software Engineer'),
    ]);
    expect(jobs.map((job) => job.id)).toEqual([
      'northwind-labs--senior-software-engineer-platform',
    ]);
    expect(jobs[0]?.stage).toBe('review');
  });

  it('takes a job out of New for any of Claude’s work, but not for finding it', () => {
    const stage = (...records: ToolRecord[]) => collectJobs(records)[0]?.stage;
    expect(stage(search('Acme Robotics', 'Staff Engineer'))).toBe('new');
    expect(
      stage(
        search('Acme Robotics', 'Staff Engineer'),
        salary('Acme Robotics', 'Staff Engineer', '$190k'),
      ),
    ).toBe('review');
    expect(stage(unmask('Acme Robotics', 'Staff Engineer', 'Bluewave Staffing'))).toBe('review');
    expect(stage(fitCheck('Acme Robotics', 'Staff Engineer'))).toBe('review');
  });

  it('keeps different roles at one company apart', () => {
    const jobs = collectJobs([
      search('Northwind Labs', 'Senior Software Engineer, Platform'),
      search('Northwind Labs', 'Engineering Manager, Payments'),
    ]);
    expect(jobs.map((job) => job.id)).toEqual([
      'northwind-labs--senior-software-engineer-platform',
      'northwind-labs--engineering-manager-payments',
    ]);
  });

  it('keeps the IDs of jobs it already knows', () => {
    const jobs = collectJobs(
      [fitCheck('Acme Robotics', 'Staff Engineer'), search('Lumen Health', 'Senior Engineer')],
      [
        {
          id: 'acme-1',
          company: 'Acme Robotics',
          companyKey: 'acme-robotics',
          role: 'Staff Engineer',
          links: [],
        },
        {
          id: 'lumen-health--senior-engineer',
          company: 'Lumen Health Partners',
          companyKey: 'lumen-health-partners',
          role: 'Engineering Manager',
          links: [],
        },
        {
          id: 'idle',
          company: 'Harbor & Pine',
          companyKey: 'harbor-and-pine',
          role: 'Engineer',
          links: [],
        },
      ],
    );
    // A known job with no records is left out, and a new job never takes a known job's ID.
    expect(jobs.map((job) => job.id)).toEqual(['acme-1', 'lumen-health--senior-engineer-2']);
  });

  it('uses a salary check’s estimate when no pay is listed', () => {
    const [job] = collectJobs([
      search('Copperleaf Energy', 'Principal Engineer'),
      salary('Copperleaf Energy', 'Principal Engineer', '$190k–$230k'),
    ]);
    expect(job?.pay).toEqual({
      text: '$190k–$230k',
      min: 190_000,
      max: 230_000,
      source: 'estimate',
    });
  });

  it('prefers listed pay that can be read', () => {
    const [job] = collectJobs([
      search('Copperleaf Energy', 'Principal Engineer', { pay: 'Competitive' }),
      fitCheck('Copperleaf Energy', 'Principal Engineer', { pay: '$200k-$240k' }),
    ]);
    expect(job?.pay).toMatchObject({ text: '$200k-$240k', source: 'listed' });
  });

  it('turns an unusual note about applying into apply steps', () => {
    const detail = {
      ...NO_DETAIL,
      apply: 'email jobs@copperleaf.example with the subject "Principal Engineer"',
    };
    const [job] = collectJobs([search('Copperleaf Energy', 'Principal Engineer', { detail })]);
    expect(job?.apply).toBe(
      [
        '- **Alert:** Email jobs@copperleaf.example with the subject "Principal Engineer"',
        '- **Email:** jobs@copperleaf.example',
        '- **Subject:** Principal Engineer',
        '',
        'From the job search (HN October 2026).',
      ].join('\n'),
    );
  });

  it('prefers the folder’s apply.md, and leaves ordinary notes alone', () => {
    const detail = { ...NO_DETAIL, apply: 'Apply on Ashby' };
    const [plain] = collectJobs([search('Acme Robotics', 'Staff Engineer', { detail })]);
    expect(plain?.apply).toBeNull();
    const [withSteps] = collectJobs([
      folder('Acme Robotics', 'Staff Engineer', { docs: { apply: '- **Alert:** Use the form' } }),
    ]);
    expect(withSteps?.apply).toBe('- **Alert:** Use the form');
  });

  it('reads the fit report and what people say from the folder', () => {
    const [job] = collectJobs([
      folder('Acme Robotics', 'Staff Engineer', {
        fit: 'Good, 74',
        docs: {
          fit: '- **Verdict:** Good, 74 · work 30/40\n',
          job: '- **Sentiment:** Liked, a calm team.',
        },
      }),
    ]);
    expect(job?.fit).toEqual({ verdict: 'Good', score: 74, date: '2026-10-07' });
    expect(job?.fitReport?.parts?.map((part) => part.key)).toEqual(['work']);
    expect(job?.sentiment).toMatchObject({
      from: 'job-notes',
      mood: 'liked',
      summary: 'A calm team.',
      date: '2026-10-07',
    });
  });

  it('joins drafted messages to every job at the company', () => {
    const jobs = collectJobs([
      search('Acme Robotics', 'Staff Engineer'),
      search('Acme Robotics', 'Engineering Manager'),
      outreach('acme-robotics', 'Acme Robotics'),
      outreach('ibm', 'IBM'),
    ]);
    expect(jobs.map((job) => [job.id, job.events.at(-1)?.title, job.stage])).toEqual([
      ['acme-robotics--staff-engineer', 'Drafted messages to people there', 'new'],
      ['acme-robotics--engineering-manager', 'Drafted messages to people there', 'new'],
      ['ibm--general', 'Drafted messages to people there', 'review'],
    ]);
    expect(jobs[0]?.events.at(-1)?.id).not.toBe(jobs[1]?.events.at(-1)?.id);
  });

  it('notes where a job turned up first', () => {
    const [job] = collectJobs([
      fitCheck('Tidewater Analytics', 'Senior Backend Engineer'),
      unmask('Tidewater Analytics', 'Senior Backend Engineer', 'Bluewave Staffing'),
    ]);
    expect(job?.source).toBe('Employer check');
    expect(job?.events.map((event) => event.title)).toEqual([
      'Found the real employer behind the Bluewave Staffing listing',
      'Fit check: Strong 82',
    ]);
  });
});

/** A job the tracker knows, at a company, with links to its posting. */
function known(
  id: string,
  company: string,
  role: string,
  links: string[] = [],
  extra: Partial<KnownJob> = {},
): KnownJob {
  const posted = links.map((url) => ({ url, label: 'Posting' }));
  return { id, company, companyKey: companyKey(company), role, links: posted, ...extra };
}

/** How many jobs some records make. */
const count = (...records: ToolRecord[]) => collectJobs(records).length;

describe('collectJobs, for a job found again', () => {
  it('joins the same posting at any company, however its name is written', () => {
    expect(
      count(
        search('Acme', 'Staff Engineer', posting(ASHBY)),
        fitCheck('Acme Robotics', 'Staff Engineer, Tools', posting(`${ASHBY}?utm_source=hn`)),
      ),
    ).toBe(1);
  });

  it('knows a posting by its ID, wherever its link points', () => {
    // Greenhouse's two hosts, and a company's own site with its board inside it.
    expect(
      count(
        search('Lakeside Data', 'Senior Platform Engineer', {
          ...posting('https://boards.greenhouse.io/lakeside/jobs/4012345'),
        }),
        search('Lakeside Data', 'Platform Engineer III', {
          ...NOVEMBER,
          ...posting('https://job-boards.greenhouse.io/lakeside/jobs/4012345?gh_src=x'),
        }),
        fitCheck(
          'Lakeside',
          'Platform',
          posting('https://lakeside.example/careers?gh_jid=4012345'),
        ),
      ),
    ).toBe(1);
    // LinkedIn's job page, with or without its title in the link, and its tracking.
    expect(
      count(
        search('Tidewater Analytics', 'Senior Backend Engineer', {
          ...posting('https://www.linkedin.com/jobs/view/4012345678/?refId=a1&trackingId=b2'),
        }),
        search('Tidewater', 'Backend Engineer', {
          ...NOVEMBER,
          ...posting('https://uk.linkedin.com/jobs/view/backend-engineer-at-tidewater-4012345678'),
        }),
      ),
    ).toBe(1);
    // The same link, with LinkedIn's tracking left on.
    expect(
      count(
        search('Tidewater Analytics', 'Senior Backend Engineer', {
          ...posting('https://www.linkedin.com/comm/jobs/view/4012345678?refId=a1&trackingId=b2'),
        }),
        search('Tidewater Analytics', 'Data Engineer', {
          ...NOVEMBER,
          ...posting('https://www.linkedin.com/comm/jobs/view/4012345678?refId=c3&trackingId=d4'),
        }),
      ),
    ).toBe(1);
  });

  it('joins a role written another way: short forms, word order, and a title that says more', () => {
    const jobs = collectJobs([
      search('Acme Robotics', 'Staff Engineer'),
      search('Acme Robotics', 'Staff Software Engineer', NOVEMBER),
      search('Northwind Labs', 'Sr. SWE (Remote)'),
      search('Northwind Labs', 'Senior Software Engineer', NOVEMBER),
      search('Harbor & Pine', 'Engineering Mgr, Payments'),
      search('Harbor and Pine', 'Payments Engineering Manager', NOVEMBER),
      search('Copperleaf Energy', 'Front-End Developer II'),
      search('Copperleaf Energy', 'Frontend Developer 2 (Hybrid)', NOVEMBER),
    ]);
    expect(jobs.map((job) => job.id)).toEqual([
      'acme-robotics--staff-engineer',
      'northwind-labs--sr-swe',
      'harbor-and-pine--engineering-mgr-payments',
      'copperleaf-energy--front-end-developer-ii',
    ]);
  });

  it('keeps apart roles at another level, in another specialty, or on another posting', () => {
    // Another level, however close the words.
    expect(
      count(
        search('Acme Robotics', 'Software Engineer'),
        search('Acme Robotics', 'Senior Software Engineer', NOVEMBER),
      ),
    ).toBe(2);
    expect(
      count(
        search('Acme Robotics', 'Software Engineer II'),
        search('Acme Robotics', 'Software Engineer III', NOVEMBER),
      ),
    ).toBe(2);
    // Another specialty, even in parentheses.
    expect(
      count(
        search('Acme Robotics', 'Software Engineer (Backend)'),
        search('Acme Robotics', 'Software Engineer (Frontend)', NOVEMBER),
      ),
    ).toBe(2);
    // Two postings on the same board, however alike their titles.
    expect(
      count(
        search(
          'Acme Robotics',
          'Software Engineer',
          posting('https://boards.greenhouse.io/acme/jobs/1'),
        ),
        search('Acme Robotics', 'Software Engineer', {
          ...NOVEMBER,
          ...posting('https://boards.greenhouse.io/acme/jobs/2'),
        }),
      ),
    ).toBe(2);
    expect(
      count(
        search('Acme Robotics', 'Senior Engineer', posting('https://jobs.lever.co/acme/a1')),
        search('Acme Robotics', 'Senior Engineer, Platform', {
          ...NOVEMBER,
          ...posting('https://jobs.lever.co/acme/b2'),
        }),
      ),
    ).toBe(2);
    // A title that says more joins only the one job it could be.
    expect(
      count(
        search('Acme Robotics', 'Software Engineer, Platform'),
        search('Acme Robotics', 'Software Engineer, Payments'),
        search('Acme Robotics', 'Software Engineer', NOVEMBER),
      ),
    ).toBe(3);
  });

  it('joins a company written longer or shorter only for the same role', () => {
    expect(
      count(search('Acme', 'Staff Engineer'), search('Acme Robotics', 'Staff Engineer', NOVEMBER)),
    ).toBe(1);
    expect(
      count(
        search('Acme', 'Staff Engineer'),
        search('Acme Robotics', 'Staff Engineer, Platform', NOVEMBER),
      ),
    ).toBe(2);
    // A word any company might have isn't the company.
    expect(
      count(search('Scale AI', 'Data Engineer'), search('AI', 'Data Engineer', NOVEMBER)),
    ).toBe(2);
  });

  it('files a find under the job find_job named, at the same company or with the same link', () => {
    const tidewater = 'tidewater-analytics--senior-backend-engineer';
    const jobs = collectJobs(
      [
        search('Tidewater', 'Data Platform Engineer', { ...NOVEMBER, job: tidewater }),
        // A job at another company, with no link in common, isn't the one it named.
        search('Lumen Health', 'Senior Engineer', { ...NOVEMBER, job: tidewater }),
        search('Bluewave Staffing', 'Backend Engineer', {
          ...NOVEMBER,
          ...posting('https://jobs.lever.co/tidewater/1'),
          job: tidewater,
        }),
      ],
      [
        known(tidewater, 'Tidewater Analytics', 'Senior Backend Engineer', [
          'https://jobs.lever.co/tidewater/1',
        ]),
      ],
    );
    expect(jobs.map((job) => [job.id, job.searches.length])).toEqual([
      [tidewater, 1],
      ['lumen-health--senior-engineer', 1],
    ]);
    expect(jobs[0]?.events).toHaveLength(2);
  });

  it('says what the newest search found: where, the pay, its notes, and that it’s found again', () => {
    const [job] = collectJobs([
      search('Acme Robotics', 'Staff Engineer', {
        pay: '$180k–$200k',
        location: 'Remote (US)',
        score: 85,
        detail: { ...NO_DETAIL, pick: 'Builds the tools' },
      }),
      search('Acme Robotics', 'Staff Engineer', {
        ...LATER_NOVEMBER,
        pay: '$190k–$220k',
        location: 'Hybrid, Denver',
        score: 72,
        detail: { ...NO_DETAIL, pick: 'Now hybrid' },
      }),
    ]);
    expect(job).toMatchObject({
      // Where it turned up first.
      source: 'HN October 2026',
      location: 'Hybrid, Denver',
      pay: { text: '$190k–$220k', source: 'listed' },
      summary: 'Now hybrid',
      search: { source: 'LinkedIn Nov 20', score: 72, again: true },
    });
    expect(job?.events.map((event) => event.title)).toEqual([
      'Found in HN October 2026: Good 85',
      'Found again in LinkedIn Nov 20: Good 72',
    ]);
  });

  it('says a search found a job again when it was on file from other work first', () => {
    const again = (...records: ToolRecord[]) => collectJobs(records)[0]?.search?.again;
    expect(
      again(
        fitCheck('Acme Robotics', 'Staff Engineer'),
        search('Acme Robotics', 'Staff Engineer', NOVEMBER),
      ),
    ).toBe(true);
    expect(
      again(search('Acme Robotics', 'Staff Engineer'), fitCheck('Acme Robotics', 'Staff Engineer')),
    ).toBe(false);
    // Messages drafted for its company join every job there, so they aren't the job.
    expect(
      again(
        outreach('acme-robotics', 'Acme Robotics'),
        search('Acme Robotics', 'Staff Engineer', NOVEMBER),
      ),
    ).toBe(false);
  });

  it('keeps each run of a search in the same folder, the later run newest', () => {
    const [job] = collectJobs([
      search('Acme Robotics', 'Staff Engineer', { key: 'one', score: 70 }),
      search('Acme Robotics', 'Staff Engineer', { key: 'two', run: 2, score: 78 }),
      search('Lumen Health', 'Senior Engineer', { key: 'three' }),
    ]);
    expect(job?.searches).toEqual([
      { folder: '2026-10-hn', source: 'HN October 2026', date: '2026-10-05' },
    ]);
    expect(job?.search).toMatchObject({ score: 78, again: true });
  });

  it('passes what a merged job went by on to the job it went into', () => {
    const kept = 'tidewater-analytics--senior-backend-engineer';
    const jobs = collectJobs(
      [
        search('Tidewater Analytics', 'Data Pipelines Engineer', NOVEMBER),
        search(
          'Tidewater Analytics',
          'Platform Engineer',
          posting('https://jobs.lever.co/tidewater/9'),
        ),
        search('Tidewater Analytics', 'Senior Backend Engineer'),
      ],
      [
        known(kept, 'Tidewater Analytics', 'Senior Backend Engineer'),
        known(
          'tidewater-analytics--data-pipelines-engineer',
          'Tidewater',
          'Data Pipelines Engineer',
          [],
          {
            mergedInto: 'tidewater-analytics--platform-engineer',
          },
        ),
        known(
          'tidewater-analytics--platform-engineer',
          'Tidewater',
          'Platform Engineer',
          ['https://jobs.lever.co/tidewater/9'],
          { mergedInto: kept },
        ),
      ],
    );
    expect(jobs.map((job) => [job.id, job.searches.length, job.events.length])).toEqual([
      [kept, 2, 3],
    ]);
    // With the job it went into gone, it's a job of its own again.
    const [alone] = collectJobs(
      [search('Tidewater Analytics', 'Data Pipelines Engineer')],
      [
        known(
          'tidewater-analytics--data-pipelines-engineer',
          'Tidewater',
          'Data Pipelines Engineer',
          [],
          { mergedInto: 'gone' },
        ),
      ],
    );
    expect(alone?.id).toBe('tidewater-analytics--data-pipelines-engineer');
  });
});
