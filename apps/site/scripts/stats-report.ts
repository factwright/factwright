/**
 * The numbers behind `pnpm --filter @factwright/site stats`: what it asks Workers Analytics Engine
 * for, and how it shows the answers. Every dataset holds counts only, never anything about a
 * person: the site's Worker counts each download, the Worker on downloads.factwright.com counts
 * installed copies' looks for an update and the updates they pick up, and the sync server counts
 * its totals once a day.
 */

/** The dataset the site's Worker counts downloads in (wrangler.jsonc here). */
export const DOWNLOADS_DATASET = 'factwright_downloads';

/** The dataset the sync server keeps each day's totals in (apps/server/wrangler.jsonc). */
export const SYNC_DATASET = 'factwright_sync';

/**
 * The dataset the Worker on downloads.factwright.com counts installed copies' looks for an update
 * and the updates they pick up in (wrangler.updates.jsonc here).
 */
export const UPDATES_DATASET = 'factwright_updates';

/** How far back the downloads go. Analytics Engine keeps everything for 3 months. */
export const DOWNLOAD_DAYS = 90;

/** How far back the sync totals go: enough for a month of new accounts. */
export const SYNC_DAYS = 31;

/** How far back the copies open go, a day at a time. */
export const LOOK_DAYS = 14;

/** How often an open copy looks for an update (`CHECK_EVERY_MS` in the desktop app). */
const LOOK_EVERY_MINUTES = 10;

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

/**
 * Installed copies' looks for an update, per 10 minutes and computer. An open copy looks every 10
 * minutes, so a 10 minutes' looks are about how many copies were open then.
 */
export const LOOKS_SQL = [
  `SELECT toStartOfInterval(timestamp, INTERVAL '${LOOK_EVERY_MINUTES}' MINUTE) AS slot,`,
  'blob2 AS computer, SUM(_sample_interval) AS looks',
  `FROM ${UPDATES_DATASET}`,
  `WHERE blob1 = 'look' AND timestamp > NOW() - INTERVAL '${LOOK_DAYS}' DAY`,
  'GROUP BY slot, computer',
  'ORDER BY slot DESC',
  'FORMAT JSON',
].join(' ');

