// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

/** The site's folder. Paths, since jsdom's URL isn't one Node's file reading accepts. */
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Opens one of the site's pages in this test's document, without running its script. */
function open(page: string): Document {
  const parsed = new DOMParser().parseFromString(
    readFileSync(join(SITE, page), 'utf8'),
    'text/html',
  );
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
  return document;
}

/**
 * The installers, on the download site: the newest of each, under names that never change. The
 * download pages offer these, and the Worker points them at the newest version's own file.
 */
const DOWNLOADS = [
  'https://downloads.factwright.com/Factwright.dmg',
  'https://downloads.factwright.com/Factwright-Setup.exe',
];

/** The download pages: the one that picks, and one for each computer. */
const DOWNLOAD_PAGES = ['/download', '/download/mac', '/download/windows'];

/** The privacy policy and the terms, which every page's footer links to. */
const LEGAL_PAGES = ['/privacy', '/terms'];

/** The one address the privacy policy and terms give for questions. */
const CONTACT = 'mailto:privacy@factwright.com';

/** Anthropic's own terms and privacy policy, which the privacy policy and terms point to. */
const ANTHROPIC_LEGAL = [
  'https://www.anthropic.com/legal/privacy',
  'https://www.anthropic.com/legal/consumer-terms',
  'https://www.anthropic.com/legal/commercial-terms',
  'https://www.anthropic.com/legal/aup',
];

/** Where a download page says which version it offers, as the Worker's releaseLine fills it in. */
const releaseLine = (computer: string) => `<p class="get-meta" data-release="${computer}"></p>`;

/** Whether a file the page asks for, such as /templates/modern.webp, is in the site's public folder. */
const published = (path: string) => existsSync(join(SITE, 'public', path));

describe.each([
  'index.html',
  'download.html',
  'download/mac.html',
  'download/windows.html',
  'privacy.html',
  'terms.html',
  '404.html',
])('%s', (page) => {
  it('passes an accessibility check', async () => {
    const doc = open(page);
    // jsdom can't lay out a page, so contrast is checked from the tokens in @factwright/ui.
    const results = await axe.run(doc, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });

  it('has one main heading, and never skips a heading level', () => {
    const doc = open(page);
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    let level = 0;
    for (const heading of doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const next = Number(heading.tagName[1]);
      expect(next, heading.textContent ?? '').toBeLessThanOrEqual(level + 1);
      level = next;
    }
  });

  it('links only to its own sections, the site’s pages, the downloads and Anthropic’s terms', () => {
    const doc = open(page);
    const legal = LEGAL_PAGES.includes(`/${page.replace('.html', '')}`);
    const allowed = [
      '/',
      ...DOWNLOAD_PAGES,
      ...DOWNLOADS,
      ...LEGAL_PAGES,
      ...(legal ? [CONTACT, ...ANTHROPIC_LEGAL] : []),
    ];
    for (const link of doc.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('#')) expect(doc.getElementById(href.slice(1)), href).not.toBeNull();
      else expect(allowed).toContain(href);
    }
  });

  it('links to the privacy policy and the terms from its footer', () => {
    const footer = open(page).querySelector('footer');
    const hrefs = [...(footer?.querySelectorAll('a[href]') ?? [])].map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual(expect.arrayContaining(LEGAL_PAGES));
  });

  it('describes every picture, or hides it from screen readers', () => {
    const doc = open(page);
    for (const image of doc.querySelectorAll('img')) expect(image.hasAttribute('alt')).toBe(true);
    for (const svg of doc.querySelectorAll('svg')) {
      expect(svg.closest('[aria-hidden="true"]'), svg.outerHTML.slice(0, 80)).not.toBeNull();
    }
    for (const figure of doc.querySelectorAll('figure')) {
      expect(figure.querySelector('figcaption')?.textContent?.trim()).toBeTruthy();
    }
  });

  it('asks only for files the site publishes', () => {
    const doc = open(page);
    const paths = [
      ...[...doc.querySelectorAll('img[src], link[rel~="icon"], link[rel="apple-touch-icon"]')].map(
        (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
      ),
      ...[...doc.querySelectorAll('meta[property="og:image"]')].map((meta) =>
        new URL(meta.getAttribute('content') ?? '').pathname.toString(),
      ),
    ];
    for (const path of paths) expect(published(path), path).toBe(true);
  });

  it('says plainly that Factwright isn’t Anthropic’s', () => {
    const footer = open(page).querySelector('footer')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(footer).toContain('Factwright isn’t affiliated with Anthropic.');
    expect(footer).toContain('Claude and Claude Code are trademarks of Anthropic, PBC.');
  });
});

describe('the home page', () => {
  it('says whose Claude runs, and that runs count against its plan', () => {
    const footer = open('index.html').querySelector('footer')?.textContent?.replace(/\s+/g, ' ');
    expect(footer).toContain(
      'It uses your own Claude account, and its runs count against your plan.',
    );
  });

  it('shows the fact behind each resume line it offers', () => {
    const doc = open('index.html');
    const lines = [...doc.querySelectorAll<HTMLElement>('[data-fact]')];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(doc.querySelector(`[data-fact-card="${line.dataset.fact}"]`)).not.toBeNull();
    }
  });
});

