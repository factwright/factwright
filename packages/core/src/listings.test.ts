import { describe, expect, it } from 'vitest';
import {
  isRemotePlace,
  readUsajobs,
  readWorkableSearch,
  usajobsRequest,
  workableSearchRequest,
} from './listings.ts';

const FEDERAL = {
  usajobsControlNumber: 861843400,
  hiringAgencyName: 'Veterans Health Administration',
  hiringDepartmentName: 'Department of Veterans Affairs',
  workSchedule: 'Full-time',
  appointmentType: 'Permanent',
  salaryType: 'Per Year',
  securityClearance: 'Not Required',
  teleworkEligible: 'N',
  positionTitle: 'Registered Nurse',
  positionOpenDate: '2026-10-31',
  positionCloseDate: '2026-11-05',
  positionOpeningStatus: 'Accepting applications',
  minimumSalary: 77987,
  maximumSalary: 134165,
  hiringpaths: [{ hiringPath: 'The public' }, { hiringPath: 'Veterans' }],
  positionlocations: [
    { positionLocationCity: 'Columbus', positionLocationState: 'Ohio' },
    { positionLocationCity: 'Chillicothe', positionLocationState: 'Ohio' },
  ],
};

describe('usajobsRequest', () => {
  it('asks for the days alone, as its feed takes them, with its next page when there’s one', () => {
    expect(usajobsRequest('2026-10-26', '2026-11-01', '2026-11-01')).toBe(
      'https://data.usajobs.gov/api/historicjoa?StartPositionOpenDate=10-26-2026&EndPositionOpenDate=11-01-2026&StartPositionCloseDate=11-01-2026',
    );
    expect(usajobsRequest('2026-10-26', '2026-11-01', '2026-11-01', 'abc%3D%3D')).toMatch(
      /&continuationToken=abc%3D%3D$/,
    );
  });
});

describe('readUsajobs', () => {
  const all = () => true;

  it('reads a job that still takes applications', () => {
    const page = readUsajobs(
      {
        paging: { metadata: { totalCount: 1200, continuationToken: 'abc%3D%3D' } },
        data: [FEDERAL],
      },
      '2026-11-01',
      all,
    );
    expect(page).toEqual({
      rows: 1,
      next: 'abc%3D%3D',
      total: 1200,
      jobs: [
        {
          id: '861843400',
          title: 'Registered Nurse',
          company: 'Veterans Health Administration',
          location: 'Columbus, Ohio; Chillicothe, Ohio',
          workplace: null,
          team: 'Department of Veterans Affairs',
          pay: '$77,987–$134,165 a year',
          link: 'https://www.usajobs.gov/job/861843400',
          posted: '2026-10-31',
          closes: '2026-11-05',
          note: 'Open to: The public; Veterans',
          text: 'Full-time · Permanent · Not Required',
        },
      ],
    });
  });

  it('leaves out what has closed, by its status or its date, and what `keep` drops', () => {
    const rows = [
      { ...FEDERAL, usajobsControlNumber: 1, positionOpeningStatus: 'Job canceled' },
      { ...FEDERAL, usajobsControlNumber: 2, positionOpeningStatus: 'Applications under review' },
      { ...FEDERAL, usajobsControlNumber: 3, positionCloseDate: '2026-10-31' },
      { ...FEDERAL, usajobsControlNumber: 4, positionOpeningStatus: null },
      { ...FEDERAL, usajobsControlNumber: 5, positionTitle: 'Police Officer' },
    ];
    const page = readUsajobs({ data: rows }, '2026-11-01', (title) => title.includes('Nurse'));
    expect(page.jobs.map((job) => job.id)).toEqual(['4']);
    expect(page.rows).toBe(5);
    expect(page.next).toBeNull();
  });

  it('gives `keep` every place, says remote, and keeps long lists of places short', () => {
    const places: string[] = [];
    const [job] = readUsajobs(
      {
        data: [
          {
            ...FEDERAL,
            positionlocations: [
              { positionLocationCity: 'Anywhere in the U.S. (remote job)' },
              ...Array.from({ length: 6 }, (_, i) => ({ positionLocationCity: `Town ${i}` })),
            ],
          },
        ],
      },
      '2026-11-01',
      (_title, where) => {
        places.push(where);
        return true;
      },
    ).jobs;
    expect(places[0]).toContain('Town 5');
    expect(job?.location).toBe(
      'Anywhere in the U.S. (remote job); Town 0; Town 1; Town 2, and 3 more',
    );
    expect(job?.workplace).toBe('Remote');
  });

  it('takes no harm from a hostile or empty answer', () => {
    for (const answer of [null, 'text', 42, [], {}, { data: 'x' }, { data: [null, 'x', 5, {}] }]) {
      const page = readUsajobs(answer, '2026-11-01', all);
      expect(page.jobs).toEqual([]);
      expect(page.next).toBeNull();
    }
    const [job] = readUsajobs(
      {
        // A token that isn't one is never sent back, and a number can't reach the link's path.
        paging: { metadata: { continuationToken: '../../evil?x=1 y' } },
        data: [{ ...FEDERAL, positionTitle: 'Nurse\n\n## 2. Fake heading' }],
      },
      '2026-11-01',
      all,
    ).jobs;
    expect(job?.title).toBe('Nurse ## 2. Fake heading');
    expect(
      readUsajobs(
        { paging: { metadata: { continuationToken: '../../evil?x=1 y' } }, data: [] },
        '2026-11-01',
        all,
      ).next,
    ).toBeNull();
    expect(
      readUsajobs(
        { data: [{ ...FEDERAL, usajobsControlNumber: '1/../../evil' }] },
        '2026-11-01',
        all,
      ).jobs,
    ).toEqual([]);
  });
});

