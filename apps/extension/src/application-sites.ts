import {
  careersSite,
  isCareersSite,
  isCopyOnlySite,
  jobSites,
  NOT_JOB_SITES,
  onAnySite,
} from './applicant-systems.ts';
import { type ContentScript, ext } from './ext.ts';
import { hostPattern } from './manifest.ts';
import { DEFAULT_SERVER, FOR_STORES } from './server.ts';
import { settings } from './settings.ts';

/**
 * The job application sites you allow, where the extension runs a small script of its own: a
 * Fill button on a page with an application form, and menus in the form's fields with
 * Factwright's answers (src/content.ts). One optional permission covers the applicant systems
 * most companies' forms are on (src/applicant-systems.ts), and any other careers site can be added
 * on its own, as an optional permission for that site alone. Each is asked for only from a click,
 * in setup or in the panel, so an update that brings them asks nothing of anyone. Everywhere else,
 * the extension reads a page only when you click, as it always has, and on LinkedIn and Indeed,
 * whose terms forbid filling their forms, it never runs a script.
 */

/** Whether this is a build for testing, which counts this computer's site as a job site. */
const LOCAL = !FOR_STORES;

/** The job application sites, as the opt-in asks the browser for them. */
export const JOB_SITES = jobSites(LOCAL);

/** A page's careers site, as one click adds it, or null for a page that can't be one. */
export const careersSiteOf = (url: string) => careersSite(url, LOCAL);

/** What you chose: the job application sites, and the careers sites you added, by their sites. */
export interface Chosen {
  all: boolean;
  sites: string[];
}

/** The most careers sites kept: more than anyone applies on. */
const MOST_SITES = 200;

/** What you chose, as the extension keeps it, with only what it takes. */
export async function chosen(): Promise<Chosen> {
  const { jobSites: saved } = await ext.storage.local.get('jobSites');
  const { all, sites } = (saved && typeof saved === 'object' ? saved : {}) as Partial<Chosen>;
  const added = Array.isArray(sites)
    ? sites.filter((site): site is string => typeof site === 'string' && isCareersSite(site, LOCAL))
    : [];
  return { all: all === true, sites: [...new Set(added)].slice(0, MOST_SITES) };
}

async function choose(changes: Partial<Chosen>): Promise<void> {
  await ext.storage.local.set({ jobSites: { ...(await chosen()), ...changes } });
}

/** Whether the browser lets the extension reach a site now. */
const granted = (site: string) => ext.permissions.contains({ origins: [site] }).catch(() => false);

/**
 * The sites the script runs on now: those you chose, while the browser lets the extension reach
 * each. A site the browser lets it reach for another reason, such as a sync server of your own,
 * or every https site you allowed in the browser's own settings, isn't one you chose.
 */
export async function allowedSites(): Promise<string[]> {
  const { all, sites } = await chosen();
  const wanted = [...new Set([...(all ? JOB_SITES : []), ...sites])];
  const reachable = await Promise.all(wanted.map(granted));
  return wanted.filter((_, at) => reachable[at]);
}

/** Whether a page is on a job application site, or a careers site, you allowed. */
export async function isAllowedPage(url: string): Promise<boolean> {
  if (isCopyOnlySite(url)) return false;
  return onAnySite(url, await allowedSites());
}

/** Whether a page is on one of the job application sites, allowed or not. */
export const onJobSite = (url: string) => onAnySite(url, JOB_SITES);

/**
 * Turns the job application sites on: asks the browser for them on the click itself, before
 * anything is waited on, as Firefox wants, and keeps your choice once it allows them.
 */
export function allowJobSites(): Promise<boolean> {
  const asked = ext.permissions.request({ origins: JOB_SITES }).catch(() => false);
  return asked.then(async (allowed) => {
    if (allowed) await choose({ all: true });
    return allowed;
  });
}

/**
 * Adds the careers site a page is on, as allowJobSites does the job application sites: asked for
 * on the click, and kept once the browser allows it.
 */
