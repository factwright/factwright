import { type Computer, newestRelease, type Release } from './releases.ts';

/**
 * The ID every installed copy of Factwright sends with its update requests, the same for every
 * install (`NO_INSTALL_ID` in apps/desktop/src/main/updates.ts), so they can be told from a
 * browser's download or anything else that reads the update files.
 */
export const INSTALLED_COPY = '00000000-0000-0000-0000-000000000000';

/** The header electron-updater sends that ID in. */
const INSTALL_HEADER = 'x-user-staging-id';

/**
 * What an installed copy asked downloads.factwright.com for, as far as counting goes: a look at its
 * computer's update feed, the map of an update's blocks, which a copy that has the last update
 * fetches before downloading only the parts that changed, or a whole update file.
 */
export type UpdateRequest =
  | { kind: 'look'; computer: Computer }
  | { kind: 'blockmap' | 'file'; computer: Computer; version: string };

/** Each computer's update feed, as the release workflow names it. */
const FEEDS: Readonly<Record<string, Computer>> = {
  '/latest-mac.yml': 'mac',
  '/latest.yml': 'windows',
};

/** A version as releases are tagged, such as 0.18.1 or 0.19.0-beta.1. */
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

/** The files an update downloads: the Mac's zip and Windows's installer, with or without .blockmap. */
const UPDATE_FILES: readonly [Computer, RegExp][] = [
  ['mac', new RegExp(`^/Factwright-(${VERSION})-mac\\.zip(\\.blockmap)?$`)],
  ['windows', new RegExp(`^/Factwright-Setup-(${VERSION})\\.exe(\\.blockmap)?$`)],
];

/** What an installed copy's request was for, or null for anything else, which isn't counted. */
export function updateRequest(request: Request): UpdateRequest | null {
  if (request.method !== 'GET' || request.headers.get(INSTALL_HEADER) !== INSTALLED_COPY) {
    return null;
  }
  const { pathname } = new URL(request.url);
  const feed = FEEDS[pathname];
  if (feed) return { kind: 'look', computer: feed };
  for (const [computer, file] of UPDATE_FILES) {
    const match = file.exec(pathname);
    if (!match?.[1]) continue;
    // A download of only the parts that changed asks for them a range at a time. It's counted by
    // its block map, fetched once before them.
    if (!match[2] && request.headers.has('Range')) return null;
    return { kind: match[2] ? 'blockmap' : 'file', computer, version: match[1] };
  }
  return null;
}

/**
 * Whether a request is a copy picking up an update: the newest version's block map, or on a Mac,
 * its whole zip, which a Mac downloads when it doesn't have the last update to build on. Windows
 * always fetches the block map first, so its whole installer, which follows only when building on
 * the last one didn't work, isn't counted again. An older version's block map is the one a copy
 * builds on, not one it's picking up.
 */
export function isPickup(asked: UpdateRequest, newest: Release | null): boolean {
  if (asked.kind === 'look' || asked.version !== newest?.version) return false;
  return asked.kind === 'blockmap' || asked.computer === 'mac';
}

/** Where counts go, and the newest release for a computer, which tests stand in for. */
export interface Counting {
  dataset: Pick<AnalyticsEngineDataset, 'writeDataPoint'> | undefined;
  newest?: (computer: Computer) => Promise<Release | null>;
}

/**
 * Counts an installed copy's look for an update, by its computer, and its picking up an update, by
 * its computer and the version. Nothing about the copy or the person is kept: no IP address, no
 * browser and no ID. Analytics Engine notes when, as it does for every count. It runs once the
 * answer has gone, and never throws, so counting can't slow or stop an update.
 */
export async function countUpdate(
  request: Request,
  answered: Response,
  { dataset, newest = (computer) => newestRelease(computer) }: Counting,
): Promise<void> {
  try {
    if (!dataset || !answered.ok) return;
    const asked = updateRequest(request);
    if (!asked) return;
    if (asked.kind === 'look') {
      dataset.writeDataPoint({
        indexes: ['look'],
        blobs: ['look', asked.computer],
        doubles: [1],
      });
      return;
    }
    if (!isPickup(asked, await newest(asked.computer))) return;
    dataset.writeDataPoint({
      indexes: ['pickup'],
      blobs: ['pickup', asked.computer, asked.version],
      doubles: [1],
    });
  } catch {
    // Counting is never worth an update.
  }
}
