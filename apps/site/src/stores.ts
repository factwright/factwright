/** A browser's store that lists Save to Factwright, the browser extension. */
export type Store = 'chrome' | 'firefox';

/**
 * Save to Factwright's listing in each store, or null until it's published. Set each one here
 * once its listing is live: the build writes them into the pages (vite.config.ts), and a store
 * without one shows as coming soon.
 * - Chrome Web Store: https://chromewebstore.google.com/detail/<its name>/<the item's ID>
 * - Firefox Add-ons: https://addons.mozilla.org/firefox/addon/<the add-on's slug>/
 */
export const STORES: Readonly<Record<Store, string | null>> = {
  chrome:
    'https://chromewebstore.google.com/detail/save-to-factwright/gjhjddlohoonikgdbfcfnljeffilblai',
  firefox: null,
};

/** Each store's own site, where its listing must be. */
export const STORE_SITES: Readonly<Record<Store, string>> = {
  chrome: 'https://chromewebstore.google.com/',
  firefox: 'https://addons.mozilla.org/',
};

/** Each store's browser, as its button names it. */
const BROWSERS: Readonly<Record<Store, string>> = { chrome: 'Chrome', firefox: 'Firefox' };

/** Where a page puts a store's button, for the build to fill in. */
export const storeSlot = (store: Store) => `<span data-store="${store}"></span>`;

/** Text made safe to put in an attribute's quotes. */
const escapeAttribute = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/**
 * Fills in each store's place on a page: a button to its listing, or "Coming soon" with no link
 * until there's one. The first store with a listing gets the main button. The build does it, so
 * the page reads fine without its script.
 */
export function fillStores(
  html: string,
  stores: Readonly<Record<Store, string | null>> = STORES,
): string {
  const order = Object.keys(BROWSERS) as Store[];
  const main = order.find((store) => stores[store]);
  let page = html;
  for (const store of order) {
    const url = stores[store];
    const icon = '<svg class="icon" aria-hidden="true"><use href="#i-puzzle" /></svg>';
    const button = url
      ? `<a class="button ${store === main ? 'button-primary' : 'button-secondary'} button-lg" href="${escapeAttribute(url)}" data-store="${store}">${icon}Get it for ${BROWSERS[store]}</a>`
      : `<span class="button button-lg button-soon" data-store="${store}">${icon}Coming soon to ${BROWSERS[store]}</span>`;
    page = page.replaceAll(storeSlot(store), button);
  }
  return page;
}
