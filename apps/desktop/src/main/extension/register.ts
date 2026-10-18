import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, posix, win32 } from 'node:path';
import { EXTENSION_IDS, SAVE_HELPER } from '@factwright/core';
import { BROWSERS, type Browser, type BrowserId } from './browsers.ts';

/**
 * Registering the helper with the browsers. Save to Factwright reaches the app on this computer
 * through the browser's native messaging: the browser starts the helper the app installs
 * (apps/desktop/helper) once a manifest it reads names the helper and the extension. So as the app
 * starts, it gives each browser it finds a manifest: on a Mac, a file in the browser's own folders,
 * and on Windows, a file in the app's data folder, which a key in the registry names.
 *
 * A record in the app's data folder notes what was registered, for which version and helper, so an
 * ordinary start only reads a few small files. It registers again when the app is a new version or
 * has moved, a browser turns up, or a manifest has gone or changed. A browser that couldn't be
 * registered is left out of the record, so the next start tries it again.
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

/** The folder in a browser's own folder that holds its manifests on a Mac. */
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
  /** A file's text, or null when it can't be read. */
  read(path: string): string | null;
  /**
   * Writes a file whole, making its folder if it's missing: first to a hidden file beside it,
   * then moved into place, so a browser never reads half of one.
   */
  write(path: string, text: string): void;
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
  read(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  write(path, text) {
    const folder = dirname(path);
    mkdirSync(folder, { recursive: true });
    const draft = join(folder, `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      writeFileSync(draft, text);
      renameSync(draft, path);
    } finally {
      rmSync(draft, { force: true });
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
 */
export type SkipReason = 'other-system' | 'no-helper' | 'translocated' | 'disk-image' | 'unchanged';

/** A browser that couldn't be registered, and what went wrong. */
export interface BrowserProblem {
  browser: BrowserId;
  message: string;
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
  browsers: string[];
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

/** What registering on this computer takes: each file and key once, however many browsers read it. */
interface Plan {
  /** The browsers found, in the order of BROWSERS. */
  found: BrowserId[];
  files: ManifestFile[];
  keys: RegistryKey[];
  /** The record's path. */
  record: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

/**
 * Whether a browser has run: its own folder is there with something of the browser's in it. One
 * holding nothing but a manifests folder was made for another browser, as registering for Brave
 * makes Chrome's on a Mac, and hidden files, such as the Finder's, aren't the browser's.
 */
const hasRun = (disk: Disk, folder: string) =>
  disk.list(folder).some((name) => name !== MANIFESTS && !name.startsWith('.'));

/** The browsers found on a Mac, and a manifest in each folder they read, made if it's missing. */
function macPlan(deps: SaveHelperDeps, disk: Disk, texts: ManifestTexts): Plan {
  const support = posix.join(deps.userHome, 'Library', 'Application Support');
  const found = BROWSERS.filter((browser) => hasRun(disk, posix.join(support, browser.mac.folder)));
  const files = new Map<string, ManifestFile>();
  for (const browser of found) {
    for (const folder of browser.mac.manifestFolders) {
      const path = posix.join(support, folder, `${SAVE_HELPER}.json`);
      const file = files.get(path) ?? { path, text: texts[browser.manifest], browsers: [] };
      file.browsers.push(browser.id);
      files.set(path, file);
    }
  }
  return {
    found: found.map((browser) => browser.id),
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

/**
 * The browsers found on Windows, the manifests their keys name, in the app's data folder, and
 * each key once, however many browsers read it.
 */
function windowsPlan(deps: SaveHelperDeps, disk: Disk, texts: ManifestTexts): Plan {
  const found = BROWSERS.filter((browser) => {
    const folder = windowsFolder(browser.windows.folder, deps.env);
    return folder !== null && foundOnWindows(disk, folder);
  });
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

/** The record, or null when there's none, or it isn't one. */
function readRecord(text: string | null): HelperRecord | null {
  if (text === null) return null;
  try {
    const { version, helper, browsers } = JSON.parse(text) ?? {};
    const listed = Array.isArray(browsers) && browsers.every((each) => typeof each === 'string');
    return typeof version === 'string' && typeof helper === 'string' && listed
      ? { version, helper, browsers }
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether it's registered already: the record is for this version and helper, lists every
 * browser found, and each manifest is there as it would be written now. On Windows that's the
 * two in the app's data folder, as the keys aren't read back, so an ordinary start never runs
 * reg.exe.
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
 * Writes each manifest, then sets each key, then notes the browsers it all worked for. A browser
 * that one of its manifests or keys failed for is left out, and the rest go ahead. A key never
 * names a manifest that couldn't be written.
 */
async function register(plan: Plan, deps: SaveHelperDeps, disk: Disk): Promise<Registration> {
  const problems = new Map<BrowserId, string>();
  const fail = (browsers: BrowserId[], message: string) => {
    for (const browser of browsers) if (!problems.has(browser)) problems.set(browser, message);
  };
  const unwritten = new Map<string, string>();
  for (const file of plan.files) {
    try {
      disk.write(file.path, file.text);
    } catch (error) {
      unwritten.set(file.path, messageOf(error));
      fail(file.browsers, messageOf(error));
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
  const worked = plan.found.filter((browser) => !problems.has(browser));
  const failed = plan.found.flatMap((browser) => {
    const message = problems.get(browser);
    return message === undefined ? [] : [{ browser, message }];
  });
  // Only once something worked, or nothing was there to fail: otherwise everything is tried again.
  if (worked.length > 0 || failed.length === 0) {
    const record: HelperRecord = { version: deps.version, helper: deps.helper, browsers: worked };
    try {
      disk.write(plan.record, jsonText(record));
    } catch {
      // Without it, the next start registers again, which does no harm.
    }
  }
  return { registered: worked, failed };
}

/**
 * Registers the helper with each browser on this computer, so Save to Factwright can reach the
 * app, unless it's registered already: for the app's start, after it's ready. Each browser it
 * finds gets a manifest naming the helper and Save to Factwright's IDs, with any more Chrome IDs
 * given. A browser that fails never stops the others.
 *
 * It's skipped when the helper isn't there, or a Mac app runs from somewhere that goes away, as
 * the browsers would be left starting a helper that's gone. Anywhere but a Mac or Windows it does
 * nothing. It rejects, with nothing written, if a Chrome ID isn't one, or the helper's path isn't
 * whole.
 */
export async function registerSaveHelper(deps: SaveHelperDeps): Promise<Registration> {
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
  const plan = platform === 'darwin' ? macPlan(deps, disk, texts) : windowsPlan(deps, disk, texts);
  if (upToDate(plan, deps, disk)) return { skipped: 'unchanged' };
  return register(plan, deps, disk);
}
