import type { Computer } from './releases.ts';

/**
 * Where a download page's link goes to get its computer's installer. The Worker counts the
 * download there, then sends the browser on to the installer itself.
 */
export const downloadLink = (computer: Computer) => `/download/get/${computer}`;

/** The counted download addresses, and the computer each is for. */
export const COUNTED_DOWNLOADS: ReadonlyMap<string, Computer> = new Map([
  [downloadLink('mac'), 'mac'],
  [downloadLink('windows'), 'windows'],
]);

/** Counts one download. Tests stand in for it. */
export type Count = (computer: Computer, version: string | null) => void;

/**
 * Counts one download of a computer's installer, by computer and version only. Nothing about who
 * downloaded it is kept: no IP address, browser or ID. Without the dataset it counts nothing, and a
 * count that fails never stops the download.
 */
export function countDownload(
  dataset: Pick<AnalyticsEngineDataset, 'writeDataPoint'> | undefined,
  computer: Computer,
  version: string | null,
): void {
  try {
    dataset?.writeDataPoint({
      indexes: [computer],
      blobs: [computer, version ?? 'unknown'],
      doubles: [1],
    });
  } catch {
    // The download matters more than the count.
  }
}

/** The headers a browser marks a prefetch or a prerender with, which no one may ever open. */
const PREFETCH_HEADERS = ['Sec-Purpose', 'Purpose', 'X-Moz'];

/**
 * Whether a request is someone following a link, as browsers mark it, rather than a page's own
 * script or a prefetch. A request that doesn't say, from an older browser or a download tool,
 * counts too.
 */
export function isFollowedLink(request: Request): boolean {
  const mode = request.headers.get('Sec-Fetch-Mode');
  const prefetch = PREFETCH_HEADERS.some((name) =>
    request.headers.get(name)?.toLowerCase().includes('prefetch'),
  );
  return (mode === null || mode === 'navigate') && !prefetch;
}
