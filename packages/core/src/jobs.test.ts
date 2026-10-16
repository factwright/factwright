import { describe, expect, it } from 'vitest';
import { collectJobs } from './jobs.ts';
import { jobIdFor } from './new-job.ts';
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

const RESUME = {
  path: 'applications/acme/resume.pdf',
  name: 'resume.pdf',
  format: 'pdf' as const,
  size: 52_000,
  modified: '2026-10-07T15:00:00.000Z',
};

describe('collectJobs', () => {
  it('keeps every search run that found a job, once each, oldest first', () => {
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
    // The best-rated run is the one the job's score comes from.
    expect(job?.search).toMatchObject({ source: 'HN October 2026', score: 80 });
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

  it('takes a job’s kind from its fit check, or else the search that rated it highest', () => {
    const [found] = collectJobs([
      search('Acme Robotics', 'Program Manager', { key: 'a', score: 60, kind: 'developer' }),
      search('Acme Robotics', 'Program Manager', { key: 'b', score: 80, kind: 'project-manager' }),
      search('Acme Robotics', 'Program Manager', { key: 'c', score: 90 }),
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
          role: 'Senior Engineer',
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
