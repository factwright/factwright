import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FetchDeps } from './posting.ts';
import { FetchAnswered, FetchTooBig, linkRefusal } from './safe-fetch.ts';

/** One page the tests read in a site's place: a saved page's file, or the status the site answers. */
interface TestPage {
  /** The saved page, beside the list or under it. */
  file?: string;
  /** What the site answers in place of a page, such as 403. */
  status?: number;
  /** An answer bigger than the app reads, as a big employer's whole board on Ashby. */
  tooBig?: boolean;
}

/**
 * A fetch that reads saved pages in the sites' place, for the tests' copy of the app, so no test
 * reaches a live site: each address the list names is its saved page, or the status the site
 * answers. The list is a JSON file of them by address, read again each time. A link the fetch
 * would refuse is refused as it would be, and an address the list doesn't name is a site that
 * can't be reached.
 */
export function testPages(list: string): NonNullable<FetchDeps['fetch']> {
  return async (address, json) => {
    const url = new URL(address);
    const refused = linkRefusal(url);
    if (refused) throw refused;
    const pages = JSON.parse(await readFile(list, 'utf8')) as Record<string, TestPage>;
    const page = pages[url.href];
    if (page?.status) throw new FetchAnswered(url.hostname, page.status);
    if (page?.tooBig) throw new FetchTooBig();
    if (!page?.file) throw new Error('the tests have no page for it');
    const text = await readFile(resolve(dirname(list), page.file), 'utf8');
    return json ? (JSON.parse(text) as unknown) : text;
  };
}
