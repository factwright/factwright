import { describe, expect, it } from 'vitest';
import { hostOf, isJobLink, isLinkedIn, linksFrom, normalizeUrl } from './links.ts';

/** How long something takes, in milliseconds. */
function timed(work: () => unknown): number {
  const start = Date.now();
  work();
  return Date.now() - start;
}

describe('normalizeUrl', () => {
  it('drops www, trailing slashes and tracking parameters, and lowercases', () => {
    expect(normalizeUrl('https://www.Acme.com/Jobs/42/?utm_source=x&gh_src=y&team=Platform')).toBe(
      'acme.com/jobs/42?team=platform',
    );
  });

  it('drops LinkedIn’s tracking, which differs on every copy of a link to the same job', () => {
    expect(
      normalizeUrl(
        'https://www.linkedin.com/comm/jobs/view/4012345678/?refId=a1%3D%3D&trackingId=b2&lipi=c3&midToken=d4&midSig=e5&eBP=f6&trk=g7',
      ),
    ).toBe('linkedin.com/comm/jobs/view/4012345678');
  });

  it('lowercases text that isn’t a full address', () => {
    expect(normalizeUrl('Acme.com/Jobs')).toBe('acme.com/jobs');
  });

  it('keeps a careers site’s route to a job after “#/”, and drops any other “#”', () => {
    expect(normalizeUrl('https://careers.acme.example/?utm_source=x#/jobs/123/')).toBe(
      'careers.acme.example#/jobs/123',
    );
    expect(normalizeUrl('https://careers.acme.example/#/jobs/123')).not.toBe(
      normalizeUrl('https://careers.acme.example/#/jobs/456'),
    );
    expect(normalizeUrl('https://careers.acme.example/#!/job/7')).toBe(
      'careers.acme.example#!/job/7',
    );
    expect(normalizeUrl('https://acme.example/jobs/42#apply')).toBe('acme.example/jobs/42');
    expect(normalizeUrl('https://careers.acme.example/#/')).toBe('careers.acme.example');
    expect(normalizeUrl('https://careers.acme.example/#/jobs/42/?source=x&team=data')).toBe(
      'careers.acme.example#/jobs/42?team=data',
    );
    expect(normalizeUrl('https://careers.acme.example/#/jobs/42?utm_source=x')).toBe(
      normalizeUrl('https://careers.acme.example/#/jobs/42'),
    );
    expect(isJobLink('https://careers.acme.example/#/jobs/123')).toBe(true);
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

describe('links made to keep the app busy, or to pass for another site', () => {
  it('counts only Hacker News itself as Hacker News', () => {
    expect(isJobLink('https://news.ycombinator.com/item?id=45678901')).toBe(false);
    expect(isJobLink('https://news.ycombinator.com./item?id=45678901')).toBe(false);
    expect(isJobLink('https://news.ycombinator.com.example.com/jobs/acme/42')).toBe(true);
  });

  it('reads an address, or a field, in a moment, however many slashes, spaces or links', () => {
    expect(timed(() => isJobLink(`https://acme.com/${'/'.repeat(100_000)}a`))).toBeLessThan(1000);
    expect(
      timed(() => linksFrom(`${' '.repeat(100_000)}${'https://acme.com/jobs/1 '.repeat(5_000)}`)),
    ).toBeLessThan(1000);
    expect(timed(() => linksFrom(`${'\t'.repeat(50_000)}x`))).toBeLessThan(1000);
    expect(timed(() => linksFrom(`https://acme.com/${','.repeat(80_000)}a`))).toBeLessThan(1000);
  });

  it('splits a field as before, each separator taking the spaces around it', () => {
    expect(
      linksFrom('LinkedIn  ·  · Jobs https://acme.com/jobs/42 ;  Site: https://acme.com.'),
    ).toEqual([
      { url: 'https://acme.com/jobs/42', label: '· Jobs' },
      { url: 'https://acme.com', label: 'Site' },
    ]);
  });
});

describe('isLinkedIn', () => {
  it('knows LinkedIn’s sites, its short links and its files', () => {
    for (const url of [
      'https://www.linkedin.com/jobs/view/4012345678/',
      'https://linkedin.com/in/someone',
      'https://ca.linkedin.com/jobs',
      'https://lnkd.in/abc',
      'https://media.licdn.com/x.png',
      'https://WWW.LINKEDIN.COM./jobs',
    ]) {
      expect(isLinkedIn(url), url).toBe(true);
    }
  });

  it('leaves every other site, and anything that isn’t a link', () => {
    for (const url of [
      'https://notlinkedin.com/',
      'https://linkedin.com.evil.example/',
      'not a link',
    ]) {
      expect(isLinkedIn(url), url).toBe(false);
    }
  });
});
