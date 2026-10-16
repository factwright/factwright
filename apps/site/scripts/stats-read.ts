import {
  DOWNLOADS_DATASET,
  DOWNLOADS_SQL,
  type DownloadRow,
  type Stats,
  SYNC_DATASET,
  SYNC_SQL,
  type SyncDay,
  type SyncTotals,
} from './stats-report.ts';

/** Cloudflare's API. */
export const API = 'https://api.cloudflare.com/client/v4';

/** The one permission the stats command's token needs, and the only one it should have. */
export const PERMISSION = 'Account Analytics Read';

/** Where the stats come from: Cloudflare's API, for one account, with a token for it. */
export interface Source {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  token: string;
  account: string;
}

/** Asks Analytics Engine, in its SQL. */
const ask = (source: Source, sql: string) =>
  source.fetch(`${API}/accounts/${source.account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${source.token}` },
    body: sql,
  });

/** Why Cloudflare's API said no, in a line, and for a token without the permission, which one. */
async function problemOf(response: Response): Promise<string> {
  const body = await response.text();
  let problem = `${response.status}: ${body.slice(0, 200)}`;
  try {
    const errors = (JSON.parse(body) as { errors?: { message?: string }[] }).errors ?? [];
    const messages = errors.map((error) => error.message).filter(Boolean);
    if (messages.length > 0) problem = `${response.status}: ${messages.join('; ')}`;
  } catch {
    // Analytics Engine says what went wrong in plain text.
  }
  const denied = response.status === 401 || response.status === 403;
  return denied ? `${problem}. The token needs ${PERMISSION}.` : problem;
}

/**
 * Whether a dataset is there yet: Analytics Engine makes one on its first count. When that can't
 * be told, it's taken to be there, so the query's own problem shows.
 */
async function hasDataset(source: Source, dataset: string): Promise<boolean> {
  const response = await ask(source, 'SHOW TABLES FORMAT JSON');
  if (!response.ok) return true;
  const { data } = (await response.json()) as { data?: Record<string, unknown>[] };
  return (data ?? []).some((row) => Object.values(row).includes(dataset));
}

/** A day or a moment as Analytics Engine gives it, such as "2026-10-15 00:00:00". */
const DATE = /^\d{4}-\d{2}-\d{2}/;

/** A row of downloads, or null if it isn't one. */
function downloadRow(row: Record<string, unknown>): DownloadRow | null {
  const downloads = Number(row.downloads);
  const { day, computer, version } = row;
  if (typeof day !== 'string' || !DATE.test(day)) return null;
  if (typeof computer !== 'string' || typeof version !== 'string') return null;
  if (!Number.isFinite(downloads) || downloads < 0) return null;
  return { day, computer, version, downloads };
}

/** The totals the report shows, from the JSON the server wrote. One it doesn't have is 0. */
const TOTALS: readonly (keyof SyncTotals)[] = [
  'accounts',
  'newAccounts',
  'newThisWeek',
  'newThisMonth',
  'usedThisWeek',
  'usedThisMonth',
  'appSignIns',
  'browserSignIns',
];

/** A day's sync totals, or null if it isn't one. */
function syncDay(row: Record<string, unknown>): SyncDay | null {
  const { timestamp, day, totals } = row;
  if (typeof timestamp !== 'string' || !DATE.test(timestamp)) return null;
  if (typeof day !== 'string' || !DATE.test(day) || typeof totals !== 'string') return null;
  let written: Record<string, unknown>;
  try {
    written = JSON.parse(totals) as Record<string, unknown>;
  } catch {
    return null;
  }
  const read = Object.fromEntries(
    TOTALS.map((name) => {
      const n = Number(written[name] ?? 0);
      return [name, Number.isFinite(n) ? n : 0];
    }),
  ) as Record<keyof SyncTotals, number>;
  return { at: timestamp, day, totals: read };
}

/**
 * What's wrong with the token or the account's ID, if anything, checked before any request.
 * Cloudflare's API tokens are one line of letters, digits, - and _, so one pasted with a line break
 * can't end up in an error, and an account's ID is 32 hex digits.
 */
export function sourceProblem(token: string, account: string): string | null {
  if (!/^[\w-]{20,}$/.test(token)) {
    return 'FACTWRIGHT_STATS_TOKEN isn’t one line of letters, digits, - and _, as Cloudflare’s tokens are.';
  }
  if (!/^[0-9a-f]{32}$/.test(account)) {
    return 'CLOUDFLARE_ACCOUNT_ID isn’t an account’s ID, which is 32 digits and letters a to f.';
  }
  return null;
}

/** What went wrong, with its cause, such as the address that couldn't be found. */
function described(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : '';
  return cause && !error.message.includes(cause) ? `${error.message}: ${cause}` : error.message;
}

/** One dataset's rows, read by a query, or why they couldn't be. */
async function rows<Row>(
  source: Source,
  dataset: string,
  sql: string,
  read: (row: Record<string, unknown>) => Row | null,
): Promise<Row[] | { problem: string }> {
  try {
    const response = await ask(source, sql);
    if (!response.ok) {
      const problem = await problemOf(response);
      return (await hasDataset(source, dataset)) ? { problem } : [];
    }
    const { data } = (await response.json()) as { data?: Record<string, unknown>[] };
    const found = (data ?? []).map(read);
    if (found.some((row) => row === null)) {
      return { problem: `Analytics Engine answered in a form this command doesn’t know.` };
    }
    return found as Row[];
  } catch (error) {
    // Whatever a request's error says, the token stays out of it.
    return { problem: described(error).replaceAll(source.token, '[the token]') };
  }
}

/** Everything the report shows: the downloads, and the sync server's daily totals. */
export async function readStats(source: Source): Promise<Stats> {
  const [downloads, sync] = await Promise.all([
    rows(source, DOWNLOADS_DATASET, DOWNLOADS_SQL, downloadRow),
    rows(source, SYNC_DATASET, SYNC_SQL, syncDay),
  ]);
  return { downloads, sync };
}
