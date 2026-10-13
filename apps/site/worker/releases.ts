/** A computer Factwright runs on, as the download pages name it. */
export type Computer = 'mac' | 'windows';

/** Where the installers and their update feeds are, as the release workflow publishes them. */
export const DOWNLOADS = 'https://downloads.factwright.com/';

/** A released version, as its update feed tells it. */
export interface Release {
  version: string;
  /** When it came out, as an ISO date. */
  date: string | null;
  /** The installer's size, in bytes. */
  size: number | null;
}

/**
 * Each computer's update feed, its installer for a version, and the name the newest installer
 * always has. The release workflow names them all.
 */
const FILES: Readonly<
  Record<Computer, { feed: string; installer: (version: string) => string; newest: string }>
> = {
  mac: {
    feed: 'latest-mac.yml',
    installer: (version) => `Factwright-${version}.dmg`,
    newest: 'Factwright.dmg',
  },
  windows: {
    feed: 'latest.yml',
    installer: (version) => `Factwright-Setup-${version}.exe`,
    newest: 'Factwright-Setup.exe',
  },
};

/** A version as releases are tagged: 0.1.0, or 0.2.0-beta.1. Anything else isn't shown. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** A value as the feed writes it, with any quotes around it taken off. */
const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2');

/** A key at the top of the feed, such as `version`, or null. */
function topValue(feed: string, key: string): string | null {
  for (const line of feed.split('\n')) {
    if (line.startsWith(`${key}:`)) return unquote(line.slice(key.length + 1));
  }
  return null;
}

/** The size the feed gives for one of its files, or null. */
function sizeOf(feed: string, file: string): number | null {
  let current: string | null = null;
  for (const line of feed.split('\n')) {
    const url = /^\s*-\s+url:(.*)$/.exec(line)?.[1];
    if (url !== undefined) {
      current = unquote(url);
      continue;
    }
    // A key at the top, such as `path`, ends the list of files.
    if (/^\S/.test(line)) current = null;
    const size = /^\s+size:\s*(\d+)\s*$/.exec(line)?.[1];
    if (size && current === file) return Number(size);
  }
  return null;
}

/**
 * What a download page needs from a computer's update feed: the newest version, when it came out,
 * and its installer's size. Null if the feed doesn't name a version as releases are tagged.
 */
export function readFeed(feed: string, computer: Computer): Release | null {
  const version = topValue(feed, 'version');
  if (!version || !VERSION.test(version)) return null;
  const date = topValue(feed, 'releaseDate');
  return {
    version,
    date: date && !Number.isNaN(Date.parse(date)) ? date : null,
    size: sizeOf(feed, FILES[computer].installer(version)),
  };
}

/** Fetches a file the way a Worker does, which tests stand in for. */
export type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;

/** How long a download page waits for a feed before it shows the page without the version. */
const FEED_WAIT_MS = 3000;

/**
 * The newest release for a computer, from its update feed, or null if the feed can't be read. A
 * feed is kept for a minute, so a new release shows on the pages within a minute, and each visit
 * doesn't read the feed again.
 */
export async function newestRelease(
  computer: Computer,
  fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<Release | null> {
  try {
    const response = await fetcher(new URL(FILES[computer].feed, DOWNLOADS), {
      signal: AbortSignal.timeout(FEED_WAIT_MS),
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    return response.ok ? readFeed(await response.text(), computer) : null;
  } catch {
    return null;
  }
}

/**
 * The installer a download page offers: the release's own file, or without a release, the newest
 * one, under the name that never changes.
 */
export function installerUrl(computer: Computer, release: Release | null): string {
  const files = FILES[computer];
  return new URL(release ? files.installer(release.version) : files.newest, DOWNLOADS).toString();
}

/** A release in a few words, such as "Version 0.1.0 · 231 MB · October 13, 2026". */
export function describeRelease(release: Release): string {
  const parts = [`Version ${release.version}`];
  if (release.size) parts.push(`${Math.max(1, Math.round(release.size / 1_000_000))} MB`);
  if (release.date) {
    parts.push(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
        new Date(release.date),
      ),
    );
  }
  return parts.join(' · ');
}

/** Text made safe to put between a page's tags. */
const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Where a download page says which version it offers, empty until the Worker fills it in. */
export const releaseLine = (computer: Computer) =>
  `<p class="get-meta" data-release="${computer}"></p>`;

/**
 * Fills a download page in with the newest release for each computer: its links to the newest
 * installer go to that version's own file, and its line for the version says which it is. For a
 * computer without a release, the page keeps its links to the newest installer, and no version.
 */
export function fillDownloadPage(
  html: string,
  releases: Partial<Record<Computer, Release | null>>,
): string {
  let page = html;
  for (const computer of ['mac', 'windows'] as const) {
    const release = releases[computer];
    if (!release) continue;
    page = page
      .replaceAll(installerUrl(computer, null), installerUrl(computer, release))
      .replaceAll(
        releaseLine(computer),
        releaseLine(computer).replace('></p>', `>${escapeHtml(describeRelease(release))}</p>`),
      );
  }
  return page;
}

/** The download pages: the one for each computer, and the one that picks, which shows both. */
export const DOWNLOAD_PAGES: ReadonlyMap<string, readonly Computer[]> = new Map([
  ['/download', ['mac', 'windows']],
  ['/download/mac', ['mac']],
  ['/download/windows', ['windows']],
]);
