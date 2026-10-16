import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  countSync,
  countSyncDaily,
  dayBefore,
  recordSyncTotals,
  TOTALS_SQL,
} from '../src/sync-totals.ts';
import { startServer, type TestServer } from './server.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => server?.close());

const DAY = 86_400_000;

/** The daily job's time, the day after the accounts below were made. */
const NOW = new Date('2026-10-16T04:17:00Z');
const iso = (offset: number) => new Date(NOW.getTime() + offset).toISOString();

const insert = (sql: string, ...values: unknown[]) =>
  server.env.DB.prepare(sql)
    .bind(...values)
    .run();

/** An account made at a moment. */
const account = (id: string, made: string) =>
  insert(
    `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
     VALUES (?, 'Sam Rivera', ?, 1, NULL, ?, ?)`,
    id,
    `${id}@example.com`,
    made,
    made,
  );

/** A sign-in, last used some time before the count, that lasts 60 days from then. */
const signIn = (id: string, userId: string, via: 'web' | 'device', lastUsed: number) =>
  insert(
    `INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId, via)
     VALUES (?, ?, ?, ?, ?, NULL, 'Test', ?, ?)`,
    id,
    iso(60 * DAY - lastUsed),
    `${id}-token`,
    iso(-lastUsed),
    iso(-lastUsed),
    userId,
    via,
  );

describe('how much sync is used', () => {
  it('is counted in totals: accounts, new ones, ones used lately, and sign-ins by way', async () => {
    // Made the day before the count, from its first moment to its last.
    await account('ana', '2026-10-15T00:00:00.000Z');
    await account('ben', '2026-10-15T23:59:59.999Z');
    // Made the day before that, and on the day of the count itself.
    await account('cy', '2026-10-14T23:59:59.999Z');
    await account('di', '2026-10-16T00:30:00.000Z');
    // Ana's computer and browser, used two days ago: one account used this week.
    await signIn('ana-mac', 'ana', 'device', 2 * DAY);
    await signIn('ana-web', 'ana', 'web', 2 * DAY);
    // Ben's computer, used ten days ago: used this month, not this week.
    await signIn('ben-pc', 'ben', 'device', 10 * DAY);
    // Cy's browser, used forty days ago and still signed in.
    await signIn('cy-web', 'cy', 'web', 40 * DAY);
    // Di's computer, whose sign-in ended yesterday.
    await signIn('di-mac', 'di', 'device', 61 * DAY);

    expect(await countSync(server.env.DB, NOW)).toEqual({
      accounts: 4,
      newAccounts: 2,
      // All four were made in the last week, the last of them on the day of the count.
      newThisWeek: 4,
      newThisMonth: 4,
      usedThisWeek: 1,
      usedThisMonth: 2,
      appSignIns: 2,
      browserSignIns: 2,
    });
  });

  it('keeps one data point a day: the day its new accounts were made, and the totals', async () => {
    const written: unknown[] = [];
    const dataset = { writeDataPoint: (point: unknown) => written.push(point) };
    const totals = {
      accounts: 4,
      newAccounts: 2,
      newThisWeek: 4,
      newThisMonth: 4,
      usedThisWeek: 1,
      usedThisMonth: 2,
      appSignIns: 2,
      browserSignIns: 2,
    };
    recordSyncTotals(dataset, totals, NOW);
    expect(written).toEqual([{ indexes: ['sync'], blobs: ['2026-10-15', JSON.stringify(totals)] }]);
  });

  it('counts with the daily job, and not at all without the dataset', async () => {
    const written: unknown[] = [];
    await countSyncDaily({ DB: server.env.DB }, NOW);
    await countSyncDaily(
      { DB: server.env.DB, SYNC_TOTALS: { writeDataPoint: (point) => written.push(point) } },
      NOW,
    );
    expect(written).toHaveLength(1);
    // The Worker's own daily job runs it too, with Wrangler's stand-in for the dataset.
    await server.worker.scheduled({ cron: '17 4 * * *', scheduledTime: NOW });
  });

  it('waits for the next day when a count fails, and never fails the daily job', async () => {
    const written: unknown[] = [];
    const broken = {
      prepare: () => {
        throw new Error('D1 is down');
      },
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      countSyncDaily(
        { DB: broken, SYNC_TOTALS: { writeDataPoint: (point) => written.push(point) } },
        NOW,
      ),
    ).resolves.toBeUndefined();
    expect(written).toEqual([]);
    expect(logged).toHaveBeenCalledWith("Counting sync's daily totals failed: Error: D1 is down");
    logged.mockRestore();
  });

  it('asks only for counts, never for anything about a person', () => {
    // Each table is read once, and everything it gives back is a count.
    expect(TOTALS_SQL.match(/\bFROM\b/g)).toHaveLength(3);
    expect(TOTALS_SQL.match(/\(\s*SELECT COUNT\(/g)).toHaveLength(2);
    expect(TOTALS_SQL.match(/\bAS \w+/g)).toHaveLength(8);
    expect(TOTALS_SQL.match(/\bTHEN userId END\)/g)).toHaveLength(2);
    expect(TOTALS_SQL).not.toMatch(/\b(name|email|image|token|ipAddress|userAgent)\b/);
  });

  it('is written where the stats command reads it', () => {
    // Wrangler's stand-in for the dataset, from wrangler.jsonc: renamed, the count would stop.
    expect((server.env as unknown as Record<string, unknown>).SYNC_TOTALS).toBeDefined();
  });

  it('names the day before in UTC, across a month and a year', () => {
    expect(dayBefore(NOW)).toBe('2026-10-15');
    expect(dayBefore(new Date('2026-11-01T04:17:00Z'))).toBe('2026-10-31');
    expect(dayBefore(new Date('2027-01-01T00:00:00Z'))).toBe('2026-12-31');
  });
});
