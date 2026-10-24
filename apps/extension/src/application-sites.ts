import {
  APPLICANT_SYSTEMS,
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

/**
 * The script as the browser runs it: on each page of the sites, once it's loaded, whether it's a
 * tab's page or in a frame of another site's page, as a company's careers page shows an applicant
 * system's form. A frame from any other site never gets it.
 */
const scriptFor = (sites: string[]): ContentScript => ({
  id: SCRIPT,
  matches: sites,
  excludeMatches: NOT_JOB_SITES,
  js: [SCRIPT_FILE],
  runAt: 'document_idle',
  allFrames: true,
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

/**
 * Runs the script on the pages open on newly allowed sites, and in the frames from those sites in
 * them. A frame from such a site in another site's page gets it once that page loads again.
 */
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
          .executeScript({
            target: { tabId: tab.id as number, allFrames: true },
            files: [SCRIPT_FILE],
          })
          .catch(() => {
            // A page the browser keeps extensions out of, or one that closed meanwhile.
          }),
      ),
  );
}

/**
 * A frame of a tab on a job site you allowed, where the extension's script runs, as the script
 * said: a tab's top frame is 0, and one in it, as a company's page shows an applicant system's
 * form, another number. The panel finds a form in such a frame by it, as Chrome lets the extension
 * reach a frame on an allowed site in a page it can't otherwise read, by the frame's number alone.
 */
export interface JobFrame {
  frameId: number;
  url: string;
  /** The script's own name for the page it's on, so a page that's gone forgets only itself. */
  doc: string;
}

/** Where the frames are kept: in the browser's memory, while it runs, never on the disk. */
const FRAMES = 'jobFrames';

/** The most frames kept for a tab: more than any page has with forms in them. */
const MOST_FRAMES = 20;

/** Changes to the frames kept, each after the one before it. */
let framesQueue: Promise<unknown> = Promise.resolve();

/** The frames kept, by tab, as the browser has them, or none where it keeps nothing for a session. */
async function framesKept(): Promise<Record<string, JobFrame[]>> {
  const session = ext.storage.session;
  if (!session) return {};
  const { [FRAMES]: kept } = await session.get(FRAMES).catch(() => ({}) as Record<string, unknown>);
  if (!kept || typeof kept !== 'object') return {};
  const all: Record<string, JobFrame[]> = {};
  for (const [tab, frames] of Object.entries(kept as Record<string, unknown>)) {
    if (!Array.isArray(frames)) continue;
    all[tab] = frames.filter(
      (frame): frame is JobFrame =>
        typeof frame === 'object' &&
        frame !== null &&
        Number.isInteger((frame as JobFrame).frameId) &&
        typeof (frame as JobFrame).url === 'string' &&
        typeof (frame as JobFrame).doc === 'string',
    );
  }
  return all;
}

/** Changes the frames kept for a tab, after the changes before. */
function changeFrames(tabId: number, change: (frames: JobFrame[]) => JobFrame[]): Promise<void> {
  const next = framesQueue.then(async () => {
    const session = ext.storage.session;
    if (!session) return;
    const all = await framesKept();
    const frames = change(all[tabId] ?? []).slice(-MOST_FRAMES);
    if (frames.length > 0) all[tabId] = frames;
    else delete all[tabId];
    await session.set({ [FRAMES]: all });
  });
  framesQueue = next.catch(() => {});
  return next;
}

/**
 * The frame whose script names its page so, in a tab, as the Fill button's frame names it: kept
 * while the browser runs, as the background forgets what it held once it's been idle a while.
 */
export async function keptFrame(tabId: number, doc: string): Promise<JobFrame | null> {
  await framesQueue;
  return (await framesKept())[tabId]?.find((frame) => frame.doc === doc) ?? null;
}

/** Keeps a frame where the script runs, its tab's own page too, as its script says hello. */
export const keepFrame = (tabId: number, frame: JobFrame) =>
  changeFrames(tabId, (frames) => [
    ...frames.filter((each) => each.frameId !== frame.frameId),
    frame,
  ]);

