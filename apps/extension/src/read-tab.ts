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
 * Applicant systems' pages that show a job's posting in a frame of a page of their own, by the
 * frame's address: iCIMS's career sites, whose page around the frame is only the company's
 * branding, show each of their pages, the posting's and the application's, in a frame from the
 * same site, with "in_iframe=1".
 */
const POSTING_FRAMES = [
  /^https:\/\/[a-z0-9-]+\.icims\.com\/jobs\/\d+\/[^?#]*\?(?:[^#]*&)?in_iframe=1(?:[&#]|$)/i,
];

/** Selected text shorter than this is likely a word or a title, not the posting (readJobPage). */
const MIN_SELECTION = 200;

/** What a frame shows, as the frame itself says: its address, and how much of its text is selected. */
function frameShows(): { href: string; selected: number } {
  return { href: location.href, selected: String(globalThis.getSelection?.() ?? '').trim().length };
}

/**
 * The job on a tab's page, with what a frame in it shows, as one job: the frame's job, where an
 * applicant system shows its posting in it, or else the page's, with the posting you selected in
 * the frame. Either way, it's the job at the tab's own address, which the frame's page is a part of.
 */
export function withFrame(page: PageJob, framed: PageJob, posting: boolean): PageJob {
  const [first, then] = posting ? [framed, page] : [page, framed];
  const selected = framed.source === 'selection';
  return {
    ...page,
    title: first.title || then.title,
    company: first.company || then.company,
    location: first.location || then.location,
    pay: first.pay || then.pay,
    employment: first.employment || then.employment,
    posted: first.posted || then.posted,
    posting: selected || posting ? framed.posting : page.posting,
    source: selected || posting ? framed.source : page.source,
  };
}

/**
 * Reads the frames of a tab, where the page you clicked on has any the browser lets the extension
 * reach: the one with the text you selected, or else an applicant system's posting. LinkedIn's
 * frames are never read, as nothing in them is the job's.
 */
async function readFrames(tabId: number, page: PageJob): Promise<PageJob> {
  if (page.source === 'selection' || isLinkedIn(page.pageUrl)) return page;
  let frames: { frameId: number; href: string; selected: number }[];
  try {
    const each = await ext.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: frameShows,
    });
    frames = each.flatMap(({ frameId, result }) =>
      frameId && result && typeof result.href === 'string' ? [{ frameId, ...result }] : [],
    );
  } catch {
    return page;
  }
  const isPosting = (href: string) => POSTING_FRAMES.some((frame) => frame.test(href));
  const frame =
    frames.find((each) => each.selected >= MIN_SELECTION) ??
    frames.find((each) => isPosting(each.href));
  if (!frame) return page;
  try {
    const [read] = await ext.scripting.executeScript({
      target: { tabId, frameIds: [frame.frameId] },
      func: readJobPage,
    });
    return read?.result ? withFrame(page, read.result, isPosting(frame.href)) : page;
  } catch {
    // The frame's gone, or shows a page of another site now.
    return page;
  }
}

/**
 * The job on a tab: read from the page, which the browser lets the extension do once you've
 * clicked to save it, with what a frame in it shows (readFrames), or from its address and title
 * alone when it can't be read, or it's LinkedIn's and you chose to save LinkedIn jobs by their
 * link.
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
      if (first?.result) return { page: await readFrames(tab.id, first.result), unread: null };
    } catch {
      // Pages the browser keeps extensions out of, such as its own store, or a PDF.
    }
  }
  return { page: jobFromTab(href, title), unread: 'unreadable' };
}

/**
 * The job a form is for: as the tab's page shows it, or, for a form in a frame of a page the
 * browser keeps the extension out of, as a company's careers page can be, as the frame's own page
 * shows it, as an applicant system's form says what it's for. The tab's page gets the frame's
 * company and job title where it doesn't say them.
 */
export async function readFormPage(tab: Tab, frameId: number): Promise<PageJob> {
  const { page, unread } = await readTab(tab);
  if (frameId === 0 || tab.id === undefined || (unread === null && page.company && page.title)) {
    return page;
  }
  try {
    const [first] = await ext.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      func: readJobPage,
    });
    const framed = first?.result;
    if (framed) {
      return unread === null
        ? { ...page, company: page.company || framed.company, title: page.title || framed.title }
        : framed;
    }
  } catch {
    // The frame's gone, or shows a page of another site now.
  }
  return page;
}

/** The company and job title a form is for, as `readFormPage` finds them. */
export async function readFormJob(
  tab: Tab,
  frameId: number,
): Promise<{ company: string; role: string }> {
  const page = await readFormPage(tab, frameId);
  return { company: page.company, role: page.title };
}
