import { describe, expect, it } from 'vitest';
import {
  boardJobLine,
  boardMarkdown,
  boardPostingId,
  boardRequest,
  boardSource,
  readBoard,
  workablePostingId,
} from './boards.ts';

describe('boardSource', () => {
  it.each([
    ['https://boards.greenhouse.io/acme', { kind: 'greenhouse', board: 'acme' }],
    ['https://job-boards.greenhouse.io/acme/jobs/123', { kind: 'greenhouse', board: 'acme' }],
    [
      'https://boards.greenhouse.io/embed/job_board?for=acme',
      { kind: 'greenhouse', board: 'acme' },
    ],
    [
      'https://jobs.lever.co/acme/6f0c2e1a-9d4b-4c7e-8a35-2b9e7d10f4c6',
      { kind: 'lever', board: 'acme' },
    ],
    ['https://jobs.ashbyhq.com/Acme', { kind: 'ashby', board: 'Acme' }],
    ['https://jobs.gem.com/acme/4102938475', { kind: 'gem', board: 'acme' }],
    ['https://jobs.ashbyhq.com/Acme%20Labs', { kind: 'ashby', board: 'Acme Labs' }],
  ])('reads %s', (link, source) => {
    expect(boardSource(link)).toEqual(source);
  });

  it.each(['https://acme.example/careers', 'https://jobs.lever.co/', 'not a link'])(
    'finds no board in %s',
    (link) => {
      expect(boardSource(link)).toBeNull();
    },
  );
});

describe('boardPostingId', () => {
  it.each([
    ['https://job-boards.greenhouse.io/acme/jobs/4301928374', '4301928374'],
    ['https://boards.greenhouse.io/embed/job_app?for=acme&token=4301928374', '4301928374'],
    ['https://acme.greenhouse.io/careers?gh_jid=4301928374', '4301928374'],
    [
      'https://jobs.lever.co/acme/6f0c2e1a-9d4b-4c7e-8a35-2b9e7d10f4c6/apply',
      '6f0c2e1a-9d4b-4c7e-8a35-2b9e7d10f4c6',
    ],
    [
      'https://jobs.ashbyhq.com/acme/8d2f4b61-07ae-4f39-b5c2-e94a1c6d3f80/application',
      '8d2f4b61-07ae-4f39-b5c2-e94a1c6d3f80',
    ],
    ['https://jobs.gem.com/acme/4102938475', '4102938475'],
  ])('reads the posting in %s', (link, id) => {
    expect(boardPostingId(link)).toBe(id);
  });

  it.each([
    'https://jobs.lever.co/acme',
    'https://boards.greenhouse.io/acme',
    'https://acme.example/jobs/1',
  ])('finds no one posting in %s', (link) => {
    expect(boardPostingId(link)).toBeNull();
  });
});

describe('workablePostingId', () => {
  it.each([
    'https://apply.workable.com/seeq/j/1B6E0A1710/',
    'https://apply.workable.com/seeq/j/1B6E0A1710/apply/',
    'https://apply.workable.com/j/1B6E0A1710',
    'https://seeq.workable.com/j/1B6E0A1710?utm_source=hn',
  ])('reads the posting in %s', (link) => {
    expect(workablePostingId(link)).toBe('1B6E0A1710');
  });

  it.each([
    'https://apply.workable.com/seeq',
    'https://apply.workable.com/seeq/',
    'https://apply.workable.com/seeq/jobs',
    'https://acme.example/j/1B6E0A1710',
    'not a link',
  ])('finds no one posting in %s', (link) => {
    expect(workablePostingId(link)).toBeNull();
  });
});

describe('boardRequest', () => {
  it('asks each system for every open job, naming the board safely', () => {
    expect(boardRequest({ kind: 'greenhouse', board: 'acme' })).toBe(
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
    );
    expect(boardRequest({ kind: 'lever', board: 'acme' })).toBe(
      'https://api.lever.co/v0/postings/acme?mode=json',
    );
    expect(boardRequest({ kind: 'ashby', board: 'a/b?c' })).toBe(
      'https://api.ashbyhq.com/posting-api/job-board/a%2Fb%3Fc?includeCompensation=true',
    );
    expect(boardRequest({ kind: 'gem', board: 'acme' })).toBe(
      'https://api.gem.com/job_board/v0/acme/job_posts/',
    );
  });
});