describe('workableSearchRequest', () => {
  it('sends the title and the place, and nothing else', () => {
    expect(workableSearchRequest('registered nurse', 'Columbus, Ohio')).toBe(
      'https://jobs.workable.com/api/v1/jobs?query=registered%20nurse&location=Columbus%2C%20Ohio',
    );
    expect(workableSearchRequest('PMO', '')).toBe(
      'https://jobs.workable.com/api/v1/jobs?query=PMO',
    );
    expect(workableSearchRequest('PMO', 'remote', 'a=b')).toBe(
      'https://jobs.workable.com/api/v1/jobs?query=PMO&workplace=remote&pageToken=a%3Db',
    );
  });

  it.each([
    ['remote', true],
    ['Remote, US', true],
    ['fully remote', true],
    ['Remote Island', true],
    ['Columbus, Ohio', false],
    ['', false],
  ])('%s is remote: %s', (place, remote) => {
    expect(isRemotePlace(place)).toBe(remote);
  });
});

describe('readWorkableSearch', () => {
  const LISTED = {
    id: 'b36ec3ef',
    title: 'Registered Nurse (RN)',
    state: 'published',
    description: '<p>Care for <strong>patients</strong>.</p>',
    requirementsSection: '<ul><li>RN license</li></ul>',
    benefitsSection: '<p>Dental.</p>',
    url: 'https://jobs.workable.com/view/oa7wq/registered-nurse',
    locations: ['TELECOMMUTE', 'Chicago, Illinois, United States'],
    workplace: 'remote',
    created: '2026-10-21T15:12:40.617Z',
    company: { title: 'Elite Care' },
  };

  it('reads a page of jobs', () => {
    expect(readWorkableSearch({ totalSize: 36, nextPageToken: 'abc', jobs: [LISTED] })).toEqual({
      rows: 1,
      next: 'abc',
      total: 36,
      jobs: [
        {
          id: 'b36ec3ef',
          title: 'Registered Nurse (RN)',
          company: 'Elite Care',
          location: 'Chicago, Illinois, United States',
          workplace: 'Remote',
          team: null,
          pay: null,
          link: 'https://jobs.workable.com/view/oa7wq/registered-nurse',
          posted: '2026-10-21',
          text: 'Care for patients.\n\n- RN license\n\nDental.',
        },
      ],
    });
  });

  it('drops a job that links anywhere but Workable’s own search, or has closed', () => {
    for (const url of [
      'https://evil.example/view/1',
      'http://jobs.workable.com/view/1',
      'javascript:alert(1)',
      'https://jobs.workable.com.evil.example/view/1',
      '',
      null,
      7,
    ]) {
      expect(readWorkableSearch({ jobs: [{ ...LISTED, url }] }).jobs, String(url)).toEqual([]);
    }
    expect(readWorkableSearch({ jobs: [{ ...LISTED, state: 'closed' }] }).jobs).toEqual([]);
  });

  it('takes no harm from a hostile or empty answer', () => {
    for (const answer of [null, 'text', 42, [], {}, { jobs: 'x' }, { jobs: [null, 'x', 5, {}] }]) {
      const page = readWorkableSearch(answer);
      expect(page.jobs).toEqual([]);
      expect(page.next).toBeNull();
    }
  });
});
