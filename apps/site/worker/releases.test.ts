import { describe, expect, it } from 'vitest';
import { downloadLink } from './downloads.ts';
import {
  DOWNLOADS,
  describeRelease,
  type Fetcher,
  fillDownloadPage,
  installerUrl,
  newestRelease,
  readFeed,
  releaseLine,
} from './releases.ts';

/**
 * The Mac's feed, as electron-builder writes it: the zip that updates download, then the disk
 * image people download, with notes that happen to hold a line like a key.
 */
const MAC_FEED = `version: 0.1.0
files:
  - url: Factwright-0.1.0-mac.zip
    sha512: emlw
    size: 221000000
    blockMapSize: 230000
  - url: Factwright-0.1.0.dmg
    sha512: ZG1n
    size: 231456789
path: Factwright-0.1.0-mac.zip
sha512: emlw
releaseNotes: |-
  - The first release.
  version: 9.9.9
releaseDate: '2026-10-13T15:04:05.000Z'
`;

const WINDOWS_FEED = `version: 0.1.0
files:
  - url: Factwright-Setup-0.1.0.exe
    sha512: ZXhl
    size: 112300000
path: Factwright-Setup-0.1.0.exe
sha512: ZXhl
releaseDate: '2026-10-13T15:04:05.000Z'
`;

describe('reading a feed', () => {
  it('reads the version, the date, and the size of the installer people download', () => {
    expect(readFeed(MAC_FEED, 'mac')).toEqual({
      version: '0.1.0',
      date: '2026-10-13T15:04:05.000Z',
      size: 231_456_789,
    });
    expect(readFeed(WINDOWS_FEED, 'windows')).toEqual({
      version: '0.1.0',
      date: '2026-10-13T15:04:05.000Z',
      size: 112_300_000,
    });
  });

  it('does without a size or a date it can’t find', () => {
    expect(readFeed('version: "0.2.0"\nreleaseDate: soon\n', 'windows')).toEqual({
      version: '0.2.0',
      date: null,
      size: null,
    });
  });

  it('shows only a version as releases are tagged', () => {
    expect(readFeed('version: 0.2.0-beta.1\n', 'mac')?.version).toBe('0.2.0-beta.1');
    for (const version of ['', 'latest', '1.2', '0.1.0<b>', "0.1.0' onload='x"]) {
      expect(readFeed(`version: ${version}\n`, 'mac'), version).toBeNull();
    }
    expect(readFeed('Not found', 'mac')).toBeNull();
  });
});

describe('the newest release', () => {
  it('reads each computer’s feed, kept for a minute', async () => {
    const asked: { url: string; init: RequestInit }[] = [];
    const fetcher: Fetcher = async (url, init) => {
      asked.push({ url: url.toString(), init });
      return new Response(url.pathname === '/latest.yml' ? WINDOWS_FEED : MAC_FEED);
    };
    expect((await newestRelease('mac', fetcher))?.size).toBe(231_456_789);
    expect((await newestRelease('windows', fetcher))?.size).toBe(112_300_000);
    expect(asked.map((each) => each.url)).toEqual([
      `${DOWNLOADS}latest-mac.yml`,
      `${DOWNLOADS}latest.yml`,
    ]);
    expect(asked[0]?.init.cf).toMatchObject({ cacheTtl: 60 });
    expect(asked[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('is unknown when there’s no feed yet, or it can’t be reached', async () => {
    expect(await newestRelease('mac', async () => new Response('', { status: 404 }))).toBeNull();
    expect(
      await newestRelease('mac', async () => {
        throw new Error('The operation was aborted due to timeout');
      }),
    ).toBeNull();
  });
});

describe('a download page', () => {
  const page = [
    `<a href="${downloadLink('mac')}" data-direct>Download for Mac</a>`,
    releaseLine('mac'),
    `<a href="${downloadLink('windows')}">Download for Windows</a>`,
    releaseLine('windows'),
  ].join('\n');

  it('says which version it offers, and leaves its links to the Worker', () => {
    const filled = fillDownloadPage(page, { mac: readFeed(MAC_FEED, 'mac') });
    expect(filled).toContain(
      '<p class="get-meta" data-release="mac">Version 0.1.0 · 231 MB · October 13, 2026</p>',
    );
    expect(filled).toContain('<a href="/download/get/mac" data-direct>');
  });

  it('says no version for a computer without a release', () => {
    expect(fillDownloadPage(page, { mac: null })).toBe(page);
  });

  it('fills in both computers on the page that picks', () => {
    const filled = fillDownloadPage(page, {
      mac: readFeed(MAC_FEED, 'mac'),
      windows: readFeed(WINDOWS_FEED, 'windows'),
    });
    expect(filled).toContain('data-release="mac">Version 0.1.0 · 231 MB · October 13, 2026');
    expect(filled).toContain('data-release="windows">Version 0.1.0 · 112 MB · October 13, 2026');
  });

  it('describes a release with what it knows', () => {
    expect(describeRelease({ version: '0.2.0', date: null, size: null })).toBe('Version 0.2.0');
    expect(describeRelease({ version: '0.2.0', date: null, size: 400_000 })).toBe(
      'Version 0.2.0 · 1 MB',
    );
  });
});

describe('an installer', () => {
  it('is the release’s own file, or the newest, under the name that never changes', () => {
    expect(installerUrl('mac', readFeed(MAC_FEED, 'mac'))).toBe(
      'https://downloads.factwright.com/Factwright-0.1.0.dmg',
    );
    expect(installerUrl('windows', readFeed(WINDOWS_FEED, 'windows'))).toBe(
      'https://downloads.factwright.com/Factwright-Setup-0.1.0.exe',
    );
    expect(installerUrl('mac', null)).toBe('https://downloads.factwright.com/Factwright.dmg');
    expect(installerUrl('windows', null)).toBe(
      'https://downloads.factwright.com/Factwright-Setup.exe',
    );
  });
});
