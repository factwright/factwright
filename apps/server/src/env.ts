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
  /** Where the app is served, such as "https://app.factwright.com". */
  APP_URL: string;
  /** How much each account may store, in megabytes. */
  STORAGE_LIMIT_MB?: string;
  /** Sign-ins each IP address may start in a minute. Ten unless set. */
  SIGN_INS_PER_MINUTE?: string;
  /** Signs sessions and live tickets. A secret: `wrangler secret put BETTER_AUTH_SECRET`. */
  BETTER_AUTH_SECRET: string;
  /** Sign in with GitHub, once its OAuth app's ID and secret are set. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Sign in with Google, once its OAuth client's ID and secret are set. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Lets the operator restore an account's store from a backup. Unset, there's no way in. */
  ADMIN_TOKEN?: string;
  /** How much sync is used, in totals only, counted once a day (sync-totals.ts). */
  SYNC_TOTALS?: AnalyticsEngineDataset;
}

/** How much each account may store, in bytes. */
export function storageLimit(env: Pick<Env, 'STORAGE_LIMIT_MB'>): number {
  const megabytes = Number(env.STORAGE_LIMIT_MB);
  return (Number.isFinite(megabytes) && megabytes > 0 ? megabytes : 1024) * 1024 * 1024;
}