/** The copies that picked up each version, per computer. */
export const PICKUPS_SQL = [
  'SELECT blob3 AS version, blob2 AS computer, SUM(_sample_interval) AS copies',
  `FROM ${UPDATES_DATASET}`,
  `WHERE blob1 = 'pickup' AND timestamp > NOW() - INTERVAL '${DOWNLOAD_DAYS}' DAY`,
  'GROUP BY version, computer',
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
  /** Accounts made in the 7 days up to the count, and in the 30 days up to it. */
  newThisWeek: number;
  newThisMonth: number;
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

/** Installed copies' looks for an update in 10 minutes, on one computer. */
export interface LookRow {
  /** When the 10 minutes began, in UTC, as Analytics Engine gives it: "2026-10-27 15:10:00". */
  slot: string;
  computer: string;
  looks: number;
}

/** The copies that picked up a version, on one computer. */
export interface PickupRow {
  version: string;
  computer: string;
  copies: number;
}

/** What the command found, or why it couldn't. */
export interface Stats {
  downloads: DownloadRow[] | { problem: string };
  looks: LookRow[] | { problem: string };
  pickups: PickupRow[] | { problem: string };
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

/** A moment as Analytics Engine gives one, such as "2026-10-27 15:10:00", in UTC. */
const engineMoment = (at: Date) => at.toISOString().slice(0, 19).replace('T', ' ');

/**
 * The open copies part of the report, from their looks for an update: those open in the last full
 * 10 minutes, and for each day, the most open at once and the hours they were open.
 */
function openLines(rows: LookRow[], now: Date): string[] {
  if (rows.length === 0) {
    return [
      `Copies open: no looks for an update in the last ${LOOK_DAYS} days. The Worker on downloads.factwright.com counts them.`,
    ];
  }
  const slotMs = LOOK_EVERY_MINUTES * 60 * 1000;
  const lastFull = engineMoment(new Date(Math.floor(now.getTime() / slotMs) * slotMs - slotMs));
  const latest = rows.filter((row) => row.slot === lastFull);
  const slots = new Map<string, number>();
  for (const row of rows) slots.set(row.slot, (slots.get(row.slot) ?? 0) + row.looks);
  const days = new Map<string, { most: number; looks: number }>();
  for (const [slot, looks] of slots) {
    const day = days.get(slot.slice(0, 10)) ?? { most: 0, looks: 0 };
    days.set(slot.slice(0, 10), { most: Math.max(day.most, looks), looks: day.looks + looks });
  }
  const newestDays = [...days].sort(([a], [b]) => b.localeCompare(a)).slice(0, DAYS_LISTED);
  const looksPerHour = 60 / LOOK_EVERY_MINUTES;
  return [
    'Copies open, as their looks for an update count them',
    line(
      `In the last full ${LOOK_EVERY_MINUTES} minutes`,
      latest.reduce((sum, row) => sum + row.looks, 0),
      1,
    ),
    ...latest
      .sort((a, b) => a.computer.localeCompare(b.computer))
      .map((row) => line(COMPUTERS[row.computer] ?? row.computer, row.looks, 2)),
    `  Most open at once, by UTC day, the last ${DAYS_LISTED} with any, newest first`,
    ...newestDays.map(([day, { most }]) => line(shortDay(day), most, 2)),
    `  Hours open, by UTC day, the last ${DAYS_LISTED} with any, newest first`,
    ...newestDays.map(([day, { looks }]) =>
      line(shortDay(day), Math.round(looks / looksPerHour), 2),
    ),
  ];
}

/** The updates part of the report: the copies that picked up each version, newest first. */
function pickupLines(rows: PickupRow[]): string[] {
  const total = rows.reduce((sum, row) => sum + row.copies, 0);
  const heading = line(`Updates picked up, last ${DOWNLOAD_DAYS} days`, total);
  if (total === 0) return [heading];
  const versions = new Map<string, number>();
  for (const row of rows) versions.set(row.version, (versions.get(row.version) ?? 0) + row.copies);
  return [
    heading,
    ...[...versions].sort(byVersion).flatMap(([version, copies]) => [
      line(version, copies, 1),
      ...rows
        .filter((row) => row.version === version)
        .sort((a, b) => a.computer.localeCompare(b.computer))
        .map((row) => line(COMPUTERS[row.computer] ?? row.computer, row.copies, 2)),
    ]),
  ];
}

/**
 * The sync part of the report, from the newest totals, and each day's new accounts. A day the
 * server counted twice, as when its daily job ran again, shows its newest count once.
 */
function syncLines(rows: SyncDay[]): string[] {
  const newestFirst = [...rows].sort((a, b) => b.at.localeCompare(a.at));
  const days = newestFirst.filter(
    (each, at) => newestFirst.findIndex((other) => other.day === each.day) === at,
  );
  const [newest] = days;
  if (!newest) {
    return [
      `Sync: no totals in the last ${SYNC_DAYS} days. The sync server counts them once a day, at 04:17 UTC.`,
    ];
  }
  const latest = newest.totals;
  return [
    `Sync, as the server counted it on ${moment(newest.at)}`,
    line('Accounts', latest.accounts, 1),
    line('New in the last 7 days', latest.newThisWeek, 2),
    line('New in the last 30 days', latest.newThisMonth, 2),
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
    ...('problem' in stats.looks
      ? [`Copies open: couldn’t read them. ${stats.looks.problem}`]
      : openLines(stats.looks, now)),
    '',
    ...('problem' in stats.pickups
      ? [`Updates picked up: couldn’t read them. ${stats.pickups.problem}`]
      : pickupLines(stats.pickups)),
    '',
    ...('problem' in stats.sync
      ? [`Sync: couldn’t read it. ${stats.sync.problem}`]
      : syncLines(stats.sync)),
    '',
    'Counts only, never who. The app itself reports nothing: the download site counts its looks for',
    'an update, by computer, and the updates it picks up, by computer and version. The counts are a',
    'guide: copies before 0.18.1 also look each time you switch back to them, and an update',
    'downloaded again counts again.',
  ].join('\n');
}
