import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API, readStats, type Source, sourceProblem } from '../scripts/stats-read.ts';
import {
  byVersion,
  DOWNLOADS_DATASET,
  DOWNLOADS_SQL,
  type DownloadRow,
  LOOKS_SQL,
  type LookRow,
  PICKUPS_SQL,
  type PickupRow,
  report,
  SYNC_DATASET,
  SYNC_SQL,
  type SyncDay,
  type SyncTotals,
  UPDATES_DATASET,
} from '../scripts/stats-report.ts';

const NOW = new Date('2026-10-16T18:00:00Z');

/** Downloads as Analytics Engine gives them: a row per day, computer and version. */
const DOWNLOADS: DownloadRow[] = [
  { day: '2026-10-16 00:00:00', computer: 'mac', version: '0.4.0', downloads: 3 },
  { day: '2026-10-16 00:00:00', computer: 'windows', version: '0.4.0', downloads: 5 },
  { day: '2026-10-15 00:00:00', computer: 'windows', version: '0.3.0', downloads: 2 },
  { day: '2026-10-09 00:00:00', computer: 'mac', version: 'unknown', downloads: 1 },
];

/** The sync server's totals for a day. */
const totals = (accounts: number, newAccounts: number, more: Partial<SyncTotals> = {}) => ({
  accounts,
  newAccounts,
  newThisWeek: 3,
  newThisMonth: 14,
  usedThisWeek: 8,
  usedThisMonth: 10,
  appSignIns: 11,
  browserSignIns: 9,
  ...more,
});

/** The sync server's totals, a day at a time, newest first. */
const SYNC: SyncDay[] = [
  { at: '2026-10-16 04:17:00', day: '2026-10-15', totals: totals(1234, 2) },
  { at: '2026-10-15 04:17:00', day: '2026-10-14', totals: totals(1232, 1) },
  { at: '2026-10-09 04:17:00', day: '2026-10-08', totals: totals(1231, 4) },
];

/**
 * Installed copies' looks for an update, a row per 10 minutes and computer. NOW is 18:00, so the
 * last full 10 minutes began at 17:50.
 */
const LOOKS: LookRow[] = [
  { slot: '2026-10-16 17:50:00', computer: 'mac', looks: 3 },
  { slot: '2026-10-16 17:50:00', computer: 'windows', looks: 2 },
  { slot: '2026-10-16 12:00:00', computer: 'mac', looks: 6 },
  { slot: '2026-10-16 12:00:00', computer: 'windows', looks: 1 },
  { slot: '2026-10-15 09:00:00', computer: 'windows', looks: 12 },
];

/** The copies that picked up each version, a row per computer. */
const PICKUPS: PickupRow[] = [
  { version: '0.18.0', computer: 'windows', copies: 2 },
  { version: '0.18.1', computer: 'windows', copies: 4 },
  { version: '0.18.1', computer: 'mac', copies: 8 },
];

/** The report's lines, without the spaces that line its counts up. */
const lines = (text: string) => text.split('\n').map((each) => each.trim().replace(/\s+/g, ' '));

