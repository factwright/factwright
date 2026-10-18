import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix, win32 } from 'node:path';
import { SAVE_HELPER } from '@factwright/core';
import { EXTENSION_IDS } from '@factwright/sync';
import type { HelperState, HelperUnavailable, SaveHelperView } from '../../shared/save-helper.ts';
import { BROWSERS, type Browser, type BrowserId } from './browsers.ts';

/**
 * Registering the helper with the browsers. Save to Factwright reaches the app on this computer
 * through the browser's native messaging: the browser starts the helper the app installs
 * (apps/desktop/helper) once a manifest it reads names the helper and the extension. On a Mac
 * that's a file in the browser's own folders, and on Windows, a file in the app's data folder,
 * which a key in the registry names.
 *
 * On Windows the app registers with each browser it finds as it starts, which asks nothing of the
 * user. On a Mac it never touches a browser's folders until the user sets that browser up in the
 * Save to Factwright window: macOS keeps each app's data from other apps, and asks the user, or
 * blocks it and says so, when one tries. Once a browser is set up, a start keeps its manifest
 * current.
 *
 * A record in the app's data folder notes what was registered, for which version and helper, so an
 * ordinary start only reads a few small files of the app's own. Windows registers again when the
 * app is a new version or has moved, a browser turns up, or a manifest has gone or changed, and a
 * browser that couldn't be registered is left out of the record, so the next start tries it
 * again. A Mac writes again only for the browsers set up, when the app has moved or the manifests
 * would read differently, and notes the browsers macOS refused, until the user tries again.
 *
 * Uninstalling on Windows takes the keys, the manifests and the record away again
 * (build/installer.nsh). A Mac has no uninstaller: the helper goes to the Trash with the app, and
 * the browsers then say Factwright isn't there.
 */

/** The record of what was registered, in the app's data folder. */
export const RECORD_FILE = 'save-helper.json';

/** The folder in the app's data folder that holds the manifests the registry names on Windows. */
export const MANIFEST_FOLDER = 'save-helper';

/** What a manifest says the helper does, which a browser may show. */
const DESCRIPTION = 'Saves jobs from Save to Factwright to the Factwright app on this computer.';

/** A Chrome extension's ID: 32 letters from a to p. */
const CHROME_ID = /^[a-p]{32}$/;

/** The folder in a browser's own folder that holds its manifests. */
const MANIFESTS = 'NativeMessagingHosts';

/** How long reg.exe may take to set a key before it counts as failed. */
const RUN_MS = 30_000;

/** The helper's file name, as the installers put it beside the app's own program. */
export const helperName = (platform: NodeJS.Platform) =>
  platform === 'win32' ? 'factwright-save.exe' : 'factwright-save';

/**
 * What registering reads and writes, so tests can stand in a Mac's or a Windows computer's folders
 * on any computer.
 */
export interface Disk {
  /** The names in a folder, or none when it isn't one. */
  list(path: string): string[];
  /** Whether a file is there. */
  isFile(path: string): boolean;
  /** Whether a folder is there, such as an app in Applications, which is a folder. */
  isFolder(path: string): boolean;
  /** A file's text, or null when it can't be read. */
  read(path: string): string | null;
  /**
   * Writes a file whole, making its folder if it's missing: first to a hidden file beside it,
   * then moved into place, so a browser never reads half of one. It runs off the app's main
   * thread, as macOS may ask the user before letting it through, and the app shouldn't stall.
   */
  write(path: string, text: string): Promise<void>;
}

