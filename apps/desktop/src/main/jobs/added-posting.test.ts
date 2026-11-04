import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FetchAnswered } from '../tools/safe-fetch.ts';
import { testPages } from '../tools/test-pages.ts';
import { AddedPostings } from './added-posting.ts';

/** Real postings, saved as the app fetched them, which the tests read in the sites' place. */
const PAGES = join(import.meta.dirname, '../../../test/pages/pages.json');
const LEVER = 'https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b';

describe('what Add job reads from a job’s link', () => {
  it('says what it read, and keeps the posting for the job the link is added with', async () => {
    let now = new Date(2026, 10, 4, 9, 0);
    const postings = new AddedPostings({ fetch: testPages(PAGES), now: () => now });
    expect(await postings.read(` ${LEVER} `)).toEqual({
      ok: true,
      via: 'Lever API',
      characters: 4622,
      title: 'Account Executive - Commercial, Spotify Technology',
      company: null,
    });
    expect(postings.readFor(LEVER)?.text).toMatch(/^Account Executive - Commercial/);
    expect(postings.readFor(`${LEVER}/apply`)).toBeNull();
    expect(postings.readFor('not a link')).toBeNull();
    // Kept two hours, as Claude's reads are.
    now = new Date(2026, 10, 4, 11, 1);
    expect(postings.readFor(LEVER)).toBeNull();
  });

  it('forgets an earlier read of a link it can’t read now', async () => {
    let closed = false;
    const pages = testPages(PAGES);
    const postings = new AddedPostings({
      fetch: async (url, json, limitMs, maxBytes) => {
        if (closed) throw new FetchAnswered(new URL(url).hostname, 404);
        return pages(url, json, limitMs, maxBytes);
      },
    });
    expect(await postings.read(LEVER)).toMatchObject({ ok: true });
    closed = true;
    expect(await postings.read(LEVER)).toMatchObject({ ok: false, why: 'closed' });
    expect(postings.readFor(LEVER)).toBeNull();
  });

  it('keeps nothing for a link it couldn’t read', async () => {
    const postings = new AddedPostings({ fetch: testPages(PAGES) });
    const linkedIn = 'https://www.linkedin.com/jobs/view/4012345678/';
    expect(await postings.read(linkedIn)).toMatchObject({ ok: false, why: 'linkedin' });
    expect(postings.readFor(linkedIn)).toBeNull();
  });
});
