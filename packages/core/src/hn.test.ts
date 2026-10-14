import { describe, expect, it } from 'vitest';
import { hiringThread, hnItemUrl, hnThreadMarkdown, readHnThread } from './hn.ts';

/** How long something takes, in milliseconds. */
function timed(work: () => unknown): number {
  const start = Date.now();
  work();
  return Date.now() - start;
}

const THREADS = {
  hits: [
    { objectID: '200', title: 'Ask HN: Who wants to be hired? (October 2026)' },
    { objectID: '201', title: 'Ask HN: Who is hiring? (October 2026)' },
    { objectID: '101', title: 'Ask HN: Who is hiring? (September 2026)' },
    { objectID: '1', title: 'Something else' },
  ],
};

describe('hiringThread', () => {
  it('finds the newest "Who is hiring?" thread, or a month’s', () => {
    expect(hiringThread(THREADS)).toEqual({
      id: '201',
      title: 'Ask HN: Who is hiring? (October 2026)',
      month: '2026-10',
    });
    expect(hiringThread(THREADS, '2026-09')).toMatchObject({ id: '101', month: '2026-09' });
    expect(hiringThread(THREADS, '2025-01')).toBeNull();
    expect(hiringThread({})).toBeNull();
  });

  it('asks Algolia for the thread by its ID', () => {
    expect(hnItemUrl('201')).toBe('https://hn.algolia.com/api/v1/items/201');
  });
});

describe('readHnThread', () => {
  it('reads each top-level post as text, with full links, leaving out deleted ones', () => {
    const thread = readHnThread({
      title: 'Ask HN: Who is hiring? (October 2026)',
      children: [
        {
          id: 301,
          created_at: '2026-10-01T16:00:00Z',
          text: 'Acme Robotics | Staff Engineer | Remote (US)<p>We build tools &amp; robots. Apply: <a href="https:&#x2F;&#x2F;acme.example&#x2F;jobs&#x2F;staff-engineer">https:&#x2F;&#x2F;acme.example&#x2F;jobs&#x2F;sta...</a>',
          children: [{ id: 302, text: 'A reply, not a post' }],
        },
        { id: 303, text: null },
        {
          id: 304,
          text: 'Tidewater | Backend | NYC<p>Email <a href="mailto:jobs@tidewater.example">us</a>',
        },
      ],
    });
    expect(thread?.posts).toEqual([
      {
        id: 301,
        header: 'Acme Robotics | Staff Engineer | Remote (US)',
        date: '2026-10-01',
        text: 'Acme Robotics | Staff Engineer | Remote (US)\n\nWe build tools & robots. Apply: https://acme.example/jobs/staff-engineer',
      },
      {
        id: 304,
        header: 'Tidewater | Backend | NYC',
        date: null,
        text: 'Tidewater | Backend | NYC\n\nEmail us (mailto:jobs@tidewater.example)',
      },
    ]);
    expect(readHnThread({ hits: [] })).toBeNull();
  });

  it('writes the thread as one file, each post under its first line', () => {
    const thread = { id: '201', title: 'Ask HN: Who is hiring? (October 2026)', month: '2026-10' };
    const post = {
      id: 301,
      header: 'Acme | Staff Engineer | Remote',
      date: '2026-10-01',
      text: 'Acme | Staff Engineer | Remote\n\nBuild robots.',
    };
    expect(hnThreadMarkdown(thread, [post], '2026-10-11')).toBe(
      [
        '# Ask HN: Who is hiring? (October 2026)',
        '',
        '- **Thread:** https://news.ycombinator.com/item?id=201',
        '- **Saved:** 2026-10-11 by Factwright, 1 job post, word for word',
        '',
        '## 1. Acme | Staff Engineer | Remote (hn 301)',
        '',
        '- **Post:** https://news.ycombinator.com/item?id=301 · 2026-10-01',
        '',
        'Build robots.',
        '',
      ].join('\n'),
    );
  });
});

describe('a post made to keep the app busy', () => {
  const post = (text: string) => readHnThread({ title: 't', children: [{ id: 1, text }] });

  it('is read in a moment, however many links it leaves open', () => {
    expect(timed(() => post('<a\t'.repeat(40_000)))).toBeLessThan(1000);
    expect(timed(() => post('<a href="https://acme.com">x'.repeat(30_000)))).toBeLessThan(1000);
    // Every "<a " here shares one ">", so each is read only up to it once.
    expect(timed(() => post(`${'<a '.repeat(50_000)}>x</a>`))).toBeLessThan(1000);
  });

  it('gives its links as before', () => {
    expect(
      post(
        'Acme <a href="https://acme.com/jobs">Jobs <a href="https://x.com">X</a>, ' +
          '<a name="top">top</a> and <a href="https://acme.com/a-very-long-path">https://acme.com/a-very…</a>',
      )?.posts[0]?.text,
    ).toBe('Acme Jobs X (https://acme.com/jobs), top and https://acme.com/a-very-long-path');
    // The address is the tag's last href="…", even after another attribute that mentions one.
    expect(post('<a title="href=" href="https://acme.com/">Acme</a>')?.posts[0]?.text).toBe(
      'Acme (https://acme.com/)',
    );
  });
});
