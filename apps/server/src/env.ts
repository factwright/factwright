import type { UserStore } from './store.ts';

/** What the Worker is given: its bindings, settings and secrets. */
export interface Env {
  /** Accounts and sessions, for signing in. Nothing from anyone's job hunt is kept here. */
  DB: D1Database;
  /** Each account's locked files, under users/<account>/, and its daily backups. */
  FILES: R2Bucket;
  /** One store per account, with that account's locked records. */
  STORES: DurableObjectNamespace<UserStore>;
  /** The web view's files, once it's built. */
  ASSETS?: Fetcher;
  /**
   * Where the app is served, such as "https://app.factwright.com". Unset, as on a server of your
   * own, it's the address each request came to (see appUrl).
   */
  APP_URL?: string;
  /**
   * The terms of service and privacy policy signing in agrees to. Only Factwright's own server
   * sets them. A server of your own links to none, unless you set yours.
   */
  TERMS_URL?: string;
  PRIVACY_URL?: string;
  /** How much each account may store, in megabytes. */
  STORAGE_LIMIT_MB?: string;
  /** Sign-ins each IP address may start in a minute. Ten unless set. */
  SIGN_INS_PER_MINUTE?: string;
  /** Signs sessions and live tickets. A secret: `wrangler secret put BETTER_AUTH_SECRET`. */
  BETTER_AUTH_SECRET: string;
  /** Sign in with GitHub, once its OAuth app's ID and secret are set. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /**
   * The only GitHub accounts that may sign in, by user name, separated by commas, such as
   * "octocat, hubot". A server of your own sets it, as a secret, so updating it never resets the
   * list. Unset, as on Factwright's own server, anyone can sign in (see auth-options.ts).
   */
  ALLOWED_GITHUB_USERS?: string;
  /** Sign in with Google, once its OAuth client's ID and secret are set. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Other copies of Save to Factwright that may sign in through the browser's own window, by
   * their extension ID, separated by commas: a Chrome extension's 32 letters, or a Firefox
   * add-on's ID. The stores' copies always may. Others sign in with a device code, as older
   * versions do (extension-sign-in.ts).
   */
  EXTENSION_IDS?: string;
  /** Lets the operator restore an account's store from a backup. Unset, there's no way in. */
  ADMIN_TOKEN?: string;
  /**
   * Selling sync, on Factwright's own server only (billing.ts). Stripe's restricted key and the
   * webhook's signing secret connect Stripe, so subscriptions are kept up to date and canceled with
   * their accounts. The two prices then start selling. Until all four are set, sync costs nothing
   * and nobody is asked to pay, as on a server of your own.
   */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  /**
   * When sync started being sold, as an ISO time, such as "2026-11-02T15:00:00Z". Accounts made
   * before it keep sync for good. Unset, none do.
   */
  EARLY_BEFORE?: string;
  /** Where Stripe's API is. Only the tests set it, to a stand-in. */
  STRIPE_API_URL?: string;
  /** How much sync is used, in totals only, counted once a day (sync-totals.ts). */
  SYNC_TOTALS?: AnalyticsEngineDataset;
}

/**
 * Where the app is served, as an origin: APP_URL, or else the address the request came to, such
 * as a server of your own at a free workers.dev address. Cloudflare only hands a Worker requests
 * for its own addresses, so that's always one of them.
 */
export function appUrl(env: Pick<Env, 'APP_URL'>, request: Request): string {
  return new URL(env.APP_URL || request.url).origin;
}

/** How much each account may store, in bytes. */
export function storageLimit(env: Pick<Env, 'STORAGE_LIMIT_MB'>): number {
  const megabytes = Number(env.STORAGE_LIMIT_MB);
  return (Number.isFinite(megabytes) && megabytes > 0 ? megabytes : 1024) * 1024 * 1024;
}
