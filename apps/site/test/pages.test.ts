// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import {
  fillStores,
  type Listing,
  STORE_SITES,
  STORES,
  type Store,
  storeSlot,
} from '../src/stores.ts';

/** The site's folder. Paths, since jsdom's URL isn't one Node's file reading accepts. */
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Opens one of the site's pages in this test's document, as the build makes it, without running
 * its script. The build fills in the extension's store buttons, which `stores` can stand in for.
 */
function open(page: string, stores: Readonly<Record<Store, Listing>> = STORES): Document {
  const parsed = new DOMParser().parseFromString(
    fillStores(readFileSync(join(SITE, page), 'utf8'), stores),
    'text/html',
  );
  document.replaceChild(
    document.importNode(parsed.documentElement, true),
    document.documentElement,
  );
  return document;
}

/**
 * The links that start a download: the Worker counts each, then sends it on to the newest
 * installer on the download site (worker/downloads.ts).
 */
const DOWNLOADS = ['/download/get/mac', '/download/get/windows'];

/** The download pages: the one that picks, and one for each computer. */
const DOWNLOAD_PAGES = ['/download', '/download/mac', '/download/windows'];

/** The privacy policy and the terms, which every page's footer links to. */
const LEGAL_PAGES = ['/privacy', '/terms'];

/** The browser extension's page, which every page's footer links to. */
const EXTENSION_PAGE = '/extension';

/** What the privacy policy says about the browser extension, which the extension's page links to. */
const EXTENSION_PRIVACY = '/privacy#extension';

/** The extension's listings in the stores that have approved it, which its page links to. */
const LISTINGS = Object.values(STORES)
  .filter((listing) => listing.live)
  .map((listing) => listing.url);

/** Factwright's code on GitHub, which every page's footer links to, as can links into it. */
const SOURCE = 'https://github.com/factwright/factwright';

/** Factwright's maker, and the two ways to support Factwright. */
const MAKER = [
  'https://github.com/steve1two',
  'https://buymeacoffee.com/stevehillyer',
  'https://github.com/sponsors/steve1two',
];

/** The home page's Support Factwright block, which every other page's footer links to. */
const SUPPORT = '/#support';

/** Whether a link goes to Factwright's code, or something in it, such as a folder. */
const inSource = (href: string) => href === SOURCE || href.startsWith(`${SOURCE}/`);

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

/** The companies and the person the drawings of the app make up. Search results mustn't quote them. */
const MADE_UP = [
  'Lumen Health',
  'Fernway',
  'Harbor & Pine',
  'Tidewater Analytics',
  'Brightpath Learning',
  'Northwind',
  'Jordan Avery',
];

/** The start of an element's markup, for a failing test to show. */
const markup = (element: Element) => element.outerHTML.replace(/\s+/g, ' ').slice(0, 80);

/** Whether some text has a made-up name in it. */
const namesMadeUp = (text: string) =>
  MADE_UP.some((name) => text.replace(/\s+/g, ' ').includes(name));

/**
 * The elements that hold a made-up name, in an attribute or in their text. For text, only the
 * innermost element counts, so a name split by markup, such as `<b>Harbor</b> & Pine`, is found too.
 */
const holdingMadeUp = (doc: Document) =>
  [...doc.querySelectorAll('*')].filter(
    (element) =>
      [...element.attributes].some((attribute) => namesMadeUp(attribute.value)) ||
      (namesMadeUp(element.textContent ?? '') &&
        ![...element.children].some((child) => namesMadeUp(child.textContent ?? ''))),
  );

