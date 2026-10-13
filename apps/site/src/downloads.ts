/** A computer Factwright runs on. */
export type Computer = 'mac' | 'windows';

/** What the browser says about the computer it's on. */
export type Browser = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> & {
  userAgentData?: { platform?: string };
};

/**
 * The computer the page is on, as the browser says, which picks the download to offer first.
 * A phone or tablet can't run Factwright, so it gets null and sees both, to send to its computer.
 * An iPad calls itself a Mac, but has a touch screen.
 */
export function platform(browser: Browser): Computer | null {
  const agent = browser.userAgent.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(agent) || browser.maxTouchPoints > 1) return null;
  const name = (browser.userAgentData?.platform || browser.platform || agent).toLowerCase();
  if (name.includes('mac')) return 'mac';
  if (name.includes('win')) return 'windows';
  return null;
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
