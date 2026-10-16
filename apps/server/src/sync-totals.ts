/**
 * How much sync is used, in totals only. Once a day the server counts its accounts and sign-ins,
 * and keeps just those totals, in Cloudflare's Workers Analytics Engine, for the maker's stats
 * command (apps/site/scripts/stats.ts). The command reads the totals with a token that can read
 * analytics and nothing else, so it never needs the accounts database, where sign-ins live.
 */

const DAY_MS = 86_400_000;

/** The totals, as the server counts them each day. */
export interface SyncTotals {
  /** Every account. */
  accounts: number;
  /** Accounts made on the day before the count, in UTC. */
  newAccounts: number;
  /** Accounts made in the 7 days up to the count. */
  newThisWeek: number;
  /** Accounts made in the 30 days up to the count. */
  newThisMonth: number;
  /** Accounts with a sign-in used in the last 7 days. A sign-in notes its use at most once a day. */
  usedThisWeek: number;
  /** Accounts with a sign-in used in the last 30 days. */
  usedThisMonth: number;
  /** Sign-ins that haven't ended, made with a code in the app: about one per computer. */
  appSignIns: number;
  /** Sign-ins that haven't ended, made in a browser with GitHub or Google. */
  browserSignIns: number;
}

/** The part of the accounts database the count asks. */
interface Database {
  prepare(query: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null> };
  };
}

/** The part of an Analytics Engine dataset the count writes to. */
interface Dataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[] }): void;
}

/**
 * Every total in one query, reading each table once. Better Auth keeps its dates as ISO text, so
 * they compare as text, as the daily cleanup does. Only counts come back: no name, email, ID or
 * sign-in.
 */
export const TOTALS_SQL = `SELECT accounts, newAccounts, newThisWeek, newThisMonth,
  usedThisWeek, usedThisMonth, appSignIns, browserSignIns
FROM (
  SELECT COUNT(*) AS accounts,
    COUNT(CASE WHEN createdAt >= ?1 AND createdAt < ?2 THEN 1 END) AS newAccounts,
    COUNT(CASE WHEN createdAt > ?4 THEN 1 END) AS newThisWeek,
    COUNT(CASE WHEN createdAt > ?5 THEN 1 END) AS newThisMonth
  FROM "user"
), (
  SELECT COUNT(DISTINCT CASE WHEN updatedAt > ?4 THEN userId END) AS usedThisWeek,
    COUNT(DISTINCT CASE WHEN updatedAt > ?5 THEN userId END) AS usedThisMonth,
    COUNT(CASE WHEN via = 'device' THEN 1 END) AS appSignIns,
    COUNT(CASE WHEN via = 'web' THEN 1 END) AS browserSignIns
  FROM "session" WHERE expiresAt > ?3
)`;

/** The UTC day before a moment, such as "2026-10-15": the day a count's new accounts were made on. */
export function dayBefore(now: Date): string {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1);
  return new Date(day).toISOString().slice(0, 10);
}

/** Counts the totals as of a moment. */
export async function countSync(db: Database, now: Date): Promise<SyncTotals> {
  const start = `${dayBefore(now)}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + DAY_MS).toISOString();
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const row = await db
    .prepare(TOTALS_SQL)
    .bind(start, end, now.toISOString(), ago(7), ago(30))
    .first<Record<keyof SyncTotals, number | null>>();
  return {
    accounts: Number(row?.accounts ?? 0),
    newAccounts: Number(row?.newAccounts ?? 0),
    newThisWeek: Number(row?.newThisWeek ?? 0),
    newThisMonth: Number(row?.newThisMonth ?? 0),
    usedThisWeek: Number(row?.usedThisWeek ?? 0),
    usedThisMonth: Number(row?.usedThisMonth ?? 0),
    appSignIns: Number(row?.appSignIns ?? 0),
    browserSignIns: Number(row?.browserSignIns ?? 0),
  };
}

/**
 * Keeps one day's totals: the day its new accounts were made on, then the totals as JSON, which
 * say what each number is, so the stats command can read older days after a total is added.
 */
export function recordSyncTotals(dataset: Dataset, totals: SyncTotals, now: Date): void {
  dataset.writeDataPoint({ indexes: ['sync'], blobs: [dayBefore(now), JSON.stringify(totals)] });
}

/**
 * The daily count. Without the dataset, it counts nothing. A count that fails is written down, and
 * that day goes without, though the next day's totals cover it. It never stops the rest of the
 * daily job, such as the backup.
 */
export async function countSyncDaily(
  env: { DB: Database; SYNC_TOTALS?: Dataset },
  now: Date,
): Promise<void> {
  if (!env.SYNC_TOTALS) return;
  try {
    recordSyncTotals(env.SYNC_TOTALS, await countSync(env.DB, now), now);
  } catch (error) {
    console.error(`Counting sync's daily totals failed: ${String(error)}`);
  }
}
