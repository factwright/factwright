import { describe, expect, it } from 'vitest';
import {
  DOWNLOADS_SQL,
  type DownloadRow,
  report,
  SYNC_SQL,
  type SyncCounts,
} from '../scripts/stats-report.ts';

const NOW = new Date('2026-10-15T18:00:00Z');

/** Downloads as Analytics Engine gives them: a row per day, computer and version. */
const DOWNLOADS: DownloadRow[] = [
  { day: '2026-10-15 00:00:00', computer: 'mac', version: '0.4.0', downloads: 3 },
  { day: '2026-10-15 00:00:00', computer: 'windows', version: '0.4.0', downloads: 5 },
  { day: '2026-10-14 00:00:00', computer: 'windows', version: '0.3.0', downloads: 2 },
  { day: '2026-10-09 00:00:00', computer: 'mac', version: 'unknown', downloads: 1 },
];

const SYNC: SyncCounts = {
  accounts: 1234,
  newAccounts: [
    { day: '2026-10-15', accounts: 2 },
    { day: '2026-10-09', accounts: 1 },
    { day: '2026-10-05', accounts: 4 },
  ],
  devices: 9,
  activeDevices: 6,
  byWay: [
    { via: 'device', devices: 5 },
    { via: 'web', devices: 4 },
  ],
};

/** The report's lines, without the spaces that line its counts up. */
const lines = (text: string) => text.split('\n').map((each) => each.trim().replace(/\s+/g, ' '));

describe('the stats report', () => {
  it('adds the downloads up by computer, by version and by day', () => {
    expect(lines(report({ downloads: DOWNLOADS, sync: SYNC }, NOW))).toEqual(
      expect.arrayContaining([
        'Factwright stats, October 15, 2026',
        'Downloads, last 90 days 11',
        'Mac 4',
        'Windows 7',
        '0.4.0 8',
        '0.3.0 2',
        'Unknown 1',
        'Oct 15 8',
        'Oct 14 2',
        'Oct 9 1',
      ]),
    );
  });

  it('counts sync accounts and devices, with the new ones in the last week', () => {
    expect(lines(report({ downloads: DOWNLOADS, sync: SYNC }, NOW))).toEqual(
      expect.arrayContaining([
        'Sync accounts 1,234',
        'New in the last week 3',
        'Devices signed in 9',
        'In the app 5',
        'In a browser 4',
        'Used in the last week 6',
        'Oct 5 4',
      ]),
    );
  });

  it('lines the counts up', () => {
    const text = report({ downloads: DOWNLOADS, sync: SYNC }, NOW);
    const ends = text
      .split('\n')
      .filter((each) => /\d$/.test(each) && !each.startsWith('Factwright'))
      .map((each) => each.length);
    expect(new Set(ends).size).toBe(1);
  });

  it('lists versions newest first, by number rather than as text', () => {
    const rows = ['0.9.0', 'unknown', '0.10.0', '0.10.1'].map((version) => ({
      day: '2026-10-15 00:00:00',
      computer: 'mac',
      version,
      downloads: 1,
    }));
    const versions = lines(report({ downloads: rows, sync: SYNC }, NOW)).filter((each) =>
      /^(\d|Unknown)/.test(each),
    );
    expect(versions.slice(0, 4)).toEqual(['0.10.1 1', '0.10.0 1', '0.9.0 1', 'Unknown 1']);
  });

  it('says plainly when there are no downloads yet', () => {
    const text = lines(report({ downloads: [], sync: SYNC }, NOW));
    expect(text).toContain('Downloads, last 90 days 0');
    expect(text).not.toContain('By computer');
  });

  it('says what it couldn’t read, and still shows the rest', () => {
    const text = report({ downloads: { problem: '403: Authentication error' }, sync: SYNC }, NOW);
    expect(text).toContain('Downloads: couldn’t read them. 403: Authentication error');
    expect(text).toContain('Sync accounts');
    expect(report({ downloads: DOWNLOADS, sync: { problem: 'no database' } }, NOW)).toContain(
      'Sync: couldn’t read it. no database',
    );
  });

  it('shows counts, and never a name or an email', () => {
    const text = report({ downloads: DOWNLOADS, sync: SYNC }, NOW);
    expect(text).not.toMatch(/@/);
  });
});

describe('the stats queries', () => {
  it('only read, and only count', () => {
    for (const sql of [DOWNLOADS_SQL, ...Object.values(SYNC_SQL)]) {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
      expect(sql).toMatch(/\b(COUNT\(\*\)|SUM\(_sample_interval\))/);
    }
  });

  it('never ask for anything about a person', () => {
    for (const sql of Object.values(SYNC_SQL)) {
      expect(sql).not.toMatch(/\b(name|email|image|token|ipAddress|userAgent|userId)\b/);
    }
  });

  it('weigh each download by how Analytics Engine sampled it', () => {
    expect(DOWNLOADS_SQL).toContain('SUM(_sample_interval)');
    expect(DOWNLOADS_SQL).toContain('FROM factwright_downloads');
  });
});