describe('the stats report', () => {
  it('adds the downloads up by computer, by version and by UTC day', () => {
    expect(
      lines(report({ looks: [], pickups: [], downloads: DOWNLOADS, sync: SYNC }, NOW)),
    ).toEqual(
      expect.arrayContaining([
        'Factwright stats, Oct 16, 2026, 18:00 UTC',
        'Downloads, last 90 days 11',
        'Mac 4',
        'Windows 7',
        '0.4.0 8',
        '0.3.0 2',
        'Unknown 1',
        'By UTC day, the last 14 with any, newest first',
        'Oct 16 8',
        'Oct 15 2',
        'Oct 9 1',
      ]),
    );
  });

  it('counts the copies open from their looks for an update, now and by UTC day', () => {
    const text = lines(report({ downloads: [], looks: LOOKS, pickups: [], sync: [] }, NOW));
    const from = text.indexOf('Copies open, as their looks for an update count them');
    expect(from).toBeGreaterThan(-1);
    expect(text.slice(from, from + 10)).toEqual([
      'Copies open, as their looks for an update count them',
      'In the last full 10 minutes 5',
      'Mac 3',
      'Windows 2',
      'Most open at once, by UTC day, the last 14 with any, newest first',
      'Oct 16 7',
      'Oct 15 12',
      'Hours open, by UTC day, the last 14 with any, newest first',
      // 12 looks on each day, at 6 an hour.
      'Oct 16 2',
      'Oct 15 2',
    ]);
  });

  it('lists the copies that picked up each version, newest first', () => {
    const text = lines(report({ downloads: [], looks: [], pickups: PICKUPS, sync: [] }, NOW));
    const from = text.indexOf('Updates picked up, last 90 days 14');
    expect(text.slice(from, from + 6)).toEqual([
      'Updates picked up, last 90 days 14',
      '0.18.1 12',
      'Mac 8',
      'Windows 4',
      '0.18.0 2',
      'Windows 2',
    ]);
  });

  it('says when no copy has looked for an update yet', () => {
    const text = lines(report({ downloads: [], looks: [], pickups: [], sync: [] }, NOW));
    expect(text).toContain(
      'Copies open: no looks for an update in the last 14 days. The Worker on downloads.factwright.com counts them.',
    );
    expect(text).toContain('Updates picked up, last 90 days 0');
    const unread = report(
      {
        downloads: [],
        looks: { problem: 'timed out' },
        pickups: { problem: 'timed out' },
        sync: [],
      },
      NOW,
    );
    expect(unread).toContain('Copies open: couldn’t read them. timed out');
    expect(unread).toContain('Updates picked up: couldn’t read them. timed out');
  });

  it('shows the newest sync totals, and each day’s new accounts', () => {
    expect(
      lines(report({ looks: [], pickups: [], downloads: DOWNLOADS, sync: SYNC }, NOW)),
    ).toEqual(
      expect.arrayContaining([
        'Sync, as the server counted it on Oct 16, 04:17 UTC',
        'Accounts 1,234',
        'New in the last 7 days 3',
        'New in the last 30 days 14',
        'Used in the last 7 days 8',
        'Used in the last 30 days 10',
        'In the app (about one per computer) 11',
        'In a browser 9',
        'Oct 15 2',
        'Oct 14 1',
        'Oct 8 4',
      ]),
    );
  });

  it('shows a day the server counted twice once, at its newest count', () => {
    const again = { at: '2026-10-16 04:31:00', day: '2026-10-15', totals: totals(1235, 3) };
    const text = lines(
      report({ looks: [], pickups: [], downloads: [], sync: [...SYNC, again] }, NOW),
    );
    expect(text).toContain('Sync, as the server counted it on Oct 16, 04:31 UTC');
    expect(text).toContain('Accounts 1,235');
    expect(text.filter((each) => each.startsWith('Oct 15 '))).toEqual(['Oct 15 3']);
  });

  it('lines the counts up', () => {
    const text = report({ looks: LOOKS, pickups: PICKUPS, downloads: DOWNLOADS, sync: SYNC }, NOW);
    const ends = text
      .split('\n')
      .filter((each) => /\d$/.test(each) && !/^(Factwright|Sync,)/.test(each))
      .map((each) => each.length);
    expect(new Set(ends).size).toBe(1);
  });

  it('says plainly when there’s nothing to count yet', () => {
    const text = lines(report({ looks: [], pickups: [], downloads: [], sync: [] }, NOW));
    expect(text).toContain('Downloads, last 90 days 0');
    expect(text).not.toContain('By computer');
    expect(text).toContain(
      'Sync: no totals in the last 31 days. The sync server counts them once a day, at 04:17 UTC.',
    );
  });

  it('says what it couldn’t read, and still shows the rest', () => {
    const text = report(
      { looks: [], pickups: [], downloads: { problem: '403: Authentication error' }, sync: SYNC },
      NOW,
    );
    expect(text).toContain('Downloads: couldn’t read them. 403: Authentication error');
    expect(text).toContain('Accounts');
    expect(
      report({ looks: [], pickups: [], downloads: DOWNLOADS, sync: { problem: 'timed out' } }, NOW),
    ).toContain('Sync: couldn’t read it. timed out');
  });

  it('shows a day it can’t read as it came, rather than stopping', () => {
    const odd = [{ ...DOWNLOADS[0], day: 'someday' } as DownloadRow];
    expect(lines(report({ looks: [], pickups: [], downloads: odd, sync: [] }, NOW))).toContain(
      'someday 3',
    );
  });
});

describe('versions, newest first', () => {
  const sorted = (versions: string[]) =>
    versions
      .map((version): [string, number] => [version, 1])
      .sort(byVersion)
      .map(([version]) => version);

  it('go by number rather than as text, with unknown last', () => {
    expect(sorted(['0.9.0', 'unknown', '0.10.0', '0.10.1'])).toEqual([
      '0.10.1',
      '0.10.0',
      '0.9.0',
      'unknown',
    ]);
  });

  it('put a release before the betas that led up to it', () => {
    expect(sorted(['0.2.0-beta.1', '0.2.0', '0.2.0-beta.10', '0.1.9'])).toEqual([
      '0.2.0',
      '0.2.0-beta.10',
      '0.2.0-beta.1',
      '0.1.9',
    ]);
  });
});

