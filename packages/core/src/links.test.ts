import { describe, expect, it } from 'vitest';
import { hostOf, isJobLink, linksFrom, normalizeUrl } from './links.ts';

describe('normalizeUrl', () => {
  it('drops www, trailing slashes and tracking parameters, and lowercases', () => {
    expect(normalizeUrl('https://www.Acme.com/Jobs/42/?utm_source=x&gh_src=y&team=Platform')).toBe(
      'acme.com/jobs/42?team=platform',
    );
  });

  it('lowercases text that isn’t a full address', () => {
    expect(normalizeUrl('Acme.com/Jobs')).toBe('acme.com/jobs');
  });
});

describe('isJobLink', () => {
  it.each([
    'https://jobs.ashbyhq.com/acme/1b2c3d4e',
    'https://boards.greenhouse.io/acme/jobs/123',
    'https://acme.com/careers?job=42',
  ])('treats %s as one job', (url) => {
    expect(isJobLink(url)).toBe(true);
  });

  it.each([
    'https://jobs.ashbyhq.com/acme',
    'https://acme.com/careers',
    'https://news.ycombinator.com/item?id=123',
    'https://www.linkedin.com/company/acme/jobs',
  ])('treats %s as a page that can list several jobs', (url) => {
    expect(isJobLink(url)).toBe(false);
  });
});

describe('hostOf', () => {
  it('gives the site without www', () => {
    expect(hostOf('https://www.acme.com/jobs')).toBe('acme.com');
    expect(hostOf('not a link')).toBe('not a link');
  });
});

describe('linksFrom', () => {
  it('labels each link with the words before it', () => {
    const field =
      'LinkedIn https://linkedin.com/jobs/view/1 · Ashby: https://jobs.ashbyhq.com/acme/9; https://acme.com/team';
    expect(linksFrom(field, 'Posting')).toEqual([
      { url: 'https://linkedin.com/jobs/view/1', label: 'LinkedIn' },
      { url: 'https://jobs.ashbyhq.com/acme/9', label: 'Ashby' },
      { url: 'https://acme.com/team', label: 'Posting' },
    ]);
  });

  it('falls back to the site name, and drops links cut short with an ellipsis', () => {
    expect(linksFrom('https://acme.com/jobs/1. Also https://jobs.lever.co/acme/12…')).toEqual([
      { url: 'https://acme.com/jobs/1', label: 'acme.com' },
    ]);
  });

  it.each([null, undefined, ''])('returns no links for %j', (field) => {
    expect(linksFrom(field)).toEqual([]);
  });
});
