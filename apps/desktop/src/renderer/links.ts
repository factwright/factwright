/**
 * Sends every link to the user's own browser, whatever's held down. To Chromium, a click or Enter
 * on a link with Alt or Option held means "download this", so the window would ask for it itself,
 * which it mustn't (main/security.ts). Opened this way, it goes as any other link does.
 */
export function openLinksInBrowser(page: Document): void {
  page.addEventListener(
    'click',
    (event) => {
      if (!event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!link) return;
      event.preventDefault();
      window.open(link.href, '_blank', 'noreferrer');
    },
    // First, so no part of a page can leave it for Chromium to act on.
    true,
  );
}