export function allowCareersSite(url: string): Promise<boolean> {
  const site = careersSiteOf(url);
  if (!site) return Promise.resolve(false);
  const asked = ext.permissions.request({ origins: [site] }).catch(() => false);
  return asked.then(async (allowed) => {
    if (allowed) {
      const { sites } = await chosen();
      await choose({ sites: [...new Set([...sites, site])].slice(0, MOST_SITES) });
    }
    return allowed;
  });
}

/**
 * Sites whose permission stays, whatever's turned off: the sync servers the extension reaches,
 * and the sites you still chose.
 */
async function stillUsed(): Promise<Set<string>> {
  const { all, sites } = await chosen();
  const { server } = await settings();
  return new Set([
    hostPattern(DEFAULT_SERVER),
    hostPattern(server),
    ...(all ? JOB_SITES : []),
    ...sites,
  ]);
}

/** Gives back the browser's permission for sites nothing uses now, each on its own. */
async function giveBack(sites: readonly string[]): Promise<void> {
  const keep = await stillUsed();
  await Promise.all(
    sites
      .filter((site) => !keep.has(site))
      .map((site) =>
        ext.permissions.remove({ origins: [site] }).catch(() => {
          // One the browser grants on its own, as a build for testing does at install.
        }),
      ),
  );
}

/** Turns the job application sites off, and gives back what the browser allowed for them. */
export async function stopJobSites(): Promise<void> {
  await choose({ all: false });
  await giveBack(JOB_SITES);
}

/** Takes a careers site you added away, and gives back what the browser allowed for it. */
export async function removeCareersSite(site: string): Promise<void> {
  const { sites } = await chosen();
  await choose({ sites: sites.filter((each) => each !== site) });
  await giveBack([site]);
}

/**
 * Whether the browser's permission for a site is one you gave a job site, which signing in or out
 * of sync never gives back (src/account.ts).
 */
export async function isChosenSite(site: string): Promise<boolean> {
  const { all, sites } = await chosen();
  return sites.includes(site) || (all && JOB_SITES.includes(site));
}

/** The script's ID with the browser, and its file. */
const SCRIPT = 'job-sites';
export const SCRIPT_FILE = 'content.js';

/** The script as the browser runs it: on each page of the sites, once it's loaded, in its top frame. */
const scriptFor = (sites: string[]): ContentScript => ({
  id: SCRIPT,
  matches: sites,
  excludeMatches: NOT_JOB_SITES,
  js: [SCRIPT_FILE],
  runAt: 'document_idle',
  allFrames: false,
  persistAcrossSessions: true,
});

/** The registering under way, so each waits for the one before it. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Registers the script for the sites you allowed, and only those, or takes it away once there are
 * none: as the extension starts, and whenever you, or the browser, change which they are. Pages
 * already open on a site that's new get the script at once, without loading again. It gives the
 * sites the script runs on.
 */
export function registerScripts(): Promise<string[]> {
  const next = queue.then(register, register);
  queue = next.catch(() => {});
  return next;
}

async function register(): Promise<string[]> {
  const sites = await allowedSites();
  const [script] = await ext.scripting.getRegisteredContentScripts({ ids: [SCRIPT] });
  const before = script?.matches ?? [];
  if (sites.length === 0) {
    if (script) await ext.scripting.unregisterContentScripts({ ids: [SCRIPT] });
  } else if (!script) {
    await ext.scripting.registerContentScripts([scriptFor(sites)]);
  } else if (
    script.matches.length !== sites.length ||
    script.matches.some((site, at) => site !== sites[at])
  ) {
    await ext.scripting.updateContentScripts([scriptFor(sites)]);
  }
  const added = sites.filter((site) => !before.includes(site));
  if (added.length > 0) await runOnOpenPages(added);
  return sites;
}

/** Runs the script on the pages open on newly allowed sites. */
async function runOnOpenPages(sites: string[]): Promise<void> {
  let tabs: { id?: number; url?: string }[] = [];
  try {
    tabs = await ext.tabs.query({ url: sites });
  } catch {
    return;
  }
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && onAnySite(tab.url ?? '', sites))
      .map((tab) =>
        ext.scripting
          .executeScript({ target: { tabId: tab.id as number }, files: [SCRIPT_FILE] })
          .catch(() => {
            // A page the browser keeps extensions out of, or one that closed meanwhile.
          }),
      ),
  );
}
