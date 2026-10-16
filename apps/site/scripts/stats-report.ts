/**
 * The numbers behind `pnpm --filter @factwright/site stats`: what it asks Workers Analytics Engine
 * for, and how it shows the answers. Both datasets hold counts only, never anything about a person:
 * the site's Worker counts each download, and the sync server counts its totals once a day.
 */

/** The dataset the site's Worker counts downloads in (wrangler.jsonc here). */
export const DOWNLOADS_DATASET = 'factwright_downloads';

/** The dataset the sync server keeps each day's totals in (apps/server/wrangler.jsonc). */
export const SYNC_DATASET = 'factwright_sync';

/** How far back the downloads go. Analytics Engine keeps everything for 3 months. */
export const DOWNLOAD_DAYS = 90;

/** How far back the sync totals go: enough for a month of new accounts. */
export const SYNC_DAYS = 31;

/** Downloads per day, computer and version. Each count may stand for several, if it was sampled. */
export const DOWNLOADS_SQL = [
  "SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,",
  'blob1 AS computer, blob2 AS version, SUM(_sample_interval) AS downloads',
  `FROM ${DOWNLOADS_DATASET}`,
  `WHERE timestamp > NOW() - INTERVAL '${DOWNLOAD_DAYS}' DAY`,
  'GROUP BY day, computer, version',
  'ORDER BY day DESC',
  'FORMAT JSON',
].join(' ');

/** Each day's sync totals, newest first: when they were counted, their day, and the totals. */
export const SYNC_SQL = [
  'SELECT timestamp, blob1 AS day, blob2 AS totals',
  `FROM ${SYNC_DATASET}`,
  `WHERE timestamp > NOW() - INTERVAL '${SYNC_DAYS}' DAY`,
  'ORDER BY timestamp DESC',
  'FORMAT JSON',
].join(' ');

/** One day's downloads of one version, for one computer. */
export interface DownloadRow {
  /** The UTC day, as Analytics Engine gives it, such as "2026-10-15 00:00:00". */
  day: string;
  computer: string;
  version: string;
  downloads: number;
}

/** The sync server's totals for a day, as apps/server/src/sync-totals.ts counts them. */
export interface SyncTotals {
  accounts: number;
  /** Accounts made on the day the totals are for. */
  newAccounts: number;
  usedThisWeek: number;
  usedThisMonth: number;
  appSignIns: number;
  browserSignIns: number;
}

/** One day's sync totals. */
export interface SyncDay {
  /** When the server counted them, as Analytics Engine gives it, such as "2026-10-16 04:17:00". */
  at: string;
  /** The UTC day its new accounts were made on, such as "2026-10-15". */
  day: string;
  totals: SyncTotals;
}

/** What the command found, or why it couldn't. */
export interface Stats {
  downloads: DownloadRow[] | { problem: string };
  sync: SyncDay[] | { problem: string };
}

const COMPUTERS: Readonly<Record<string, string>> = { mac: 'Mac', windows: 'Windows' };

/** A count with its thousands marked, such as 1,234. */
const number = (n: number) => n.toLocaleString('en-US');

/** How wide a line's label is, so the counts line up. */
const LABEL_WIDTH = 40;

/** A line of the report: its label, indented a level per step, and its count lined up after. */
const line = (label: string, n: number, level = 0) =>
  `${'  '.repeat(level)}${label}`.padEnd(LABEL_WIDTH) + number(n).padStart(8);

/**
 * A moment or a day, in UTC, from any form the sources give: "2026-10-15", "2026-10-15 04:17:00"
 * or an ISO moment. Anything else shows as it came, so one odd value can't stop the report.
 */
function utc(value: string, options: Intl.DateTimeFormatOptions): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00Z`
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date);
}

/** A day, such as "Oct 15". */
const shortDay = (day: string) => utc(day.slice(0, 10), { month: 'short', day: 'numeric' });

/** A moment, such as "Oct 16, 04:17 UTC", with the year too if asked. */
const moment = (at: string, year?: 'numeric') =>
  `${utc(at, { year, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} UTC`;

/** Counts summed by one field of the rows. */
function totals(rows: DownloadRow[], key: 'computer' | 'version' | 'day'): [string, number][] {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row[key], (sums.get(row[key]) ?? 0) + row.downloads);
  return [...sums];
}

/**
 * Version numbers newest first, such as 0.10.0 before 0.9.0, and a release before the betas that
 * led up to it. "unknown" goes last.
 */
export function byVersion([a]: [string, number], [b]: [string, number]): number {
  if (a === b) return 0;
  if (a === 'unknown') return 1;
  if (b === 'unknown') return -1;
  const [coreA = '', preA = ''] = a.split(/-(.*)/);
  const [coreB = '', preB = ''] = b.split(/-(.*)/);
  const x = coreA.split('.').map(Number);
  const y = coreB.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  if (!preA) return -1;
  if (!preB) return 1;
  return preB.localeCompare(preA, 'en', { numeric: true });
}

/** How many days the report lists one by one, newest first. */
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
    `  By UTC day, the last ${DAYS_LISTED} with any, newest first`,
    ...totals(rows, 'day')
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, DAYS_LISTED)
      .map(([day, n]) => line(shortDay(day), n, 2)),
  ];
}

/** The sync part of the report, from the newest day's totals and the days before it. */
function syncLines(days: SyncDay[]): string[] {
  const [newest] = days;
  if (!newest) {
    return ['Sync: no totals yet. The sync server counts them once a day, at 04:17 UTC.'];
  }
  const latest = newest.totals;
  /** New accounts on the newest day and the ones before it, over so many days. */
  const newOver = (count: number) => {
    const from = Date.parse(`${newest.day}T00:00:00Z`) - (count - 1) * 86_400_000;
    return days
      .filter((each) => Date.parse(`${each.day}T00:00:00Z`) >= from)
      .reduce((sum, each) => sum + each.totals.newAccounts, 0);
  };
  return [
    `Sync, as the server counted it on ${moment(newest.at)}`,
    line('Accounts', latest.accounts, 1),
    line('New in the last 7 days', newOver(7), 2),
    line('New in the last 30 days', newOver(30), 2),
    line('Used in the last 7 days', latest.usedThisWeek, 2),
    line('Used in the last 30 days', latest.usedThisMonth, 2),
    '  Signed in now',
    line('In the app (about one per computer)', latest.appSignIns, 2),
    line('In a browser', latest.browserSignIns, 2),
    `  New accounts by UTC day, the last ${DAYS_LISTED}, newest first`,
    ...days
      .slice(0, DAYS_LISTED)
      .map((each) => line(shortDay(each.day), each.totals.newAccounts, 2)),
  ];
}

/** The report the stats command prints. */
export function report(stats: Stats, now: Date): string {
  return [
    `Factwright stats, ${moment(now.toISOString(), 'numeric')}`,
    '',
    ...('problem' in stats.downloads
      ? [`Downloads: couldn’t read them. ${stats.downloads.problem}`]
      : downloadLines(stats.downloads)),
    '',
    ...('problem' in stats.sync
      ? [`Sync: couldn’t read it. ${stats.sync.problem}`]
      : syncLines(stats.sync)),
    '',
    'Counts only, never who. The app itself reports nothing, so someone who never turns on sync',
    'shows up only as a download.',
  ].join('\n');
}
