import { describe, expect, it } from 'vitest';
import { NO_ROBOTS, readRobots, readSitemap, robotsAllow } from './sitemaps.ts';

describe('readRobots', () => {
  it('reads the rules for everyone, the sitemaps it names and how long to wait', () => {
    const robots = readRobots(
      [
        '# A comment',
        'Sitemap: https://acme.example/one.xml',
        'User-agent: Googlebot',
        'Disallow: /private-for-google/',
        '',
        'User-Agent: *',
        'Disallow: /private/ # with a comment',
        'Allow: /private/open/',
        'Crawl-delay: 5',
        '',
        'Sitemap: https://acme.example/two.xml',
      ].join('\r\n'),
    );
    expect(robots.sitemaps).toEqual([
      'https://acme.example/one.xml',
      'https://acme.example/two.xml',
    ]);
    expect(robots.crawlDelay).toBe(5);
    expect(robotsAllow(robots, '/private/page')).toBe(false);
    expect(robotsAllow(robots, '/private/open/page')).toBe(true);
    expect(robotsAllow(robots, '/private-for-google/')).toBe(true);
    expect(robotsAllow(robots, '/anything')).toBe(true);
  });

  it('takes a group naming Factwright over the one for everyone', () => {
    const robots = readRobots(
      ['User-agent: *', 'Allow: /', '', 'User-agent: FactWright', 'Disallow: /'].join('\n'),
    );
    expect(robotsAllow(robots, '/jobs/1')).toBe(false);
  });

  it('counts several User-agent lines as one group, and several groups for a name as one', () => {
    const robots = readRobots(
      [
        'User-agent: bingbot',
        'User-agent: *',
        'Disallow: /a',
        '',
        'User-agent: *',
        'Disallow: /b',
      ].join('\n'),
    );
    expect(robotsAllow(robots, '/a')).toBe(false);
    expect(robotsAllow(robots, '/b')).toBe(false);
    expect(robotsAllow(robots, '/c')).toBe(true);
  });

  it('turns software away where only named bots are let in, as GovernmentJobs does', () => {
    const robots = readRobots(
      ['User-agent: Googlebot', 'Allow: /', '', 'User-agent: *', 'Disallow: /'].join('\n'),
    );
    expect(robotsAllow(robots, '/jobs/1')).toBe(false);
  });

  it('asks nothing of a file that says nothing, or an empty Disallow', () => {
    for (const text of ['', '<html><body>Not found</body></html>', 'User-agent: *\nDisallow:']) {
      const robots = readRobots(text);
      expect(robotsAllow(robots, '/jobs/1'), text).toBe(true);
    }
    expect(robotsAllow(NO_ROBOTS, '/')).toBe(true);
    // Rules before any User-agent belong to nobody.
    expect(robotsAllow(readRobots('Disallow: /'), '/jobs/1')).toBe(true);
  });

  it('skips a Crawl-delay that isn’t a number', () => {
    expect(readRobots('User-agent: *\nCrawl-delay: soon').crawlDelay).toBeNull();
    expect(readRobots('User-agent: *\nCrawl-delay: -1').crawlDelay).toBeNull();
  });
});