/**
 * Forgets a frame's page, as it goes, unless the frame shows another since, or all of a tab's
 * frames, as the tab closes.
 */
export const forgetFrame = (tabId: number, page?: { frameId: number; doc: string }) =>
  changeFrames(tabId, (frames) =>
    page ? frames.filter((each) => each.frameId !== page.frameId || each.doc !== page.doc) : [],
  );

/**
 * The frames of a tab, other than its top one, where the extension's script runs on a site you
 * still allow: the only frames the panel reads a form in, as a tab's top page is the only one it
 * reads otherwise, once you've clicked.
 */
export async function allowedFrames(tabId: number): Promise<JobFrame[]> {
  const frames = (await framesKept())[tabId] ?? [];
  const sites = await allowedSites();
  return frames.filter(
    (frame) => frame.frameId !== 0 && !isCopyOnlySite(frame.url) && onAnySite(frame.url, sites),
  );
}

/** A frame of a tab, by its number, and the page it shows. */
export interface FrameAt {
  frameId: number;
  url: string;
}

/** The address each frame of a tab shows, as the page's own. */
const hereIs = () => location.href;

/**
 * The frames of a tab, other than its top one, that show a page on a job site you allowed: as the
 * browser finds them, where it lets the extension reach the tab's own page, as once you've
 * clicked; or else the frames the script said hello from, as Chrome reaches no frame of a page it
 * can't reach, but by its number.
 */
export async function framesOnAllowedSites(tabId: number): Promise<FrameAt[]> {
  let found: FrameAt[];
  try {
    const each = await ext.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: hereIs,
    });
    found = each.flatMap(({ frameId, result }) =>
      frameId && typeof result === 'string' ? [{ frameId, url: result }] : [],
    );
  } catch {
    return allowedFrames(tabId);
  }
  const sites = await allowedSites();
  return found.filter((frame) => !isCopyOnlySite(frame.url) && onAnySite(frame.url, sites));
}

/**
 * Runs the script in the frames of a tab that show a page on a job site you allowed, as once you
 * turn the sites on from the panel, beside a form in such a frame: the page around it doesn't get
 * it, and a frame that has it already keeps the one it has.
 */
export async function runInFrames(tabId: number): Promise<void> {
  const frames = await framesOnAllowedSites(tabId);
  if (frames.length === 0) return;
  await ext.scripting
    .executeScript({
      target: { tabId, frameIds: frames.map((frame) => frame.frameId) },
      files: [SCRIPT_FILE],
    })
    .catch(() => {
      // A frame that's gone meanwhile.
    });
}

/** The frames' addresses on a tab's own page, as its elements say them, at most this many. */
const MOST_FRAMED = 50;

/** The addresses of the frames on a page, as its elements say them, read in the page. */
function framedAddresses(most: number): string[] {
  return [...document.querySelectorAll('iframe[src], frame[src]')]
    .map((frame) => (frame as HTMLIFrameElement).src)
    .filter((src) => /^https?:\/\//i.test(src))
    .slice(0, most);
}

/**
 * The applicant system whose form a tab's page shows in a frame, on a job application site you
 * haven't allowed, by the frame's address on the page: the panel offers to turn the sites on to
 * fill it. Null where there's none, or the browser doesn't let the extension read the page.
 */
export async function framedSystem(tabId: number): Promise<string | null> {
  let addresses: string[] = [];
  try {
    const [first] = await ext.scripting.executeScript({
      target: { tabId },
      func: framedAddresses,
      args: [MOST_FRAMED],
    });
    addresses = Array.isArray(first?.result) ? first.result : [];
  } catch {
    return null;
  }
  const sites = await allowedSites();
  for (const address of addresses) {
    if (typeof address !== 'string' || isCopyOnlySite(address) || onAnySite(address, sites)) {
      continue;
    }
    const system = APPLICANT_SYSTEMS.find((each) => onAnySite(address, each.sites));
    if (system) return system.name;
  }
  return null;
}
