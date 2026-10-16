/**
 * The numbers behind `pnpm --filter @factwright/site stats`: what it asks for, and how it shows
 * them. Every query only counts. None returns a name, an email or anything else about a person.
 */

/** The Analytics Engine dataset the site's Worker counts downloads in (see wrangler.jsonc). */
export const DOWNLOADS_DATASET = 'factwright_downloads';

/** How far back the download counts go. Analytics Engine keeps each count for 3 months. */
export const DOWNLOAD_DAYS = 90;

/** Downloads per day, computer and version, over the last 90 days. */
export const DOWNLOADS_SQL = [
  "SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,",
  'blob1 AS computer, blob2 AS version, SUM(_sample_interval) AS downloads',
  `FROM ${DOWNLOADS_DATASET}`,
  `WHERE timestamp > NOW() - INTERVAL '${DOWNLOAD_DAYS}' DAY`,
  'GROUP BY day, computer, version',
  'ORDER BY day DESC',
  'FORMAT JSON',
].join(' ');

/** The sync service's accounts database (apps/server/wrangler.jsonc). */
export const SYNC_DATABASE = 'factwright';

/**
 * What the stats command asks the accounts database. Its dates are ISO text, so they compare as
 * text, as the server's own upkeep does. The `?` is a moment, also as ISO text.
 */
export const SYNC_SQL = {
  accounts: 'SELECT COUNT(*) AS n FROM "user"',
  newAccounts:
    'SELECT substr(createdAt, 1, 10) AS day, COUNT(*) AS n FROM "user" WHERE createdAt > ? GROUP BY day ORDER BY day DESC',
  devices: 'SELECT COUNT(*) AS n FROM "session" WHERE expiresAt > ?',
  activeDevices: 'SELECT COUNT(*) AS n FROM "session" WHERE expiresAt > ? AND updatedAt > ?',
  devicesByWay:
    'SELECT COALESCE(via, \'unknown\') AS via, COUNT(*) AS n FROM "session" WHERE expiresAt > ? GROUP BY via ORDER BY n DESC',
} as const;

/** One day's downloads of one version, for one computer. */
export interface DownloadRow {
  /** The day, as the dataset gives it, such as "2026-10-15 00:00:00". */
  day: string;
  computer: string;
  version: string;
  downloads: number;
}

/** What the accounts database says, in counts. */
export interface SyncCounts {
  accounts: number;
  /** New accounts on each day of the last two weeks that had any, newest first. */
  newAccounts: { day: string; accounts: number }[];
  /** Devices signed in to sync now: computers with the app, and browsers with the web view. */
  devices: number;
  /** Of those, the ones that checked in during the last week. */
  activeDevices: number;
  /** Devices signed in, by how they signed in: "device" for the app's code, "web" for a browser. */
  byWay: { via: string; devices: number }[];
}

/** What the command found, or why it couldn't. */
export interface Stats {
  downloads: DownloadRow[] | { problem: string };
  sync: SyncCounts | { problem: string };
}

const COMPUTERS: Readonly<Record<string, string>> = { mac: 'Mac', windows: 'Windows' };

/** How sessions say they signed in, as the report names them (apps/server/src/auth-options.ts). */
const WAYS: Readonly<Record<string, string>> = { device: 'In the app', web: 'In a browser' };

/** A count with its thousands marked, such as 1,234. */
const number = (n: number) => n.toLocaleString('en-US');

/** How wide a line's label is, so the counts line up. */
const LABEL_WIDTH = 34;

/** A line of the report: its label, indented a level per step, and its count lined up after. */
const line = (label: string, n: number, level = 0) =>
  `${'  '.repeat(level)}${label}`.padEnd(LABEL_WIDTH) + number(n).padStart(8);

/** A day as the report shows it, such as "Oct 15", from either form the sources give. */
const shortDay = (day: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day.slice(0, 10)}T00:00:00Z`),
  );

/** Counts summed by one field of the rows. */
function totals(rows: DownloadRow[], key: 'computer' | 'version' | 'day'): [string, number][] {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row[key], (sums.get(row[key]) ?? 0) + row.downloads);
  return [...sums];
}

/** Version numbers newest first, such as 0.10.0 before 0.9.0. "unknown" goes last. */
function byVersion([a]: [string, number], [b]: [string, number]): number {
  if (a === b) return 0;
  if (a === 'unknown') return 1;
  if (b === 'unknown') return -1;
  const parts = (version: string) => version.split(/[.-]/).map((part) => Number(part) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  return 0;
}

/** How many days of downloads the report lists one by one, newest first. */
const DAYS_LISTED = 14;

/** The downloads part of the report. */
function downloadLines(rows: DownloadRow[]): string[] {
  const total = rows.reduce((sum, row) => sum + row.downloads, 0);
  const heading = line(`Downloads, last ${DOWNLOAD_DAYS} days`, total);
  if (total === 0) return [heading];
  return [
    heading,
    '  By computer',
    ...totals(rows, 'computer')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([computer, n]) => line(COMPUTERS[computer] ?? computer, n, 2)),
    '  By version',
    ...totals(rows, 'version')
      .sort(byVersion)
      .map(([version, n]) => line(version === 'unknown' ? 'Unknown' : version, n, 2)),
    `  By day, newest first (the last ${DAYS_LISTED} with any)`,
    ...totals(rows, 'day')
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, DAYS_LISTED)
      .map(([day, n]) => line(shortDay(day), n, 2)),
  ];
}

/** The sync part of the report. */
function syncLines(sync: SyncCounts, now: Date): string[] {
  const lastWeek = sync.newAccounts
    .filter((each) => now.getTime() - Date.parse(`${each.day}T00:00:00Z`) < 7 * 86_400_000)
    .reduce((sum, each) => sum + each.accounts, 0);
  return [
    line('Sync accounts', sync.accounts),
    line('New in the last week', lastWeek, 1),
    line('Devices signed in', sync.devices),
    ...sync.byWay.map(({ via, devices }) => line(WAYS[via] ?? via, devices, 1)),
    line('Used in the last week', sync.activeDevices, 1),
    ...(sync.newAccounts.length > 0
      ? [
          '  New accounts by day, newest first',
          ...sync.newAccounts.map(({ day, accounts }) => line(shortDay(day), accounts, 2)),
        ]
      : []),
  ];
}

/** The report the stats command prints. */
export function report(stats: Stats, now: Date): string {
  const today = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
    now,
  );
  return [
    `Factwright stats, ${today}`,
    '',
    ...('problem' in stats.downloads
      ? [`Downloads: couldn’t read them. ${stats.downloads.problem}`]
      : downloadLines(stats.downloads)),
    '',
    ...('problem' in stats.sync
      ? [`Sync: couldn’t read it. ${stats.sync.problem}`]
      : syncLines(stats.sync, now)),
    '',
    'Counts only, never who. The app itself reports nothing, so someone who never turns on sync',
    'shows up only as a download.',
  ].join('\n');
}
