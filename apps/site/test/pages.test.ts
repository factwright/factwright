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

/** The guide to running your own sync server, which every page's footer links to. */
const OWN_SERVER_PAGE = '/own-server';

/** The page about sync and what it costs, which every page's footer links to. */
const SYNC_PAGE = '/sync';

/** What the terms and the privacy policy say about paying for sync, which the sync page links to. */
const PAYING = ['/terms#paying', '/privacy#paying'];

/** What the privacy policy says about sync and the web view, which the sync page links to. */
const SYNC_PRIVACY = '/privacy#sync';

/** Where to ask for sync for free, which the sync page and the terms give. */
const MONEY_TIGHT = 'mailto:steve@factwright.com';

/** The pages that say how to ask for sync for free. */
const FREE_SYNC_PAGES = ['sync.html', 'terms.html'];

/** Stripe's privacy policy, which the privacy policy points to for paying. */
const STRIPE_PRIVACY = 'https://stripe.com/privacy';

/** Link's terms for what it sells as the merchant of record, which the terms link to. */
const LINK_TERMS = 'https://link.com/terms#sold-through-link-terms';

/**
 * The apps' own source files, leaving out their tests: the desktop app's, and the shared words in
 * @factwright/core that it and the web view show, such as sync's price.
 */
const appSources = () =>
  [join(SITE, '..', 'desktop', 'src'), join(SITE, '..', '..', 'packages', 'core', 'src')].flatMap(
    (folder) =>
      readdirSync(folder, { recursive: true, encoding: 'utf8' })
        .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
        .map((path) => readFileSync(join(folder, path), 'utf8')),
  );

/**
 * Each price in some words, as "$5 a month", however it's written: "$5 a month", "$5 per month"
 * or "$5/mo".
 */
const pricesIn = (text: string) =>
  [...text.matchAll(/\$\s?([\d.,]+)\s*(?:a|per|\/)\s*(month|year|mo|yr)\b/g)].map(
    ([, amount, period]) =>
      `$${amount} a ${({ mo: 'month', yr: 'year' } as Record<string, string>)[period ?? ''] ?? period}`,
  );

/** What sync on Factwright's own server costs, wherever the site or the app says it. */
const PRICES = ['$5 a month', '$50 a year'];

/**
 * Where the guide sends people to do each step: Cloudflare's and GitHub's sign-up pages and the
 * pages in their dashboards, the Deploy button for sync-server's ready-to-deploy copy, and what R2
 * costs. Only the guide links to them.
 */
const OWN_SERVER_STEPS = [
  'https://dash.cloudflare.com/sign-up',
  'https://dash.cloudflare.com/?to=/:account/workers-and-pages',
  'https://dash.cloudflare.com/?to=/:account/r2/overview',
  'https://developers.cloudflare.com/r2/pricing/',
  'https://github.com/signup',
  'https://github.com/settings/applications/new',
  'https://deploy.workers.cloudflare.com/?url=https://github.com/factwright/sync-server',
  'https://github.com/factwright/sync-server',
];

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