describe('robotsAllow', () => {
  const rules = (...lines: string[]) => readRobots(['User-agent: *', ...lines].join('\n'));

  it.each([
    // Rule, path, whether it's barred.
    ['Disallow: */apply', '/us/en/job/1/apply', true],
    ['Disallow: */apply', '/us/en/job/1/applying', true],
    ['Disallow: /jobs/*login', '/jobs/12/login', true],
    ['Disallow: /jobs/*login', '/careers/login', false],
    ['Disallow: /*.pdf$', '/files/a.pdf', true],
    ['Disallow: /*.pdf$', '/files/a.pdf?x=1', false],
    ['Disallow: /exact$', '/exact', true],
    ['Disallow: /exact$', '/exact/more', false],
    ['Disallow: /a*b*c', '/a-b-c-d', true],
    ['Disallow: /a*b*c', '/a-c-b', false],
    ['Disallow: *$', '/anything', true],
  ])('%s, for %s', (rule, path, barred) => {
    expect(robotsAllow(rules(rule), path)).toBe(!barred);
  });

  it('goes by the longest rule, and between two as long, the one allowing it', () => {
    const robots = rules('Disallow: /', 'Allow: /careers', 'Disallow: /careers/secret');
    expect(robotsAllow(robots, '/other')).toBe(false);
    expect(robotsAllow(robots, '/careers/jobs')).toBe(true);
    expect(robotsAllow(robots, '/careers/secret/1')).toBe(false);
    expect(robotsAllow(rules('Disallow: /a', 'Allow: /a'), '/a')).toBe(true);
    expect(robotsAllow(rules('Allow: /a', 'Disallow: /a'), '/a')).toBe(true);
  });

  it('reads UKG’s and SuccessFactors’ rules as they mean them', () => {
    const successFactors = rules('Disallow: /', 'Disallow: /*company', 'Allow: /login');
    expect(robotsAllow(successFactors, '/career?company=acme')).toBe(false);
    const ukg = rules('Disallow: /', 'Allow: */JobBoard/', 'Disallow: */JobBoardView');
    expect(robotsAllow(ukg, '/ACME/JobBoard/1/')).toBe(true);
    expect(robotsAllow(ukg, '/ACME/JobBoardView/')).toBe(false);
  });

  it('reads rules built to take long as asking it to stay out, and leaves a huge link unread', () => {
    for (const hostile of [
      rules(...Array.from({ length: 301 }, (_, i) => `Disallow: /${i}`)),
      rules(...Array.from({ length: 10 }, (_, i) => `Allow: /${'*a'.repeat(150)}${i}`)),
      rules(`Allow: /${'a'.repeat(1_001)}`),
    ]) {
      expect(robotsAllow(hostile, '/jobs/1')).toBe(false);
    }
    expect(robotsAllow(NO_ROBOTS, `/${'a'.repeat(1_000)}`)).toBe(false);
  });

  it('takes no longer for the longest rules it follows', () => {
    const hostile = rules(
      ...Array.from({ length: 300 }, (_, i) => `Disallow: /${'*a'.repeat(3)}b${i}`),
    );
    expect(robotsAllow(hostile, '/jobs/1')).toBe(true);
    const started = Date.now();
    for (let i = 0; i < 50; i++) robotsAllow(hostile, `/${'a'.repeat(990)}`);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('readSitemap', () => {
  it('reads each link and the day it changed', () => {
    expect(
      readSitemap(
        `<?xml version='1.0'?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://acme.example/jobs/1?a=1&amp;b=2</loc><lastmod>2026-10-31T14:38:21-04:00</lastmod></url>
          <url>
            <loc>
              https://acme.example/jobs/2
            </loc>
          </url>
          <url><loc><![CDATA[https://acme.example/jobs/3]]></loc><lastmod>soon</lastmod></url>
          <url><loc></loc></url>
        </urlset>`,
      ),
    ).toEqual({
      index: false,
      links: [
        { link: 'https://acme.example/jobs/1?a=1&b=2', changed: '2026-10-31' },
        { link: 'https://acme.example/jobs/2', changed: null },
        { link: 'https://acme.example/jobs/3', changed: null },
      ],
    });
  });

  it('tells an index of sitemaps from a list of pages', () => {
    const index = readSitemap(
      '<sitemapindex><sitemap><loc>https://acme.example/jobs.xml</loc><lastmod>2026-11-01</lastmod></sitemap></sitemapindex>',
    );
    expect(index).toEqual({
      index: true,
      links: [{ link: 'https://acme.example/jobs.xml', changed: '2026-11-01' }],
    });
  });

  it('finds nothing in an answer that isn’t a sitemap, or stops short', () => {
    for (const xml of [
      '',
      '<html><body>Not found</body></html>',
      'just words',
      '<loc>never closed',
    ]) {
      expect(readSitemap(xml), xml).toEqual({ index: false, links: [] });
    }
    expect(readSitemap('<loc>https://a.example/1</loc><loc>https://a.example/2').links).toEqual([
      { link: 'https://a.example/1', changed: null },
    ]);
  });

  it('takes no longer for one built to take long, and stops at the most it keeps', () => {
    const unclosed = '<loc>'.repeat(2_000_000);
    const noClose = '<loc>a</loc><lastmod>'.repeat(500_000);
    const started = Date.now();
    expect(readSitemap(unclosed).links).toEqual([]);
    expect(readSitemap(noClose).links.length).toBe(100_000);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
