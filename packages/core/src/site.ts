/**
 * The page on Factwright's website for Save to Factwright, the browser extension: what it does,
 * and where to get it. The app links to it where saving jobs from the browser would help.
 */
export const EXTENSION_URL = 'https://factwright.com/extension';

/**
 * The steps for running a sync server of your own, which "How to set one up" opens in the app and
 * the web view: the ready-to-deploy copy, with its Deploy to Cloudflare button.
 */
export const OWN_SERVER_GUIDE = 'https://github.com/factwright/sync-server';

/**
 * What sync on Factwright's own server costs, in whole US dollars, as its two Stripe prices are
 * set. The app and the web view show these, and Stripe's checkout adds tax where it applies.
 */
export const SYNC_PRICE = { month: 5, year: 50 } as const;

/** Sync's price, in words, as factwright.com says it too. Its test checks it matches SYNC_PRICE. */
export const SYNC_PRICE_WORDS = '$5 a month or $50 a year';

/** Where someone who can't pay for sync asks for it for free, no questions asked. */
export const FREE_SYNC_EMAIL = 'steve@factwright.com';