/** An element's words, with each run of spaces as one. */
const said = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

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
  'own-server.html',
  'sync.html',
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

  it('links only to its own sections, the site’s pages, the downloads, the extension’s stores, its code, its maker, Anthropic’s and Stripe’s terms, the address for free sync and the own-server guide’s steps', () => {
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
      OWN_SERVER_PAGE,
      SYNC_PAGE,
      SYNC_PRIVACY,
      ...PAYING,
      ...LISTINGS,
      ...MAKER,
      ...(legal ? [CONTACT, ...ANTHROPIC_LEGAL, STRIPE_PRIVACY, LINK_TERMS] : []),
      ...(FREE_SYNC_PAGES.includes(page) ? [MONEY_TIGHT] : []),
      ...(page === 'own-server.html' ? OWN_SERVER_STEPS : []),
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

  it('links to sync, and to the guide to running your own sync server, from its footer', () => {
    const footer = open(page).querySelector('footer');
    expect(footer?.querySelector(`a[href="${SYNC_PAGE}"]`)?.textContent).toBe('Sync');
    const link = footer?.querySelector(`a[href="${OWN_SERVER_PAGE}"]`);
    expect(link?.textContent).toBe('Your own sync server');
  });

  it('has no inline script, style or event handler, which its security policy would block', () => {
    const doc = open(page);
    // A block of JSON-LD is data, not a script, so the policy doesn't apply to it.
    expect(
      doc.querySelectorAll('script:not([src]):not([type="application/ld+json"])'),
    ).toHaveLength(0);
    expect(doc.querySelectorAll('style, [style]')).toHaveLength(0);
    for (const element of doc.querySelectorAll('*')) {
      const handlers = [...element.attributes].filter((attribute) => /^on/i.test(attribute.name));
      expect(handlers, markup(element)).toEqual([]);
    }
    // Nothing on the site is sent anywhere, and the policy allows no form to.
    expect(doc.querySelectorAll('form')).toHaveLength(0);
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
      'sync.html',
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

  it('says it saves to Factwright, on the same computer or through sync, with links to what each is, and its download in the steps', () => {
    const doc = open('extension.html');
    const note = doc.querySelector('.ext-copy .ext-note');
    expect(said(note)).toContain(
      'Saves to Factwright on the same computer, or through sync from anywhere',
    );
    // The download pages start the download at once, so only a link that says so goes there.
    expect(note?.querySelector('a[href="/"]')?.textContent).toBe('Factwright');
    expect(note?.querySelector(`a[href="${SYNC_PAGE}"]`)?.textContent).toBe('sync');
    expect(doc.querySelector('.ext-steps a[href="/download"]')?.textContent).toBe('Get Factwright');
  });

  it('says what each way to sync costs where it says how to set it up, after saving with no account', () => {
    const setup = open('extension.html').querySelector('#setup .lede');
    expect(said(setup)).toContain(
      'It saves straight to Factwright on the same computer, with no account, or through sync from any computer',
    );
    expect(said(setup)).toContain(
      'Factwright’s sync, for $5 a month or $50 a year, or a server of your own, for free.',
    );
    expect(setup?.querySelector(`a[href="${SYNC_PAGE}"]`)?.textContent).toBe('Factwright’s sync');
    expect(setup?.querySelector(`a[href="${OWN_SERVER_PAGE}"]`)?.textContent).toBe(
      'a server of your own',
    );
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

describe('the own-server guide', () => {
  it('says up front what Cloudflare may ask for, that updates aren’t automatic, and which Factwright connects', () => {
    const before = open('own-server.html')
      .getElementById('before')
      ?.textContent?.replace(/\s+/g, ' ');
    expect(before).toContain(
      'Cloudflare may ask for a payment method before it turns on R2, its file storage, even on the free plan.',
    );
    expect(before).toContain('Updates to your server aren’t automatic yet.');
    expect(before).toContain('Connecting needs Factwright 0.9 or later');
  });

  it('says it all again in the steps it’s about', () => {
    const doc = open('own-server.html');
    const order = [...doc.querySelectorAll('#before, .own-step')].map((part) => part.id);
    expect(order).toEqual(['before', 'address', 'github', 'deploy', 'connect']);
    const text = (id: string) => doc.getElementById(id)?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text('address')).toContain('Cloudflare may ask for a payment method');
    expect(text('connect')).toContain(
      'Save to Factwright, the browser extension, can save through your server too, from its version 0.2',
    );
    expect(text('updates')).toContain('Updates to your own server aren’t automatic yet');
  });

  it('names each step by its number, for screen readers, which skip the drawn one', () => {
    const steps = [...open('own-server.html').querySelectorAll('.own-step h2')];
    expect(steps.map((heading) => heading.textContent?.replace(/^\d/, ''))).toEqual([
      'Step 1: Your Cloudflare account',
      'Step 2: A GitHub sign-in app',
      'Step 3: Deploy',
      'Step 4: Connect Factwright',
    ]);
  });

  it('lists its steps and sections beside it, in order', () => {
    const doc = open('own-server.html');
    const listed = [...doc.querySelectorAll('.own-toc a')].map((link) =>
      link.getAttribute('href')?.slice(1),
    );
    const parts = [...doc.querySelectorAll('.own-text > section, .own-step')].map(
      (part) => part.id,
    );
    expect(listed).toEqual(parts);
  });

  it('says when a link opens in a new tab, and keeps the new tab from reaching back', () => {
    const doc = open('own-server.html');
    const away = [...doc.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')];
    expect(away.length).toBeGreaterThan(3);
    for (const link of away) {
      expect(link.getAttribute('rel'), markup(link)).toBe('noopener');
      expect(link.querySelector('.visually-hidden')?.textContent, markup(link)).toBe(
        ' (opens in a new tab)',
      );
    }
  });

  it('gives every Copy button a value to copy, and says which one', () => {
    const doc = open('own-server.html');
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>('button[data-copy]')];
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) {
      expect(button.type).toBe('button');
      expect(doc.getElementById(button.dataset.copy ?? '')?.tagName, markup(button)).toBe('CODE');
      expect(button.querySelector('.visually-hidden')?.textContent?.trim()).toBeTruthy();
    }
  });

  it('keeps each value on one line of markup, so copying it adds no spaces', () => {
    for (const value of open('own-server.html').querySelectorAll('code[id]')) {
      expect(value.textContent, markup(value)).not.toMatch(/\s{2}|\n/);
    }
  });

  it('is where the home page points people, where it talks about sync and in its questions', () => {
    const doc = open('index.html');
    expect(doc.querySelector(`.where a[href="${OWN_SERVER_PAGE}"]`)).not.toBeNull();
    const question = doc.querySelector(`.faq a[href="${OWN_SERVER_PAGE}"]`)?.closest('details');
    expect(question?.querySelector('summary')?.textContent).toBe('Can I run my own sync server?');
  });
});

describe('the sync page', () => {
  it('sets out both ways to sync side by side: ours, with its price, and your own, for free', () => {
    const [ours, own] = [...open('sync.html').querySelectorAll('.sync-plan')];
    expect(said(ours?.querySelector('h3'))).toBe('Factwright’s sync');
    expect(said(ours)).toContain(`${PRICES[0]} or ${PRICES[1]}`);
    expect(said(ours)).toContain('Cancel anytime, and sync keeps going to the end of the time');
    expect(said(own?.querySelector('h3'))).toBe('Your own server');
    expect(said(own?.querySelector('.sync-price'))).toBe('Free');
    expect(own?.querySelector(`a[href="${OWN_SERVER_PAGE}"]`)).not.toBeNull();
  });

  it('says what sync does: other computers, the phone and the extension, end-to-end encrypted', () => {
    const what = open('sync.html').getElementById('what');
    expect([...(what?.querySelectorAll('h3') ?? [])].map(said)).toEqual([
      'Your other computers',
      'Your phone',
      'Save to Factwright',
    ]);
    expect(said(what)).toContain('even on a computer without Factwright');
    expect(said(what)).toContain('End-to-end encrypted');
  });

  it('offers sync for free when money’s tight, in Steve’s own words, as the app does', () => {
    const note = open('sync.html').getElementById('money-tight');
    expect(said(note)).toBe(
      'Money’s tight? Email steve@factwright.com and I’ll turn on sync for free. No questions asked.',
    );
    expect(note?.querySelector('a')?.getAttribute('href')).toBe(MONEY_TIGHT);
    // The app's sync screen says it the same way, with the same address.
    const sources = appSources();
    const offer = sources.find((source) => source.includes('Money’s tight? Email'));
    expect(offer).toContain('and I’ll turn on sync for free. No questions asked.');
    const address = `'${MONEY_TIGHT.replace('mailto:', '')}'`;
    expect(sources.some((source) => source.includes(address))).toBe(true);
  });

  it('says accounts from before sync had a price keep it free, for good', () => {
    expect(said(open('sync.html').getElementById('early'))).toContain(
      'Made your account before sync had a price? It stays free for you, for good.',
    );
  });

  it('links to what the terms and the privacy policy say about paying, which they have', () => {
    const doc = open('sync.html');
    for (const href of PAYING)
      expect(doc.querySelector(`main a[href="${href}"]`), href).not.toBeNull();
    for (const href of [...PAYING, SYNC_PRIVACY]) {
      const [page, part] = href.slice(1).split('#');
      expect(open(`${page}.html`).getElementById(part ?? '')?.tagName, href).toBe('SECTION');
    }
  });

  it('is where the home page points people: under its download buttons, where it talks about sync, and in its questions', () => {
    const doc = open('index.html');
    const note = doc.querySelector('.hero .hero-note');
    expect(said(note)).toContain(
      'Uses your own Claude plan · Sync $5 a month, or free on your own server',
    );
    expect(note?.querySelector(`a[href="${SYNC_PAGE}"]`)?.textContent).toBe('Sync');
    expect(doc.querySelector(`.where a[href="${SYNC_PAGE}"]`)).not.toBeNull();
    const question = doc.querySelector(`.faq a[href="${SYNC_PAGE}"]`)?.closest('details');
    expect(question?.querySelector('summary')?.textContent).toBe('What does it cost?');
  });

  it('is where the extension’s page, the download pages and the own-server guide point people', () => {
    for (const page of [
      'extension.html',
      'download/mac.html',
      'download/windows.html',
      'own-server.html',
    ]) {
      expect(open(page).querySelector(`main a[href="${SYNC_PAGE}"]`), page).not.toBeNull();
    }
  });

  it('gives the same price everywhere it’s said: on the site, in the READMEs and the store listing, and in the app', () => {
    const pages = readdirSync(SITE, { recursive: true, encoding: 'utf8' }).filter(
      (path) => path.endsWith('.html') && !/^(node_modules|dist|public)\b/.test(path),
    );
    const words = pages.map((page) => {
      const doc = open(page);
      const description = doc.querySelector('meta[name="description"]')?.getAttribute('content');
      return [page, `${description ?? ''} ${doc.body.textContent ?? ''}`] as const;
    });
    const readmes = ['../../README.md', '../extension/store/README.md'].map(
      (path) => [path, readFileSync(join(SITE, path), 'utf8')] as const,
    );
    for (const [where, text] of [...words, ...readmes]) {
      for (const price of pricesIn(text)) expect(PRICES, where).toContain(price);
    }
    // Each of these says it.
    for (const where of [
      'index.html',
      'sync.html',
      'extension.html',
      'own-server.html',
      'terms.html',
      '../../README.md',
      '../extension/store/README.md',
    ]) {
      const text = [...words, ...readmes].find(([path]) => path === where)?.[1] ?? '';
      expect(pricesIn(text).length, where).toBeGreaterThan(0);
    }
    // The app's own sync screen shows it once Factwright's server sells sync.
    expect(appSources().some((source) => source.includes(`'${PRICES[0]} or ${PRICES[1]}'`))).toBe(
      true,
    );
  });

  it('keeps the home page’s search data saying Factwright is free, as the app is', () => {
    const blocks = open('index.html').querySelectorAll('script[type="application/ld+json"]');
    expect(JSON.parse(blocks[0]?.textContent ?? '').offers.price).toBe('0');
  });
});

describe('the terms', () => {
  const paying = () => said(open('terms.html').getElementById('paying'));

  it('say up front that the app is free, and sync on our server is a subscription', () => {
    const short = said(open('terms.html').getElementById('short'));
    expect(short).toContain('The app is free, and so is running your own sync server.');
    expect(short).toContain(
      'Sync on our server is a subscription, $5 a month or $50 a year. It renews until you cancel. You can cancel anytime',
    );
  });

  it('cover the price, renewing, canceling, refunds, price changes, free sync, deleting, and servers we don’t run', () => {
    for (const part of [
      `${PRICES[0]} or ${PRICES[1]}, in US dollars`,
      'You pay when you subscribe, and your subscription renews automatically',
      'you’ll get an email reminding you 30 days ahead, with how to cancel',
      'You can cancel anytime, from your account page in the web view, or by emailing us.',
      'Sync keeps going to the end of the time you’ve paid for',
      'No refunds from us, except where the law requires one',
      'we’ll email you 30 days before a new price applies to you, with how to cancel',
      'Accounts made before we started selling sync keep it free',
      'if money’s tight',
      'Deleting your account ends your subscription at once',
      'We don’t charge for running your own sync server',
    ]) {
      expect(paying()).toContain(part);
    }
  });

  it('keep supporting Factwright apart from paying for sync', () => {
    const app = said(open('terms.html').getElementById('app'));
    expect(app).toContain('It isn’t a payment to us: it doesn’t buy features, support or sync');
    expect(app).toContain('A sync subscription is separate');
  });
});

describe('the privacy policy', () => {
  it('says Stripe takes payments, what we give it and keep, and for how long', () => {
    const section = open('privacy.html').getElementById('paying');
    expect(section?.querySelector(`a[href="${STRIPE_PRIVACY}"]`)).not.toBeNull();
    for (const part of [
      'We never see your full card number.',
      'we give Stripe your account’s email address and ID',
      'We keep these until you delete your account.',
      'Deleting it deletes your customer record at Stripe too, which ends your subscription at once.',
      'until an account signs up with it, or until you ask us to forget it',
      'Stripe also shows us, in our Stripe account, your name, email address and billing address',
      'the kind of card you used and its last four digits',
      'for as long as that law requires, even after you delete your account',
    ]) {
      expect(said(section)).toContain(part);
    }
  });

  it('says what each column the server keeps about paying holds, so a new one waits on the policy', () => {
    const folder = join(SITE, '..', 'server', 'migrations');
    const sql = readdirSync(folder)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(folder, file), 'utf8'))
      .join('\n');
    /** A table's columns, as it's made, then as later migrations add to them. */
    const columns = (table: string) => {
      const made = new RegExp(`create table "${table}" \\(([\\s\\S]*?)\\);`, 'i').exec(sql)?.[1];
      const added = new RegExp(`alter table "${table}" add column "(\\w+)"`, 'gi');
      return [
        ...[...(made ?? '').matchAll(/(?:^|, )"(\w+)" (?:text|integer|real|blob)/g)],
        ...[...sql.matchAll(added)],
      ].map((match) => match[1]);
    };
    /** The policy's words for each column. An account's ID is the one the policy's sync part covers. */
    const told: Record<string, Record<string, string | null>> = {
      syncAccess: {
        account: null,
        gift: 'whether we gave you sync for free',
        customer: 'Stripe’s IDs for you as its customer',
        subscription: 'and for your subscription',
        status: 'your subscription’s status',
        renewsAt: 'when the time you’ve paid for ends',
        canceling: 'whether you’ve canceled it',
        checkedAt: 'when we last checked it with Stripe',
        checkoutAt: 'when you last started a checkout',
        updatedAt: 'when any of this last changed',
      },
      freeSyncEmail: { email: 'we keep that address', since: 'and when we gave it' },
    };
    const policy = said(open('privacy.html').getElementById('paying'));
    for (const [table, words] of Object.entries(told)) {
      expect(columns(table), table).toEqual(Object.keys(words));
      for (const [column, phrase] of Object.entries(words)) {
        if (phrase) expect(policy, `${table}.${column}`).toContain(phrase);
      }
    }
  });
});

describe.each(['privacy.html', 'terms.html'])('%s', (page) => {
  /** How a page says sync is sold: through Link, as the merchant of record, or with Stripe as our processor. */
  const sold = (each: string) => {
    const text = said(open(each).getElementById('paying'));
    if (text.includes('Sold through Link, LLC, as the merchant of record')) return 'Link';
    if (text.includes('our payment processor')) return 'Stripe';
    return null;
  };

  it('says how sync is sold, the same way as the other does', () => {
    expect(sold(page)).not.toBeNull();
    expect(sold(page)).toBe(sold(page === 'terms.html' ? 'privacy.html' : 'terms.html'));
  });

  it('says how sync is sold the way Factwright’s sync server sells it, as STRIPE_MANAGED_PAYMENTS says', () => {
    const config = readFileSync(join(SITE, '..', 'server', 'wrangler.jsonc'), 'utf8');
    // wrangler.jsonc may give it as text or as true or false, as the server takes either.
    const managed = /"STRIPE_MANAGED_PAYMENTS":\s*"?\s*(true|false)\s*"?/i.exec(config)?.[1];
    expect(managed?.toLowerCase()).toMatch(/^(true|false)$/);
    expect(sold(page)).toBe(managed?.toLowerCase() === 'true' ? 'Link' : 'Stripe');
  });

  it('links to Link’s terms for the sale while Link is the merchant of record', () => {
    const doc = open('terms.html');
    const linked = doc.querySelector(`#paying a[href="${LINK_TERMS}"]`) !== null;
    expect(linked).toBe(said(doc.getElementById('paying')).includes('as the merchant of record'));
  });

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
    for (const path of [
      '/',
      '/download',
      EXTENSION_PAGE,
      SYNC_PAGE,
      OWN_SERVER_PAGE,
      '/privacy',
      '/terms',
    ]) {
      expect(sitemap, path).toContain(`<loc>https://factwright.com${path}</loc>`);
    }
  });
});
