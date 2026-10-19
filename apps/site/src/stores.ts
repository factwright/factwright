/** A browser's store that lists Save to Factwright, the browser extension. */
export type Store = 'chrome' | 'firefox';

/** Save to Factwright's listing in a store. */
export interface Listing {
  /** Its address in the store. */
  url: string;
  /** Whether the store has approved it, so anyone can install it from there. */
  live: boolean;
}

/**
 * Save to Factwright's listing in each store. The build writes them into the pages
 * (vite.config.ts): a store that isn't live yet shows as coming soon, with no link, and so does
 * the site wherever it mentions the extension. Once a store approves it, set its `live` to true.
 * - Chrome Web Store: https://chromewebstore.google.com/detail/<its name>/<the item's ID>
 * - Firefox Add-ons: https://addons.mozilla.org/firefox/addon/<the add-on's slug>/
 */
export const STORES: Readonly<Record<Store, Listing>> = {
  chrome: {
    url: 'https://chromewebstore.google.com/detail/save-to-factwright/gjhjddlohoonikgdbfcfnljeffilblai',
    live: true,
  },
  firefox: {
    url: 'https://addons.mozilla.org/firefox/addon/save-to-factwright/',
    live: true,
  },
};

/** Each store's own site, where its listing must be. */
export const STORE_SITES: Readonly<Record<Store, string>> = {
  chrome: 'https://chromewebstore.google.com/',
  firefox: 'https://addons.mozilla.org/',
};

/** What each store's button names: the browser it's for, and the store itself. */
const NAMES: Readonly<Record<Store, { browser: string; store: string }>> = {
  chrome: { browser: 'Chrome', store: 'the Chrome Web Store' },
  firefox: { browser: 'Firefox', store: 'Firefox Add-ons' },
};

/** Where a page puts a store's button, for the build to fill in. */
export const storeSlot = (store: Store) => `<span data-store="${store}"></span>`;

/**
 * Words a page says beside a mention of the extension until a store has it out, such as
 * `<span data-soon>, coming soon,</span>`. They hold no markup.
 */
const SOON = /<span data-soon>([^<]*)<\/span>/g;

/** Text made safe to put in an attribute's quotes. */
const escapeAttribute = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/**
 * Fills in each store's place on a page: a button to its listing once it's live, or "Coming soon"
 * with no link until then. The first live store gets the main button. A page's words for until
 * then stay, as plain text, while no store is live, and go once one is. The build does it, so the
 * pages read fine without their script.
 */
export function fillStores(
  html: string,
  stores: Readonly<Record<Store, Listing>> = STORES,
): string {
  const order = Object.keys(NAMES) as Store[];
  const main = order.find((store) => stores[store].live);
  let page = html;
  for (const store of order) {
    const { url, live } = stores[store];
    // A puzzle piece, as both browsers mark extensions, drawn here so any page can show it.
    const icon =
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.75 7.5h5a2 2 0 1 1 4 0h3.5V11a2 2 0 1 1 0 4v3.5H4.75z" /></svg>';
    const button = live
      ? `<a class="button ${store === main ? 'button-primary' : 'button-secondary'} button-lg" href="${escapeAttribute(url)}" data-store="${store}">${icon}Get it for ${NAMES[store].browser}</a>`
      : `<span class="button button-lg button-soon" data-store="${store}">${icon}Coming soon to ${NAMES[store].store}</span>`;
    // A function, so a "$" in an address is never read as a replacement pattern.
    page = page.replaceAll(storeSlot(store), () => button);
  }
  return page.replace(SOON, (_, words: string) => (main ? '' : words));
}
