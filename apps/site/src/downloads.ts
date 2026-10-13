/** A computer Factwright runs on. */
export type Computer = 'mac' | 'windows';

/** What the browser says about the computer it's on. */
export type Browser = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> & {
  userAgentData?: { platform?: string };
};

/**
 * The computer the page is on, as the browser says, which picks the download to offer first.
 * A phone or tablet can't run Factwright, so it gets null and sees both, to send to its computer.
 * An iPad calls itself a Mac, but has a touch screen, which no Mac has. Plenty of Windows PCs do.
 */
export function platform(browser: Browser): Computer | null {
  const agent = browser.userAgent.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(agent)) return null;
  const name = (browser.userAgentData?.platform || browser.platform || agent).toLowerCase();
  if (name.includes('mac')) return browser.maxTouchPoints > 1 ? null : 'mac';
  if (name.includes('win')) return 'windows';
  return null;
}

/** The download page for a computer: it starts the download, and says how to install it. */
export const downloadPage = (computer: Computer) => `/download/${computer}`;

/** How long a download page shows before its download starts, so the page is seen first. */
export const START_AFTER_MS = 600;

/**
 * Starts a download page's download a moment after it shows, by following its "Didn't start?"
 * link. Following any link first, that one or one away from the page, means it doesn't.
 */
export function startDownload(
  page: HTMLElement,
  go: (url: string) => void,
  wait = START_AFTER_MS,
): void {
  const link = page.querySelector<HTMLAnchorElement>('a[data-direct]');
  if (!link) return;
  const timer = setTimeout(() => go(link.href), wait);
  page.ownerDocument.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a[href]')) clearTimeout(timer);
  });
}

/**
 * Offers the download for the computer the page is on, with the other one as a link under it.
 * On a phone, on Linux, or without the page's script, both show as buttons.
 */
export function offerDownloads(root: HTMLElement, on: Computer): void {
  const other: Computer = on === 'mac' ? 'windows' : 'mac';
  const mine = root.querySelector<HTMLAnchorElement>(`[data-download="${on}"]`);
  const theirs = root.querySelector<HTMLAnchorElement>(`[data-download="${other}"]`);
  if (!mine || !theirs) return;
  mine.classList.replace('button-secondary', 'button-primary');
  theirs.classList.replace('button-primary', 'button-secondary');
  theirs.hidden = true;
  for (const note of root.querySelectorAll<HTMLElement>(`[data-for="${on}"]`)) note.hidden = false;
}