describe('the stats queries', () => {
  it('only read, and only from the three datasets that count', () => {
    for (const sql of [DOWNLOADS_SQL, LOOKS_SQL, PICKUPS_SQL, SYNC_SQL]) {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
      expect(sql).not.toContain('*');
    }
    expect(DOWNLOADS_SQL).toContain(`FROM ${DOWNLOADS_DATASET}`);
    expect(LOOKS_SQL).toContain(`FROM ${UPDATES_DATASET}`);
    expect(PICKUPS_SQL).toContain(`FROM ${UPDATES_DATASET}`);
    expect(SYNC_SQL).toContain(`FROM ${SYNC_DATASET}`);
  });

  it('weigh each look and update picked up by how Analytics Engine sampled it', () => {
    expect(LOOKS_SQL).toContain('SUM(_sample_interval) AS looks');
    expect(PICKUPS_SQL).toContain('SUM(_sample_interval) AS copies');
    // The counter on downloads.factwright.com names them so (worker/updates.ts).
    expect(LOOKS_SQL).toContain("blob1 = 'look'");
    expect(PICKUPS_SQL).toContain("blob1 = 'pickup'");
  });

  it('weigh each download by how Analytics Engine sampled it', () => {
    expect(DOWNLOADS_SQL).toContain('SUM(_sample_interval)');
  });

  it('read the datasets the site and the sync server write to', () => {
    const config = (app: string) =>
      readFileSync(new URL(`../../${app}/wrangler.jsonc`, import.meta.url), 'utf8');
    expect(config('site')).toContain(
      `{ "binding": "DOWNLOADS", "dataset": "${DOWNLOADS_DATASET}" }`,
    );
    expect(config('server')).toContain(
      `{ "binding": "SYNC_TOTALS", "dataset": "${SYNC_DATASET}" }`,
    );
    expect(readFileSync(new URL('../wrangler.updates.jsonc', import.meta.url), 'utf8')).toContain(
      `{ "binding": "UPDATES", "dataset": "${UPDATES_DATASET}" }`,
    );
  });
});

/** What the stubbed API answers, by a part of the SQL it's sent. */
type Answers = Record<string, () => Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TOKEN = 'test_token-never-shown-0123456789';
const ACCOUNT = '0123456789abcdef0123456789abcdef';

/** A source whose API answers as told, noting what it was asked. */
function source(answers: Answers) {
  const asked: { url: string; init: RequestInit }[] = [];
  const stub: Source = {
    token: TOKEN,
    account: ACCOUNT,
    fetch: async (url, init) => {
      asked.push({ url, init });
      const sql = String(init.body);
      const key = Object.keys(answers).find((part) => sql.includes(part));
      return key
        ? (answers[key] as () => Response)()
        : new Response('Unknown query', { status: 422 });
    },
  };
  return { asked, stub };
}

/** A source whose every request fails the way Node's fetch does, before any answer. */
const failing = (error: Error): Source => ({
  token: TOKEN,
  account: ACCOUNT,
  fetch: async () => {
    throw error;
  },
});