/** This computer's own files. */
export const localDisk: Disk = {
  list(path) {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  isFile(path) {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  isFolder(path) {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  read(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  async write(path, text) {
    const folder = dirname(path);
    await mkdir(folder, { recursive: true });
    const draft = join(folder, `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      await writeFile(draft, text);
      await rename(draft, path);
    } finally {
      await rm(draft, { force: true });
    }
  },
};

/**
 * Runs a program without a shell, as registering runs reg.exe on Windows: it fails if the
 * program can't start, takes over 30 seconds, or exits with anything but 0.
 */
export function runProgram(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: RUN_MS }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

/**
 * What registering needs from the app and the computer, each given, so tests can stand in a home
 * folder, a disk and reg.exe of their own.
 */
export interface SaveHelperDeps {
  /** The kind of computer: the browsers are looked for on a Mac and Windows only. */
  platform: NodeJS.Platform;
  /** The user's home folder: on a Mac, the browsers keep their folders in its Library. */
  userHome: string;
  /**
   * Windows' folders, from the environment: LOCALAPPDATA and APPDATA, where the browsers keep
   * theirs, and SystemRoot, where reg.exe is.
   */
  env: { LOCALAPPDATA?: string; APPDATA?: string; SystemRoot?: string };
  /**
   * The app's own data folder, which is the first profile's: the record goes there, and on
   * Windows, the manifests.
   */
  appHome: string;
  /** The helper, by its whole path, which the manifests name. */
  helper: string;
  /** The app's version, as a new version registers again. */
  version: string;
  /** Save to Factwright's IDs: its Chrome Web Store item's and its Firefox one. */
  extensionIds?: { chrome: string; firefox: string };
  /**
   * More Chrome extensions to let reach the helper, such as one being developed, loaded unpacked:
   * each an ID of 32 letters from a to p.
   */
  extraChromeIds?: readonly string[];
  /**
   * The folders a Mac's apps are installed in, where the browsers are looked for: Applications,
   * and the one in the user's home folder, unless others are given.
   */
  applications?: readonly string[];
  /**
   * Runs a program, without a shell, as runProgram does, and settles once it's done: it rejects
   * when the program can't start or fails. Registering runs reg.exe on Windows.
   */
  run: (command: string, args: readonly string[]) => Promise<unknown>;
  /** The files it reads and writes: this computer's own, unless a test stands others in. */
  disk?: Disk;
}

/**
 * Why registering was skipped:
 * - other-system: it's not a Mac or Windows, where the browsers are looked for.
 * - no-helper: the helper isn't where the app expects it.
 * - translocated: macOS runs the app from a temporary copy, as it does for one opened where it was
 *   downloaded until it's moved, and that copy goes away.
 * - disk-image: the app runs from a disk image or another disk, under /Volumes, which goes away
 *   once it's ejected.
 * - unchanged: it's registered already, for this version and helper, and nothing's changed since.
 * - not-set-up: on a Mac, no browser is set up yet. The user sets each up in the Save to
 *   Factwright window, and until then the app leaves the browsers' folders alone.
 */
export type SkipReason =
  | 'other-system'
  | 'no-helper'
  | 'translocated'
  | 'disk-image'
  | 'unchanged'
  | 'not-set-up';

/** A browser that couldn't be registered, and what went wrong. */
export interface BrowserProblem {
  browser: BrowserId;
  message: string;
  /**
   * Whether the system refused: macOS does until the user lets Factwright reach that browser's
   * data, in System Settings, under Privacy & Security, then Files & Folders.
   */
  blocked: boolean;
}

/**
 * What registering did: skipped, and why, or which browsers it registered and which it couldn't,
 * which the next start tries again.
 */
export type Registration =
  | { skipped: SkipReason }
  | { registered: BrowserId[]; failed: BrowserProblem[] };

/** What the record notes: the version and helper registered, and the browsers it worked for. */
interface HelperRecord {
  version: string;
  helper: string;
  /** The browsers that can reach the helper. */
  browsers: string[];
  /** On a Mac, the browsers macOS refused, until the user sets them up again. */
  blocked: string[];
  /**
   * On a Mac, a digest of the manifests last written, so a start knows they're current without
   * reading the browsers' folders. Null in a record from before there was one.
   */
  manifests: string | null;
}

/** A manifest file to write, and the browsers that read it. */
interface ManifestFile {
  path: string;
  text: string;
  browsers: BrowserId[];
}

/** A key to set in the registry, the manifest file it names, and the browsers that read it. */
interface RegistryKey {
  key: string;
  manifest: string;
  browsers: BrowserId[];
}

/** Each kind of manifest's text. */
type ManifestTexts = Record<Browser['manifest'], string>;

/** What registering takes: each file and key once, however many browsers read it. */
interface Plan {
  /** The browsers registered with, in the order of BROWSERS. */
  found: BrowserId[];
  files: ManifestFile[];
  keys: RegistryKey[];
  /** The record's path. */
  record: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Whether macOS refused, as it does when an app reaches another app's data unallowed: "Operation
 * not permitted". "Permission denied" is the folder's own permissions instead, which Files & Folders
 * can't change, and Windows refusing is something else again, such as another program in the way.
 */
const refusedByMacOS = (platform: NodeJS.Platform, error: unknown) =>
  platform === 'darwin' && (error as NodeJS.ErrnoException | null)?.code === 'EPERM';

const jsonText = (value: object) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Each kind of manifest's text: the Chrome family's names the extension by its origin, and
 * Firefox's by its ID. Each Chrome ID must be one, or nothing is registered.
 */
function manifestTexts(deps: SaveHelperDeps): ManifestTexts {
  const ids = deps.extensionIds ?? EXTENSION_IDS;
  const chrome = [ids.chrome, ...(deps.extraChromeIds ?? [])];
  for (const id of chrome) {
    if (!CHROME_ID.test(id)) {
      throw new Error(
        `${JSON.stringify(id)} isn’t a Chrome extension’s ID, which is 32 letters from a to p.`,
      );
    }
  }
  const common = { name: SAVE_HELPER, description: DESCRIPTION, path: deps.helper, type: 'stdio' };
  return {
    chrome: jsonText({
      ...common,
      allowed_origins: [...new Set(chrome)].map((id) => `chrome-extension://${id}/`),
    }),
    firefox: jsonText({ ...common, allowed_extensions: [ids.firefox] }),
  };
}

/** A digest of the manifests' texts, which changes whenever either would. */
const digestOf = (texts: ManifestTexts) =>
  createHash('sha256').update(texts.chrome).update('\0').update(texts.firefox).digest('hex');

/**
 * Whether a browser has run on Windows: its own folder is there with something of the browser's
 * in it. One holding nothing but a manifests folder was made for another browser, and hidden files
 * aren't the browser's.
 */
const hasRun = (disk: Disk, folder: string) =>
  disk.list(folder).some((name) => name !== MANIFESTS && !name.startsWith('.'));

/**
 * The browsers installed on a Mac, by their apps in Applications. Never by their own folders,
 * which macOS keeps from other apps.
 */
function macBrowsers(deps: SaveHelperDeps, disk: Disk): Browser[] {
  const folders = deps.applications ?? ['/Applications', posix.join(deps.userHome, 'Applications')];
  return BROWSERS.filter((browser) =>
    browser.mac.apps.some((app) =>
      folders.some((folder) => disk.isFolder(posix.join(folder, app))),
    ),
  );
}

/** A manifest in each folder the given browsers read on a Mac, made if it's missing. */
function macPlan(deps: SaveHelperDeps, texts: ManifestTexts, browsers: readonly Browser[]): Plan {
  const support = posix.join(deps.userHome, 'Library', 'Application Support');
  const files = new Map<string, ManifestFile>();
  for (const browser of browsers) {
    for (const folder of browser.mac.manifestFolders) {
      const path = posix.join(support, folder, `${SAVE_HELPER}.json`);
      const file = files.get(path) ?? { path, text: texts[browser.manifest], browsers: [] };
      file.browsers.push(browser.id);
      files.set(path, file);
    }
  }
  return {
    found: browsers.map((browser) => browser.id),
    files: [...files.values()],
    keys: [],
    record: posix.join(deps.appHome, RECORD_FILE),
  };
}

/** A browser's own folder on Windows, in LOCALAPPDATA or APPDATA, or null without that one. */
function windowsFolder(folder: string, env: SaveHelperDeps['env']): string | null {
  const [, under, rest] = /^%(LOCALAPPDATA|APPDATA)%\\(.+)$/.exec(folder) ?? [];
  const base = under && env[under as 'LOCALAPPDATA' | 'APPDATA'];
  return base && rest ? win32.join(base, rest) : null;
}

/**
 * Whether a browser has run on Windows: its folder, or one whose name starts with what comes
 * before a *, has something in it.
 */
function foundOnWindows(disk: Disk, folder: string): boolean {
  if (!folder.endsWith('*')) return hasRun(disk, folder);
  const parent = win32.dirname(folder);
  const start = win32.basename(folder).slice(0, -1).toLowerCase();
  return disk
    .list(parent)
    .some((name) => name.toLowerCase().startsWith(start) && hasRun(disk, win32.join(parent, name)));
}

/** The browsers that have run on Windows, by their own folders. */
function windowsBrowsers(deps: SaveHelperDeps, disk: Disk): Browser[] {
  return BROWSERS.filter((browser) => {
    const folder = windowsFolder(browser.windows.folder, deps.env);
    return folder !== null && foundOnWindows(disk, folder);
  });
}

/**
 * The browsers found on Windows, the manifests their keys name, in the app's data folder, and
 * each key once, however many browsers read it.
 */
function windowsPlan(deps: SaveHelperDeps, disk: Disk, texts: ManifestTexts): Plan {
  const found = windowsBrowsers(deps, disk);
  const folder = win32.join(deps.appHome, MANIFEST_FOLDER);
  const files = new Map<string, ManifestFile>();
  const keys = new Map<string, RegistryKey>();
  for (const browser of found) {
    const path = win32.join(folder, `${browser.manifest}.json`);
    const file = files.get(path) ?? { path, text: texts[browser.manifest], browsers: [] };
    file.browsers.push(browser.id);
    files.set(path, file);
    for (const under of browser.windows.keys) {
      const key = `HKCU\\Software\\${under}\\${SAVE_HELPER}`;
      const entry = keys.get(key) ?? { key, manifest: path, browsers: [] };
      entry.browsers.push(browser.id);
      keys.set(key, entry);
    }
  }
  return {
    found: found.map((browser) => browser.id),
    files: [...files.values()],
    keys: [...keys.values()],
    record: win32.join(deps.appHome, RECORD_FILE),
  };
}

const recordPath = (deps: SaveHelperDeps) =>
  (deps.platform === 'win32' ? win32 : posix).join(deps.appHome, RECORD_FILE);

/** The record, or null when there's none, or it isn't one. */
function readRecord(text: string | null): HelperRecord | null {
  if (text === null) return null;
  try {
    const { version, helper, browsers, blocked, manifests } = JSON.parse(text) ?? {};
    const names = (list: unknown): list is string[] =>
      Array.isArray(list) && list.every((each) => typeof each === 'string');
    return typeof version === 'string' && typeof helper === 'string' && names(browsers)
      ? {
          version,
          helper,
          browsers,
          blocked: names(blocked) ? blocked : [],
          manifests: typeof manifests === 'string' ? manifests : null,
        }
      : null;
  } catch {
    return null;
  }
}

/** Writes the record. Without it, the next start registers again, which does no harm. */
async function writeRecord(disk: Disk, path: string, record: object): Promise<void> {
  try {
    await disk.write(path, jsonText(record));
  } catch {
    // As above.
  }
}

/**
 * Whether the manifests the record notes read as they would now: written for this helper, with
 * the same text. A record from 0.9.0 notes no digest, but it was written for the stores' IDs, as
 * now, so for the same helper it reads the same.
 */
const current = (record: HelperRecord, deps: SaveHelperDeps, texts: ManifestTexts) =>
  record.helper === deps.helper &&
  (record.manifests === null || record.manifests === digestOf(texts));

/**
 * Whether Windows is registered already: the record is for this version and helper, lists every
 * browser found, and each manifest is there as it would be written now. That's the two in the
 * app's data folder, as the keys aren't read back, so an ordinary start never runs reg.exe.
 */
function upToDate(plan: Plan, deps: SaveHelperDeps, disk: Disk): boolean {
  const record = readRecord(disk.read(plan.record));
  return (
    record !== null &&
    record.version === deps.version &&
    record.helper === deps.helper &&
    plan.found.every((id) => record.browsers.includes(id)) &&
    plan.files.every((file) => disk.read(file.path) === file.text)
  );
}

/**
 * Writes each manifest, then sets each key: the browsers it all worked for, and the ones it
 * didn't, and why. A browser that one of its manifests or keys failed for is left out, and the
 * rest go ahead. A key never names a manifest that couldn't be written.
 */
async function writeAll(
  plan: Plan,
  deps: SaveHelperDeps,
  disk: Disk,
): Promise<{ registered: BrowserId[]; failed: BrowserProblem[] }> {
  const problems = new Map<BrowserId, { message: string; blocked: boolean }>();
  const fail = (browsers: BrowserId[], message: string, blocked = false) => {
    for (const browser of browsers) {
      if (!problems.has(browser)) problems.set(browser, { message, blocked });
    }
  };
  const unwritten = new Map<string, string>();
  for (const file of plan.files) {
    try {
      await disk.write(file.path, file.text);
    } catch (error) {
      unwritten.set(file.path, messageOf(error));
      fail(file.browsers, messageOf(error), refusedByMacOS(deps.platform, error));
    }
  }
  // The system's own reg.exe, by its whole path: a program run by its name alone is looked for
  // first in whatever folder the app was started in.
  const regExe = deps.env.SystemRoot ? win32.join(deps.env.SystemRoot, 'System32', 'reg.exe') : '';
  for (const { key, manifest, browsers } of plan.keys) {
    const problem =
      unwritten.get(manifest) ??
      (regExe ? null : 'SystemRoot isn’t set, so reg.exe can’t be found.');
    if (problem) {
      fail(browsers, problem);
      continue;
    }
    try {
      await deps.run(regExe, ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f']);
    } catch (error) {
      fail(browsers, messageOf(error));
    }
  }
  return {
    registered: plan.found.filter((browser) => !problems.has(browser)),
    failed: plan.found.flatMap((browser) => {
      const problem = problems.get(browser);
      return problem === undefined ? [] : [{ browser, ...problem }];
    }),
  };
}

/**
 * Registers on Windows with each browser found, and notes the browsers it worked for: only once
 * something worked, or nothing was there to fail, as otherwise everything is tried again.
 */
async function registerOnWindows(
  deps: SaveHelperDeps,
  disk: Disk,
  texts: ManifestTexts,
  again: boolean,
): Promise<Registration> {
  const plan = windowsPlan(deps, disk, texts);
  if (!again && upToDate(plan, deps, disk)) return { skipped: 'unchanged' };
  const result = await writeAll(plan, deps, disk);
  if (result.registered.length > 0 || result.failed.length === 0) {
    await writeRecord(disk, plan.record, {
      version: deps.version,
      helper: deps.helper,
      browsers: result.registered,
    });
  }
  return result;
}

/**
 * Sets the given browsers up on a Mac, and notes where each stands: the ones it worked for join
 * those set up before, and the ones macOS refused are noted as blocked, while the rest keep what
 * they had.
 */
async function setUpOnMac(
  deps: SaveHelperDeps,
  disk: Disk,
  texts: ManifestTexts,
  browsers: readonly Browser[],
  before: HelperRecord | null,
): Promise<Registration> {
  const plan = macPlan(deps, texts, browsers);
  const result = await writeAll(plan, deps, disk);
  const tried = new Set<string>(plan.found);
  const blocked = result.failed.filter((problem) => problem.blocked).map((each) => each.browser);
  const kept = (list: string[] | undefined) => (id: string) =>
    (list ?? []).includes(id) && !tried.has(id);
  const ids = BROWSERS.map((browser) => browser.id);
  await writeRecord(disk, plan.record, {
    version: deps.version,
    helper: deps.helper,
    browsers: ids.filter((id) => kept(before?.browsers)(id) || result.registered.includes(id)),
    blocked: ids.filter((id) => kept(before?.blocked)(id) || blocked.includes(id)),
    manifests: digestOf(texts),
  });
  return result;
}

/**
 * What registering needs before anything is read or written: it rejects, with nothing written, if
 * a Chrome ID isn't one, or the helper's path isn't whole, and it's skipped when the helper isn't
 * there, or a Mac app runs from somewhere that goes away, as the browsers would be left starting a
 * helper that's gone. Anywhere but a Mac or Windows, there's nothing to do.
 */
function prepare(
  deps: SaveHelperDeps,
): { skipped: SkipReason } | { disk: Disk; texts: ManifestTexts } {
  const { platform, helper } = deps;
  if (platform !== 'darwin' && platform !== 'win32') return { skipped: 'other-system' };
  const paths = platform === 'win32' ? win32 : posix;
  if (!paths.isAbsolute(helper)) {
    throw new Error(`The helper’s path must be whole, from the top of the disk: ${helper}`);
  }
  const texts = manifestTexts(deps);
  if (platform === 'darwin' && helper.includes('/AppTranslocation/')) {
    return { skipped: 'translocated' };
  }
  if (platform === 'darwin' && helper.startsWith('/Volumes/')) return { skipped: 'disk-image' };
  const disk = deps.disk ?? localDisk;
  if (!disk.isFile(helper)) return { skipped: 'no-helper' };
  return { disk, texts };
}

/**
 * Registers the helper as the app starts, so Save to Factwright can reach the app. On Windows,
 * each browser found gets a manifest naming the helper and Save to Factwright's IDs, with any more
 * Chrome IDs given, unless it's registered already. On a Mac, only the browsers the user set up
 * are kept current, and none are touched until there are some. A browser that fails never stops
 * the others.
 */
export async function registerSaveHelper(deps: SaveHelperDeps): Promise<Registration> {
  const ready = prepare(deps);
  if ('skipped' in ready) return ready;
  const { disk, texts } = ready;
  if (deps.platform === 'win32') return registerOnWindows(deps, disk, texts, false);
  const record = readRecord(disk.read(recordPath(deps)));
  if (record === null || record.browsers.length === 0) return { skipped: 'not-set-up' };
  if (current(record, deps, texts)) {
    // The manifests read as they would now: only the record learns the version, and the digest.
    const digest = digestOf(texts);
    if (record.version !== deps.version || record.manifests !== digest) {
      await writeRecord(disk, recordPath(deps), {
        ...record,
        version: deps.version,
        manifests: digest,
      });
    }
    return { skipped: 'unchanged' };
  }
  // The app moved, or the manifests would read differently: the browsers set up get theirs
  // written again.
  return setUpOnMac(
    deps,
    disk,
    texts,
    BROWSERS.filter((browser) => record.browsers.includes(browser.id)),
    record,
  );
}

/**
 * Sets browsers up because the user asked, in the Save to Factwright window: on a Mac, the ones
 * given that are installed, or every one installed, which macOS may ask the user about, along with
 * any set up before whose manifests are out of date. On Windows, it registers with every browser
 * found, as a start would, even when nothing seems to have changed.
 */
export async function setUpSaveHelper(
  deps: SaveHelperDeps,
  only?: readonly string[],
): Promise<Registration> {
  const ready = prepare(deps);
  if ('skipped' in ready) return ready;
  const { disk, texts } = ready;
  if (deps.platform === 'win32') return registerOnWindows(deps, disk, texts, true);
  const record = readRecord(disk.read(recordPath(deps)));
  const asked = macBrowsers(deps, disk).filter((browser) => !only || only.includes(browser.id));
  const stale = record && !current(record, deps, texts) ? record.browsers : [];
  const browsers = BROWSERS.filter(
    (browser) => asked.includes(browser) || stale.includes(browser.id),
  );
  if (browsers.length === 0) return { registered: [], failed: [] };
  return setUpOnMac(deps, disk, texts, browsers, record);
}

/** Why the browsers can't be set up, by why registering would be skipped. */
const UNAVAILABLE: Partial<Record<SkipReason, HelperUnavailable>> = {
  'other-system': 'other-system',
  'no-helper': 'no-helper',
  translocated: 'translocated',
  'disk-image': 'disk-image',
};

/**
 * Where each browser on this computer stands, for the Save to Factwright window, from the record
 * alone: on a Mac, the browsers are found by their apps, so looking never touches their folders.
 */
export function saveHelperStatus(deps: SaveHelperDeps): SaveHelperView {
  const onRequest = deps.platform === 'darwin';
  let ready: ReturnType<typeof prepare>;
  try {
    ready = prepare(deps);
  } catch {
    return { unavailable: 'no-helper', onRequest, browsers: [] };
  }
  if ('skipped' in ready) {
    return { unavailable: UNAVAILABLE[ready.skipped] ?? 'no-helper', onRequest, browsers: [] };
  }
  const { disk } = ready;
  const record = readRecord(disk.read(recordPath(deps)));
  const stateOf = (id: string): HelperState =>
    record?.browsers.includes(id)
      ? 'ready'
      : record?.blocked.includes(id)
        ? 'blocked'
        : 'not-set-up';
  const found = deps.platform === 'darwin' ? macBrowsers(deps, disk) : windowsBrowsers(deps, disk);
  return {
    unavailable: null,
    onRequest,
    browsers: found.map((browser) => ({
      id: browser.id,
      name: browser.name,
      state: stateOf(browser.id),
      allow: deps.platform === 'darwin' ? [...browser.mac.allow] : [],
    })),
  };
}
