import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  htmlToText,
  jobPostingData,
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
      { kind: 'greenhouse', boards: ['careers', 'careersacme'], id: '4012345' },
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
        location: { name: 'Remote, US' },
        content: '&lt;p&gt;Build tools.&lt;/p&gt;',
      },
    );
    expect(posting).toEqual({
      text: 'Staff Engineer\nRemote, US\n\nBuild tools.',
      via: 'Greenhouse API',
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

describe('jobPostingData', () => {
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