describe('reading the stats', () => {
  it('asks Analytics Engine for each dataset, as the account, with the token', async () => {
    const { asked, stub } = source({
      [DOWNLOADS_DATASET]: () =>
        json({
          data: [{ day: '2026-10-16 00:00:00', computer: 'mac', version: '0.4.0', downloads: '3' }],
        }),
      [SYNC_DATASET]: () =>
        json({
          data: [
            {
              timestamp: '2026-10-16 04:17:00',
              day: '2026-10-15',
              totals: JSON.stringify(totals(5, 1)),
            },
          ],
        }),
    });
    const stats = await readStats(stub);
    expect(stats.downloads).toEqual([
      { day: '2026-10-16 00:00:00', computer: 'mac', version: '0.4.0', downloads: 3 },
    ]);
    expect(stats.sync).toEqual([
      { at: '2026-10-16 04:17:00', day: '2026-10-15', totals: totals(5, 1) },
    ]);
    for (const { url, init } of asked) {
      expect(url).toBe(`${API}/accounts/${ACCOUNT}/analytics_engine/sql`);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it('reads installed copies’ looks for an update and the updates they picked up', async () => {
    const { stub } = source({
      "blob1 = 'look'": () =>
        json({ data: [{ slot: '2026-10-16 17:50:00', computer: 'mac', looks: '3' }] }),
      "blob1 = 'pickup'": () =>
        json({ data: [{ version: '0.18.1', computer: 'windows', copies: 4 }] }),
    });
    const stats = await readStats(stub);
    expect(stats.looks).toEqual([{ slot: '2026-10-16 17:50:00', computer: 'mac', looks: 3 }]);
    expect(stats.pickups).toEqual([{ version: '0.18.1', computer: 'windows', copies: 4 }]);
  });

  it('counts nothing yet for a dataset Analytics Engine hasn’t made', async () => {
    const { stub } = source({
      'SHOW TABLES': () => json({ data: [{ dataset: DOWNLOADS_DATASET }] }),
      [DOWNLOADS_DATASET]: () => json({ data: [] }),
      [SYNC_DATASET]: () => new Response(`unknown dataset ${SYNC_DATASET}`, { status: 422 }),
    });
    expect(await readStats(stub)).toEqual({ downloads: [], looks: [], pickups: [], sync: [] });
  });

  it('says which permission a token without it needs', async () => {
    const denied = () =>
      json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403);
    const { stub } = source({
      'SHOW TABLES': denied,
      [DOWNLOADS_DATASET]: denied,
      [SYNC_DATASET]: denied,
    });
    const stats = await readStats(stub);
    expect(stats.downloads).toEqual({
      problem: '403: Authentication error. The token needs Account Analytics Read.',
    });
    expect(report(stats, NOW)).not.toContain(TOKEN);
  });

  it('turns down an answer in a form it doesn’t know, rather than showing wrong numbers', async () => {
    const { stub } = source({
      [DOWNLOADS_DATASET]: () => json({ data: [{ day: 7, downloads: 'many' }] }),
      [SYNC_DATASET]: () =>
        json({
          data: [{ timestamp: '2026-10-16 04:17:00', day: '2026-10-15', totals: 'not json' }],
        }),
    });
    const stats = await readStats(stub);
    expect(stats.downloads).toHaveProperty('problem');
    expect(stats.sync).toHaveProperty('problem');
  });

  it('reads totals that lack a count as 0', async () => {
    const { stub } = source({
      [DOWNLOADS_DATASET]: () => json({ data: [] }),
      [SYNC_DATASET]: () =>
        json({
          data: [{ timestamp: '2026-10-16 04:17:00', day: '2026-10-15', totals: '{"accounts":3}' }],
        }),
    });
    const zero = {
      newThisWeek: 0,
      newThisMonth: 0,
      usedThisWeek: 0,
      usedThisMonth: 0,
      appSignIns: 0,
      browserSignIns: 0,
    };
    expect((await readStats(stub)).sync).toEqual([
      { at: '2026-10-16 04:17:00', day: '2026-10-15', totals: totals(3, 0, zero) },
    ]);
  });

  it('says why it can’t reach Cloudflare, with the cause Node gives', async () => {
    const offline = new TypeError('fetch failed', {
      cause: new Error('getaddrinfo ENOTFOUND api.cloudflare.com'),
    });
    const problem = { problem: 'fetch failed: getaddrinfo ENOTFOUND api.cloudflare.com' };
    expect(await readStats(failing(offline))).toEqual({
      downloads: problem,
      looks: problem,
      pickups: problem,
      sync: problem,
    });
  });

  it('never shows the token, even when an error quotes it', async () => {
    const quoting = new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`);
    const stats = await readStats(failing(quoting));
    expect(report(stats, NOW)).not.toContain(TOKEN);
    expect(report(stats, NOW)).toContain('"Bearer [the token]"');
  });
});

describe('the token and the account', () => {
  it('pass as Cloudflare makes them', () => {
    expect(sourceProblem(TOKEN, ACCOUNT)).toBeNull();
  });

  it('are turned down before any request when they can’t be right', () => {
    expect(sourceProblem(`${TOKEN}\n`, ACCOUNT)).toMatch(/^FACTWRIGHT_STATS_TOKEN isn’t/);
    expect(sourceProblem('short', ACCOUNT)).toMatch(/^FACTWRIGHT_STATS_TOKEN isn’t/);
    expect(sourceProblem(TOKEN, 'acct123')).toMatch(/^CLOUDFLARE_ACCOUNT_ID isn’t/);
    expect(sourceProblem(TOKEN, `${ACCOUNT}/../zones`)).toMatch(/^CLOUDFLARE_ACCOUNT_ID isn’t/);
  });
});