describe('readBoard', () => {
  it('reads a Greenhouse board, whose content comes escaped', () => {
    const jobs = readBoard(
      { kind: 'greenhouse', board: 'acme' },
      {
        jobs: [
          {
            id: 4301928374,
            title: 'Staff Engineer',
            location: { name: 'Remote, US' },
            departments: [{ name: 'Platform' }],
            absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1',
            first_published: '2026-10-02T10:00:00-04:00',
            content: '&lt;p&gt;Build &amp;amp; run the platform.&lt;/p&gt;',
          },
          { title: 'No link' },
        ],
      },
    );
    expect(jobs).toEqual([
      {
        id: '4301928374',
        title: 'Staff Engineer',
        location: 'Remote, US',
        workplace: null,
        team: 'Platform',
        pay: null,
        link: 'https://job-boards.greenhouse.io/acme/jobs/1',
        posted: '2026-10-02',
        text: 'Build & run the platform.',
      },
    ]);
  });

  it('reads Lever, with its pay and remote setup', () => {
    const [job] = readBoard({ kind: 'lever', board: 'acme' }, [
      {
        text: 'Senior Engineer',
        categories: { location: 'Remote', team: 'Core' },
        workplaceType: 'remote',
        salaryRange: { min: 150000, max: 190000, currency: 'USD', interval: 'per-year-salary' },
        hostedUrl: 'https://jobs.lever.co/acme/1',
        createdAt: Date.UTC(2026, 9, 3),
        descriptionPlain: 'About the team.',
        lists: [{ text: 'You have', content: '<li>Go</li><li>Postgres</li>' }],
        additionalPlain: 'Benefits.',
      },
    ]);
    expect(job).toMatchObject({
      workplace: 'Remote',
      team: 'Core',
      pay: '$150,000–$190,000 a year salary',
      posted: '2026-10-03',
    });
    expect(job?.text).toBe('About the team.\n\n## You have\n- Go\n- Postgres\n\nBenefits.');
  });

  it('reads Ashby, skipping unlisted jobs, and Gem', () => {
    const ashby = readBoard(
      { kind: 'ashby', board: 'acme' },
      {
        jobs: [
          {
            title: 'Full-Stack Engineer',
            location: 'United States',
            isRemote: true,
            compensation: { compensationTierSummary: '$140K – $190K • Offers Equity' },
            jobUrl: 'https://jobs.ashbyhq.com/acme/1',
            publishedAt: '2026-09-14T15:00:00.000+00:00',
            descriptionPlain: 'Build the product.',
          },
          { title: 'Hidden', isListed: false, jobUrl: 'https://jobs.ashbyhq.com/acme/2' },
        ],
      },
    );
    expect(ashby).toHaveLength(1);
    expect(ashby[0]).toMatchObject({ workplace: 'Remote', pay: '$140K – $190K • Offers Equity' });
    const [gem] = readBoard({ kind: 'gem', board: 'acme' }, [
      {
        title: 'Product Engineer',
        location: { name: 'Toronto' },
        location_type: 'hybrid',
        absolute_url: 'https://jobs.gem.com/acme/1',
        first_published_at: '2026-09-20T10:00:00.000Z',
        content: '<p>Ship it.</p>',
        content_plain: 'Ship\nit.',
      },
    ]);
    expect(gem).toMatchObject({ workplace: 'Hybrid', posted: '2026-09-20', text: 'Ship it.' });
    expect(readBoard({ kind: 'gem', board: 'acme' }, { error: 'not found' })).toEqual([]);
  });
});

describe('boardMarkdown', () => {
  it('writes every job word for word, and lists each in a line', () => {
    const source = { kind: 'ashby', board: 'acme' } as const;
    const job = {
      id: '1',
      title: 'Engineer',
      location: 'Remote',
      workplace: null,
      team: null,
      pay: '$150K',
      link: 'https://jobs.ashbyhq.com/acme/1',
      posted: '2026-10-01',
      text: 'Build things.',
    };
    expect(boardMarkdown(source, [job], '2026-10-11')).toBe(
      [
        '# Ashby board: acme',
        '',
        '- **Source:** https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true',
        '- **Saved:** 2026-10-11 by Factwright, 1 open job, word for word',
        '',
        '## 1. Engineer',
        '',
        '- **Where:** Remote',
        '- **Pay:** $150K',
        '- **Posted:** 2026-10-01',
        '- **Link:** https://jobs.ashbyhq.com/acme/1',
        '',
        'Build things.',
        '',
      ].join('\n'),
    );
    expect(boardJobLine(job)).toBe(
      'Engineer · Remote · $150K · posted 2026-10-01 · https://jobs.ashbyhq.com/acme/1',
    );
    expect(boardJobLine({ ...job, workplace: 'Remote' })).toContain('Engineer · Remote · $150K');
    expect(boardJobLine({ ...job, location: 'Toronto', workplace: 'Hybrid' })).toContain(
      'Engineer · Toronto, Hybrid · $150K',
    );
  });
});