describe('the download pages', () => {
  it('each start their computer’s download, with a link in case it doesn’t', () => {
    for (const [computer, installer] of [
      ['mac', DOWNLOADS[0]],
      ['windows', DOWNLOADS[1]],
    ] as const) {
      const doc = open(`download/${computer}.html`);
      expect(doc.querySelector(`main[data-get="${computer}"]`)).not.toBeNull();
      const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[data-direct]')];
      expect(links.map((link) => link.getAttribute('href'))).toEqual([installer]);
      expect(links[0]?.closest('.get-again')?.textContent).toContain('Didn’t start?');
    }
  });

  it('mark where the Worker says which version each offers', () => {
    const source = (page: string) => readFileSync(join(SITE, page), 'utf8');
    expect(source('download/mac.html')).toContain(releaseLine('mac'));
    expect(source('download/windows.html')).toContain(releaseLine('windows'));
    expect(source('download.html')).toContain(releaseLine('mac'));
    expect(source('download.html')).toContain(releaseLine('windows'));
  });

  it('pick between computers on the page for a phone or Linux, with each one’s page a click away', () => {
    const doc = open('download.html');
    expect(doc.querySelector('main[data-get="choose"]')).not.toBeNull();
    expect(
      [...doc.querySelectorAll('.get-choice a')].map((link) => link.getAttribute('href')),
    ).toEqual(['/download/mac', '/download/windows']);
  });

  it('are where the home page’s download buttons go', () => {
    const doc = open('index.html');
    const hrefs = [...doc.querySelectorAll('[data-downloads] a')].map((link) =>
      link.getAttribute('href'),
    );
    expect(new Set(hrefs)).toEqual(new Set(['/download/mac', '/download/windows']));
  });
});

describe.each(['privacy.html', 'terms.html'])('%s', (page) => {
  it('says when it took effect', () => {
    const date = open(page).querySelector('.legal-date time')?.getAttribute('datetime') ?? '';
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('gives the address for questions', () => {
    expect(open(page).querySelector(`main a[href="${CONTACT}"]`)).not.toBeNull();
  });

  it('lists every section it has, in order', () => {
    const doc = open(page);
    const listed = [...doc.querySelectorAll('.legal-toc a')].map((link) =>
      link.getAttribute('href')?.slice(1),
    );
    const sections = [...doc.querySelectorAll('.legal-text > section')].map((each) => each.id);
    expect(listed).toEqual(sections);
  });
});

describe('the site’s build', () => {
  it('builds every page, and lists the ones to find in the sitemap', () => {
    const config = readFileSync(join(SITE, 'vite.config.ts'), 'utf8');
    const sitemap = readFileSync(join(SITE, 'public', 'sitemap.xml'), 'utf8');
    // Every page in the site's folder, however many there come to be.
    const pages = readdirSync(SITE, { recursive: true, encoding: 'utf8' }).filter(
      (path) => path.endsWith('.html') && !/^(node_modules|dist|public)\b/.test(path),
    );
    expect(pages.length).toBeGreaterThan(6);
    for (const page of pages) expect(config, page).toContain(`'${page.replaceAll('\\', '/')}'`);
    for (const path of ['/', '/download', '/privacy', '/terms']) {
      expect(sitemap, path).toContain(`<loc>https://factwright.com${path}</loc>`);
    }
  });
});
