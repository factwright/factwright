import { hostOf } from '@factwright/core';
import type { PageJob } from './page/read-job.ts';
import type { JobToSave } from './save.ts';

/** Query parameters that only track where a click came from (@factwright/core's links.ts). */
const TRACKING_PARAM =
  /^(utm_|ref$|src$|source$|from$|tk$|trk|rjptk|xpse|xfps|xkcb|gh_src|lever-)/i;

/**
 * A job's own address from the page's: on LinkedIn and Indeed, the job's own page, even from a
 * search that shows it, and anywhere else, the page's without tracking. readJobPage does the same
 * in the page; this is for a page the extension doesn't read.
 */
export function jobAddress(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const id =
      url.searchParams.get('currentJobId') ??
      url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
    if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
  }
  if (/(^|\.)indeed\.com$/.test(host)) {
    const key = url.searchParams.get('vjk') ?? url.searchParams.get('jk');
    if (key && /^[\w-]+$/.test(key)) return `https://${url.hostname}/viewjob?jk=${key}`;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString();
}

/**
 * A title and company from a tab's title, as job sites write them: "Staff Engineer | Northwind |
 * LinkedIn", "Staff Engineer at Northwind", or "Northwind hiring Staff Engineer in Austin".
 */
export function fromTabTitle(title: string): { role: string; company: string } {
  const plain = title
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s*[|–—-]\s*(LinkedIn|Indeed(\.com)?|Glassdoor)\s*$/i, '')
    .trim();
  const hiring = plain.match(/^(.+?) hiring (.+?)(?: in .+)?$/i);
  if (hiring?.[1] && hiring[2]) return { company: hiring[1].trim(), role: hiring[2].trim() };
  // "Role | Company" first, since a title's own dashes, as in "Engineer - Platform", aren't a split.
  const bars = plain.split(/\s+\|\s+/).filter(Boolean);
  if (bars.length >= 2) return { role: bars[0] ?? '', company: bars[1] ?? '' };
  const at = plain.replace(/^job application for /i, '').match(/^(.+?) at (.+)$/i);
  if (at?.[1] && at[2]) return { role: at[1].trim(), company: at[2].trim() };
  const dashes = plain.split(/\s+[–—-]\s+/).filter(Boolean);
  if (dashes.length >= 2) return { role: dashes[0] ?? '', company: dashes.at(-1) ?? '' };
  return { role: plain, company: '' };
}

/** A job from a tab's address and title alone, for a page the extension doesn't read. */
export function jobFromTab(href: string, title: string): PageJob {
  const { role, company } = fromTabTitle(title);
  return {
    url: jobAddress(href),
    pageUrl: href,
    site: hostOf(href),
    pageTitle: title,
    title: role,
    company,
    location: '',
    pay: '',
    employment: '',
    posted: '',
    posting: '',
    source: 'page',
  };
}

/** A company's name from a site's, for a page that doesn't name one: "acme.example" as "Acme". */
function companyFromSite(site: string): string {
  const name = site.replace(/^(jobs|careers|apply|boards|job-boards)\./, '').split('.')[0] ?? site;
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : site;
}

/** The job to save from what was read, with the company from the site when the page names none. */
export function toSave(page: PageJob): JobToSave {
  return {
    url: page.url,
    site: page.site,
    company: page.company.trim() || companyFromSite(page.site),
    role: page.title.trim(),
    pay: page.pay,
    posting: page.posting,
  };
}
