// How many people download Factwright, and how many use sync: counts only, never who.
// FACTWRIGHT_STATS_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… pnpm --filter @factwright/site stats
// The token has two read permissions and nothing else: Account Analytics Read and D1 Read.
// This app's README says how to make it.
import {
  DOWNLOADS_DATASET,
  DOWNLOADS_SQL,
  type DownloadRow,
  report,
  type Stats,
  SYNC_DATABASE,
  SYNC_SQL,
  type SyncCounts,
} from './stats-report.ts';

const API = 'https://api.cloudflare.com/client/v4';

const token = process.env.FACTWRIGHT_STATS_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error(
    [
      'Set FACTWRIGHT_STATS_TOKEN to a Cloudflare API token with only Account Analytics Read and',
      'D1 Read, on the account that runs factwright.com, and CLOUDFLARE_ACCOUNT_ID to that',
      'account’s ID. apps/site/README.md says how.',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * Why Cloudflare's API said no, in a line, and for a token without the permission, which one it
 * needs.
 */
async function problemOf(response: Response, permission: string): Promise<string> {
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
  return denied ? `${problem}. The token needs ${permission}.` : problem;
}

/** Asks Analytics Engine, in its SQL. */
const analytics = (sql: string) =>
  fetch(`${API}/accounts/${account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: sql,
  });

/**
 * Whether the downloads dataset is there yet: Analytics Engine makes it on the first download it
 * counts. When that can't be told, it's taken to be there, so the query's own problem shows.
 */
async function hasDataset(): Promise<boolean> {
  const response = await analytics('SHOW TABLES FORMAT JSON');
  if (!response.ok) return true;
  const { data } = (await response.json()) as { data?: Record<string, unknown>[] };
  return (data ?? []).some((row) => Object.values(row).includes(DOWNLOADS_DATASET));
}

/** The download counts, from the site Worker's Analytics Engine dataset. */
async function downloads(): Promise<DownloadRow[] | { problem: string }> {
  const response = await analytics(DOWNLOADS_SQL);
  if (!response.ok) {
    const problem = await problemOf(response, 'Account Analytics Read');
    return (await hasDataset()) ? { problem } : [];
  }
  const { data } = (await response.json()) as { data: Record<string, string | number>[] };
  return data.map((row) => ({
    day: String(row.day),
    computer: String(row.computer),
    version: String(row.version),
    downloads: Number(row.downloads),
  }));
}

/** Runs one query on the accounts database, and gives back its rows. */
async function query<Row>(database: string, sql: string, params: string[] = []): Promise<Row[]> {
  const response = await fetch(`${API}/accounts/${account}/d1/database/${database}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  if (!response.ok) throw new Error(await problemOf(response, 'D1 Read'));
  const { result } = (await response.json()) as { result: { results: Row[] }[] };
  return result[0]?.results ?? [];
}

/** The sync counts, from the sync service's accounts database. */
async function sync(now: Date): Promise<SyncCounts | { problem: string }> {
  const found = await fetch(`${API}/accounts/${account}/d1/database?name=${SYNC_DATABASE}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!found.ok) return { problem: await problemOf(found, 'D1 Read') };
  const { result } = (await found.json()) as { result: { uuid: string; name: string }[] };
  const database = result.find((each) => each.name === SYNC_DATABASE)?.uuid;
  if (!database) return { problem: `This account has no database named ${SYNC_DATABASE}.` };

  const at = now.toISOString();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const count = async (sql: string, params: string[] = []) =>
    Number((await query<{ n: number }>(database, sql, params))[0]?.n ?? 0);
  const [accounts, newAccounts, devices, activeDevices, byWay] = await Promise.all([
    count(SYNC_SQL.accounts),
    query<{ day: string; n: number }>(database, SYNC_SQL.newAccounts, [daysAgo(14)]),
    count(SYNC_SQL.devices, [at]),
    count(SYNC_SQL.activeDevices, [at, daysAgo(7)]),
    query<{ via: string; n: number }>(database, SYNC_SQL.devicesByWay, [at]),
  ]);
  return {
    accounts,
    newAccounts: newAccounts.map(({ day, n }) => ({ day, accounts: Number(n) })),
    devices,
    activeDevices,
    byWay: byWay.map(({ via, n }) => ({ via, devices: Number(n) })),
  };
}

/** What went wrong, for the report, when it wasn't Cloudflare saying no. */
const problem = (error: unknown) => ({
  problem: error instanceof Error ? error.message : String(error),
});

const now = new Date();
const [downloadCounts, syncCounts] = await Promise.all([
  downloads().catch(problem),
  sync(now).catch(problem),
]);
const stats: Stats = { downloads: downloadCounts, sync: syncCounts };
console.log(report(stats, now));
