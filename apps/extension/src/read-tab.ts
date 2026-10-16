import { isLinkedIn } from '@factwright/core';
import { ext, type Tab } from './ext.ts';
import { type PageJob, readJobPage } from './page/read-job.ts';
import { settings } from './settings.ts';
import { jobFromTab } from './tab-job.ts';

/** Why a page's posting wasn't read: LinkedIn's, when you chose the link alone, or one that can't be. */
export type Unread = 'linkedin-link-only' | 'unreadable' | null;

/** Whether a tab shows a web page, which is all the extension saves. */
export const isWebPage = (href: string | undefined) => /^https?:\/\//i.test(href ?? '');

/**
 * The job on a tab: read from the page, which the browser lets the extension do once you've
 * clicked to save it, or from its address and title alone when it can't be read, or it's
 * LinkedIn's and you chose to save LinkedIn jobs by their link.
 */
export async function readTab(tab: Tab): Promise<{ page: PageJob; unread: Unread }> {
  const href = tab.url ?? '';
  const title = tab.title ?? '';
  if (isLinkedIn(href) && !(await settings()).linkedInText) {
    return { page: jobFromTab(href, title), unread: 'linkedin-link-only' };
  }
  if (tab.id !== undefined) {
    try {
      const [first] = await ext.scripting.executeScript({
        target: { tabId: tab.id },
        func: readJobPage,
      });
      if (first?.result) return { page: first.result, unread: null };
    } catch {
      // Pages the browser keeps extensions out of, such as its own store, or a PDF.
    }
  }
  return { page: jobFromTab(href, title), unread: 'unreadable' };
}
