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
 * downloaded it is kept: no IP address, browser or ID. Analytics Engine notes when, as it does for
 * every count. Without the dataset it counts nothing.
 */
export function countDownload(
  dataset: Pick<AnalyticsEngineDataset, 'writeDataPoint'> | undefined,
  computer: Computer,
  version: string | null,
): void {
  dataset?.writeDataPoint({
    indexes: [computer],
    blobs: [computer, version ?? 'unknown'],
    doubles: [1],
  });
}

/** The headers a browser marks a prefetch or a prerender with, which no one may ever open. */
const PREFETCH_HEADERS = ['Sec-Purpose', 'Purpose', 'X-Moz'];

/**
 * Whether a request is a person's browser following a link to the installer: a navigation of the
 * whole tab, as every current browser marks one. A page's script, a frame, a prefetch, a download
 * picking up where it left off, and anything that doesn't say how it asked, such as a link preview
 * in a chat app or a download tool, isn't counted.
 */
export function isFollowedLink(request: Request): boolean {
  const { headers } = request;
  const prefetch = PREFETCH_HEADERS.some((name) =>
    headers.get(name)?.toLowerCase().includes('prefetch'),
  );
  return (
    headers.get('Sec-Fetch-Mode') === 'navigate' &&
    headers.get('Sec-Fetch-Dest') === 'document' &&
    !headers.has('Range') &&
    !prefetch
  );
}