describe.each([
  'index.html',
  'download.html',
  'download/mac.html',
  'download/windows.html',
  'extension.html',
  'privacy.html',
  'terms.html',
  '404.html',
])('%s', (page) => {
  // Checking the home page takes a few seconds on CI's slower machines.
  it('passes an accessibility check', { timeout: 30_000 }, async () => {
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

  it('links only to its own sections, the site’s pages, the downloads, the extension’s stores, its code, its maker and Anthropic’s terms', () => {
    const doc = open(page);
    const legal = LEGAL_PAGES.includes(`/${page.replace('.html', '')}`);
    const allowed = [
      '/',
      SUPPORT,
      ...DOWNLOAD_PAGES,
      ...DOWNLOADS,
      ...LEGAL_PAGES,
      EXTENSION_PAGE,
      EXTENSION_PRIVACY,
      ...LISTINGS,
      ...MAKER,
      ...(legal ? [CONTACT, ...ANTHROPIC_LEGAL] : []),
    ];
    for (const link of doc.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('#')) expect(doc.getElementById(href.slice(1)), href).not.toBeNull();
      else if (!inSource(href)) expect(allowed).toContain(href);
    }
  });

  it('links to the browser extension, the privacy policy, the terms and the code from its footer', () => {
    const footer = open(page).querySelector('footer');
    const hrefs = [...(footer?.querySelectorAll('a[href]') ?? [])].map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual(expect.arrayContaining([EXTENSION_PAGE, ...LEGAL_PAGES, SOURCE]));
  });

  it('links to Support Factwright from its footer', () => {
    const links = [...(open(page).querySelector('footer')?.querySelectorAll('a[href]') ?? [])];
    const support = links.find((link) => link.textContent?.trim() === 'Support Factwright');
    const href = page === 'index.html' ? '#support' : SUPPORT;
    expect(support?.getAttribute('href')).toBe(href);
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

  it('draws only icons the page has', () => {
    const doc = open(page);
    for (const use of doc.querySelectorAll('use')) {
      const href = use.getAttribute('href') ?? '';
      expect(href.startsWith('#') && doc.getElementById(href.slice(1)), href).toBeTruthy();
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

  it('keeps made-up names out of anything a search result could quote', () => {
    // The title and the descriptions can't be marked, so a name there is never allowed.
    for (const element of holdingMadeUp(open(page))) {
      expect(element.closest('[data-nosnippet]'), markup(element)).not.toBeNull();
    }
  });

  it('puts data-nosnippet only on the elements search engines read it on', () => {
    // Google supports it on div, span and section elements, so it only goes on those.
    for (const marked of open(page).querySelectorAll('[data-nosnippet]')) {
      expect(['DIV', 'SPAN', 'SECTION']).toContain(marked.tagName);
    }
  });
});

describe('the home page', () => {
  it('says whose Claude runs, and that runs count against its plan', () => {
    const footer = open('index.html').querySelector('footer')?.textContent?.replace(/\s+/g, ' ');
    expect(footer).toContain(
      'It uses your own Claude account, and its runs count against your plan.',
    );
  });

  it('offers both ways to support Factwright, as buttons in its own block', () => {
    const support = open('index.html').getElementById('support');
    expect(support?.querySelector('h3')?.textContent).toBe('Support Factwright');
    const buttons = [...(support?.querySelectorAll('a.button') ?? [])];
    expect(buttons.map((button) => button.getAttribute('href'))).toEqual([
      'https://buymeacoffee.com/stevehillyer',
      'https://github.com/sponsors/steve1two',
    ]);
  });

  it('says it’s open source, with its code a click away in the header', () => {
    const doc = open('index.html');
    const header = [...(doc.querySelector('header')?.querySelectorAll('a[href]') ?? [])];
    expect(header.map((link) => link.getAttribute('href'))).toContain(SOURCE);
    expect(doc.querySelector('#open-source')?.textContent).toContain('fully open source');
    expect(doc.querySelector('.hero-note a')?.getAttribute('href')).toBe(SOURCE);
  });

  it('has “resume” in its title', () => {
    expect(open('index.html').title).toMatch(/resume/i);
  });

  it('tells search engines, as data and not a script, that Factwright is free for macOS and Windows, from Neatifai LLC', () => {
    const doc = open('index.html');
    const blocks = doc.querySelectorAll('script[type="application/ld+json"]');
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0]?.textContent ?? '')).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Factwright',
      // The same address and words as the rest of the head gives.
      url: doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      description: doc.querySelector('meta[name="description"]')?.getAttribute('content'),
      operatingSystem: 'macOS, Windows',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@type': 'Organization', name: 'Neatifai LLC' },
    });
  });

  it('keeps each drawing of the app out of search snippets', () => {
    // The picture in each figure, and the resume and fact cards that trace a line.
    const drawings = [
      ...open('index.html').querySelectorAll('figure > :not(figcaption), [data-trace]'),
    ];
    expect(drawings.length).toBeGreaterThan(0);
    for (const drawing of drawings) {
      expect(drawing.hasAttribute('data-nosnippet'), markup(drawing)).toBe(true);
    }
  });

  it('still shows every name on the made-up list, so the list can’t go stale', () => {
    const text = open('index.html').body.textContent?.replace(/\s+/g, ' ') ?? '';
    for (const name of MADE_UP) expect(text, name).toContain(name);
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

  it('keep search engines from following the links that count downloads', () => {
    for (const page of ['download/mac.html', 'download/windows.html']) {
      for (const link of open(page).querySelectorAll('a[href^="/download/get/"]')) {
        expect(link.getAttribute('rel'), page).toBe('nofollow');
      }
    }
    // Some crawlers take the first rule that matches, so the links' rule comes before Allow: /.
    const rules = readFileSync(join(SITE, 'public', 'robots.txt'), 'utf8')
      .split('\n')
      .filter((rule) => /^(Allow|Disallow):/.test(rule));
    expect(rules[0]).toBe('Disallow: /download/get/');
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
    const offers = doc.querySelectorAll('[data-download], [data-downloads] [data-for] a');
    const hrefs = [...offers].map((link) => link.getAttribute('href'));
    expect(new Set(hrefs)).toEqual(new Set(['/download/mac', '/download/windows']));
  });
});

describe('the extension page', () => {
  const CHROME = 'https://chromewebstore.google.com/detail/save/abcdefghijklmnopabcdefghijklmnop';
  const FIREFOX = 'https://addons.mozilla.org/firefox/addon/save/';

  /** Both stores' listings, each live or not. */
  const stores = (chrome: boolean, firefox: boolean) => ({
    chrome: { url: CHROME, live: chrome },
    firefox: { url: FIREFOX, live: firefox },
  });

  /** Each store's button, as it shows. */
  const buttons = (doc: Document, store: Store) => [
    ...doc.querySelectorAll<HTMLElement>(`[data-store="${store}"]`),
  ];

  it('has a place for each store’s button, under its headline and after its steps', () => {
    const source = readFileSync(join(SITE, 'extension.html'), 'utf8');
    const doc = open('extension.html');
    for (const store of ['chrome', 'firefox'] as const) {
      expect(source.split(storeSlot(store)), store).toHaveLength(3);
      expect(doc.querySelectorAll(`.ext-copy [data-store="${store}"]`), store).toHaveLength(1);
      expect(doc.querySelectorAll(`.ext-setup [data-store="${store}"]`), store).toHaveLength(1);
    }
  });

  it('has the build fill its store buttons in', () => {
    const config = readFileSync(join(SITE, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/plugins: \[[^\]]*\bstoreButtons\(\)/);
  });

  it('shows a store as coming soon, with no link, until that store approves it', () => {
    const doc = open('extension.html', stores(false, false));
    for (const [store, name] of [
      ['chrome', 'the Chrome Web Store'],
      ['firefox', 'Firefox Add-ons'],
    ] as const) {
      const shown = buttons(doc, store);
      expect(shown).toHaveLength(2);
      for (const button of shown) {
        expect(button.tagName).toBe('SPAN');
        expect(button.classList).toContain('button-soon');
        expect(button.textContent?.trim()).toBe(`Coming soon to ${name}`);
      }
    }
    expect(doc.querySelector('a[data-store]')).toBeNull();
    // A listing still in review isn't on the page at all.
    for (const url of [CHROME, FIREFOX]) expect(doc.documentElement.outerHTML).not.toContain(url);
  });

  it('links to each store once it’s live, the first as the main button', () => {
    const both = open('extension.html', stores(true, true));
    for (const [store, url, browser, kind] of [
      ['chrome', CHROME, 'Chrome', 'button-primary'],
      ['firefox', FIREFOX, 'Firefox', 'button-secondary'],
    ] as const) {
      expect(buttons(both, store), store).toHaveLength(2);
      for (const button of buttons(both, store)) {
        expect(button.tagName).toBe('A');
        expect(button.getAttribute('href')).toBe(url);
        expect(button.classList).toContain(kind);
        expect(button.textContent?.trim()).toBe(`Get it for ${browser}`);
      }
    }
    // With only Firefox's live, its button is the main one, and Chrome's is still coming.
    const firefox = open('extension.html', stores(false, true));
    expect(buttons(firefox, 'firefox').map((button) => button.className)).toEqual([
      'button button-primary button-lg',
      'button button-primary button-lg',
    ]);
    expect(buttons(firefox, 'chrome').map((button) => button.tagName)).toEqual(['SPAN', 'SPAN']);
  });

  it('keeps a store’s address whole, whatever it holds', () => {
    // Quotes and ampersands are escaped, and "$&" is never read as a replacement pattern.
    const odd = 'https://chromewebstore.google.com/detail/x?a=1&b="2"&c=$&d=$\'';
    const listings = { chrome: { url: odd, live: true }, firefox: { url: FIREFOX, live: false } };
    const links = buttons(open('extension.html', listings), 'chrome');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([odd, odd]);
  });

  it('keeps each store’s listing on that store’s own site', () => {
    for (const [store, listing] of Object.entries(STORES) as [Store, Listing][]) {
      expect(listing.url.startsWith(STORE_SITES[store]), store).toBe(true);
    }
  });

  it('says it’s coming soon wherever the site mentions it, until a store has it', () => {
    /** What each paragraph that mentions the extension says. */
    const mentions = (doc: Document) =>
      [...doc.querySelectorAll(`main a[href="${EXTENSION_PAGE}"], .ext-steps strong`)]
        .map((part) => part.closest('p, li')?.textContent?.replace(/\s+/g, ' ') ?? '')
        .filter((text) => text.includes('Save to Factwright') || text.includes('extension'));
    for (const page of [
      'index.html',
      'download/mac.html',
      'download/windows.html',
      'extension.html',
    ]) {
      expect(readFileSync(join(SITE, page), 'utf8'), page).toContain('<span data-soon>');
      // Each opening replaces the last, so each is read before the next.
      const soon = open(page, stores(false, false));
      expect(mentions(soon).length, page).toBeGreaterThan(0);
      for (const text of mentions(soon)) expect(text, page).toMatch(/coming soon|once it’s in/);
      // Either way, the words are plain text, with nothing left to mark them.
      expect(soon.querySelector('[data-soon]'), page).toBeNull();
      const live = open(page, stores(true, false));
      for (const text of mentions(live)) expect(text, page).not.toMatch(/coming soon|once it’s in/);
      expect(live.querySelector('[data-soon]'), page).toBeNull();
    }
  });

  it('says it needs Factwright, with a link to what it is, and its download in the steps', () => {
    const doc = open('extension.html');
    const note = doc.querySelector('.ext-copy .ext-note');
    expect(note?.textContent).toContain('Needs Factwright for Mac or Windows, with sync on');
    // The download pages start the download at once, so only a link that says so goes there.
    expect(note?.querySelector('a[href="/"]')?.textContent).toBe('Factwright');
    expect(doc.querySelector('.ext-steps a[href="/download"]')?.textContent).toBe('Get Factwright');
  });

  it('links to the part of the privacy policy about the extension', () => {
    expect(open('extension.html').querySelector(`a[href="${EXTENSION_PRIVACY}"]`)).not.toBeNull();
    expect(open('privacy.html').getElementById('extension')?.tagName).toBe('SECTION');
  });

  it('keeps its drawing of the extension out of search snippets', () => {
    const drawings = [...open('extension.html').querySelectorAll('figure > :not(figcaption)')];
    expect(drawings.length).toBeGreaterThan(0);
    for (const drawing of drawings) {
      expect(drawing.hasAttribute('data-nosnippet'), markup(drawing)).toBe(true);
    }
  });

  it('is where the home page and the download pages point people to it', () => {
    for (const page of ['index.html', 'download/mac.html', 'download/windows.html']) {
      const links = open(page).querySelectorAll(`main a[href="${EXTENSION_PAGE}"]`);
      expect(links.length, page).toBeGreaterThan(0);
    }
  });

  it('is a click away in the home page’s header', () => {
    const link = open('index.html').querySelector(`.site-header a[href="${EXTENSION_PAGE}"]`);
    expect(link?.querySelector('.header-ext-long')?.textContent).toBe('Browser extension');
    expect(link?.querySelector('.header-ext-short')?.textContent).toBe('Extension');
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
    for (const path of ['/', '/download', EXTENSION_PAGE, '/privacy', '/terms']) {
      expect(sitemap, path).toContain(`<loc>https://factwright.com${path}</loc>`);
    }
  });
});
