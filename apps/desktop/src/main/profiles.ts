import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { EditResult } from '../shared/api.ts';
import {
  type AddProfileResult,
  type ProfileList,
  parseProfileName,
  sameName,
} from '../shared/profiles.ts';

/**
 * Profiles: each person on this computer keeps their own job hunt in one, with its own sync
 * account and Claude login. One is open at a time, and switching restarts the app on another.
 *
 * The first profile is the app's own data folder, as it was before there were profiles, so a job
 * hunt from an earlier version is the first profile, untouched and where it was. Each profile
 * added later gets a folder inside it, under Profiles, named by a random ID, so a new profile
 * never lands in a removed one's place. Its own Claude Code folder sits in there too, so its
 * Claude login is its own.
 *
 * Profiles aren't private from each other, like a browser's: anyone who can use this computer
 * login can open any of them. Separate computer logins keep job hunts private.
 */

/** The first profile's ID. Added profiles have random ones, which can't look like it. */
export const FIRST_PROFILE = 'first';

/** The folder the added profiles' folders are in, inside the first profile's. */
const ADDED_FOLDER = 'Profiles';

/** Which profile the app opens, in the first profile's folder. */
const OPEN_FILE = 'profiles.json';

/** A profile's name and the sync account it uses, in the profile's own folder. */
const PROFILE_FILE = 'profile.json';

/**
 * The sync account a profile uses: its email, and its server, which is a server of your own's
 * address, or null for Factwright's own.
 */
export interface SyncAccountNote {
  email: string;
  server: string | null;
}

const sameAccount = (one: SyncAccountNote | null, other: SyncAccountNote | null) =>
  one === other ||
  (one !== null && other !== null && one.email === other.email && one.server === other.server);

/** Claude Code's own folder, in an added profile's folder: its login, settings and history. */
const CLAUDE_FOLDER = 'claude';

/** An added profile's ID: 12 random letters and numbers. */
const ADDED_ID = /^[0-9a-f]{12}$/;

/** What the first profile is called until it has a name. */
const FIRST_NAME = 'First profile';

/** What a profile whose name can't be read is called, so it still shows, to open or remove. */
const NO_NAME = 'Unnamed profile';

/** What the window says when a name won't do. */
const NAME_IT = 'Give it a name of 40 characters or fewer.';

/** How long a start may take before one that never showed its window counts as stopped short. */
const START_MS = 60_000;

/** A profile's folder, and what's kept about it there. */
export interface ProfileFolder {
  id: string;
  /** Its name, or what it goes by until it has one. */
  name: string;
  named: boolean;
  /** Its data folder: the app's own for the first profile, and one inside it for the rest. */
  dir: string;
  /** The sync account it uses, once it's noted, so no other profile here uses it. */
  sync: SyncAccountNote | null;
}

const isId = (value: unknown): value is string =>
  value === FIRST_PROFILE || (typeof value === 'string' && ADDED_ID.test(value));

const failed = (message: string) => ({ ok: false as const, message });

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Writes a small file whole, or not at all, so a crash never leaves half of one. */
function writeJson(file: string, value: object): void {
  const draft = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(draft, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(draft, file);
  } catch (error) {
    rmSync(draft, { force: true });
    throw error;
  }
}

/** The folder a profile's data is in. */
const folderOf = (home: string, id: string) =>
  id === FIRST_PROFILE ? home : join(home, ADDED_FOLDER, id);

/** Whether a path is a folder itself, not a link to one somewhere else. */
function isFolder(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A profile, from its folder, or null for an added one that's missing or was never finished. An
 * added profile's folder is a folder of its own, never a link to one elsewhere.
 */
function readProfile(home: string, id: string): ProfileFolder | null {
  const dir = folderOf(home, id);
  const file = join(dir, PROFILE_FILE);
  // An added profile's file is written first, so a folder without one was never finished.
  if (id !== FIRST_PROFILE && !(isFolder(dir) && existsSync(file))) return null;
  const kept = readJson(file);
  const name = parseProfileName(kept?.name);
  const email = typeof kept?.sync === 'string' && kept.sync ? kept.sync : null;
  // Noted before there were servers of your own, it's Factwright's.
  const server = typeof kept?.syncServer === 'string' && kept.syncServer ? kept.syncServer : null;
  const sync = email ? { email, server } : null;
  const unnamed = id === FIRST_PROFILE ? FIRST_NAME : NO_NAME;
  return { id, name: name ?? unnamed, named: name !== null, dir, sync };
}

/** Changes what's kept about a profile, keeping the rest. */
function keep(profile: ProfileFolder, changes: Record<string, unknown>): void {
  const file = join(profile.dir, PROFILE_FILE);
  writeJson(file, { ...readJson(file), ...changes });
}

/**
 * Whether a process of this user's is running. One this user can't signal belongs to someone
 * else, so it isn't a copy of the app this user runs: the number was used again.
 */
function running(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether another copy of the app has a profile open. Chromium keeps a lock in the folder while a
 * copy has it: on a Mac, a link naming the computer and process that hold it, and on Windows a
 * file that goes when that copy closes.
 */
function openElsewhere(dir: string): boolean {
  if (process.platform === 'win32') return existsSync(join(dir, 'lockfile'));
  let holder: string;
  try {
    holder = readlinkSync(join(dir, 'SingletonLock'));
  } catch {
    return false;
  }
  const at = holder.lastIndexOf('-');
  return holder.slice(0, at) === hostname() && running(Number(holder.slice(at + 1)));
}

/** Every profile: the first, then the rest in the order they were added. */
export function listProfiles(home: string): ProfileFolder[] {
  const first = readProfile(home, FIRST_PROFILE) as ProfileFolder;
  let ids: string[] = [];
  try {
    ids = readdirSync(join(home, ADDED_FOLDER), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ADDED_ID.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    // No profiles added yet.
  }
  const added = ids
    .map((id) => {
      const profile = readProfile(home, id);
      const at = profile && readJson(join(profile.dir, PROFILE_FILE))?.added;
      return profile && { profile, at: typeof at === 'string' ? at : '' };
    })
    .filter((each) => each !== null)
    .sort((a, b) => a.at.localeCompare(b.at) || a.profile.id.localeCompare(b.profile.id))
    .map((each) => each.profile);
  return [first, ...added];
}

/**
 * The added profile chosen last, when its last start stopped short: it never showed its window,
 * and the copy of the app that started it has gone, or has taken over a minute. One still
 * starting in another copy doesn't count, so opening the app again meanwhile brings that copy
 * forward.
 */
export function stoppedStart(home: string): ProfileFolder | null {
  const choice = readJson(join(home, OPEN_FILE));
  const open = choice?.open;
  const starting = choice?.starting;
  if (!isId(open) || typeof starting !== 'object' || starting === null) return null;
  const { pid, at } = starting as Record<string, unknown>;
  const going = typeof at === 'number' && Date.now() - at < START_MS && running(pid);
  return going ? null : readProfile(home, open);
}

/**
 * The profile the app opens: the one chosen last, while it's still there, or else the first. One
 * whose last start stopped short opens the first instead, so a profile that can't start never
 * shuts the others out. Read once, as the app starts, before anything uses the data folder.
 */
export function profileToOpen(home: string): ProfileFolder {
  const open = readJson(join(home, OPEN_FILE))?.open;
  const chosen = isId(open) && !stoppedStart(home) ? readProfile(home, open) : null;
  return chosen ?? (readProfile(home, FIRST_PROFILE) as ProfileFolder);
}

/** Notes which profile the app opens from now on. */
export function chooseProfile(home: string, id: string): void {
  writeJson(join(home, OPEN_FILE), { open: id });
}

/**
 * Notes that this copy of the app is starting on an added profile, until its window shows or it
 * quits. If neither happens, the next start opens the first profile.
 */
export function noteStarting(home: string, profile: Pick<ProfileFolder, 'id'>): void {
  if (profile.id === FIRST_PROFILE) return;
  const starting = { pid: process.pid, at: Date.now() };
  writeJson(join(home, OPEN_FILE), { open: profile.id, starting });
}

/** Adds a profile with its own empty folder, and Claude Code's folder ready in it. */
export function addProfile(home: string, name: string): ProfileFolder {
  let id = randomBytes(6).toString('hex');
  while (existsSync(folderOf(home, id))) id = randomBytes(6).toString('hex');
  const dir = folderOf(home, id);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, PROFILE_FILE), { name, added: new Date().toISOString() });
  const profile = { id, name, named: true, dir, sync: null };
  prepareClaudeFolder(claudeFolder(profile) as string);
  return profile;
}

/** Claude Code's own folder for a profile, or null for the first, which keeps the user's own. */
export function claudeFolder(profile: Pick<ProfileFolder, 'id' | 'dir'>): string | null {
  return profile.id === FIRST_PROFILE ? null : join(profile.dir, CLAUDE_FOLDER);
}

/**
 * Makes a profile's Claude Code folder, and marks Claude Code's first-run screens done there.
 * Signing in with `claude auth login` doesn't, so they'd show in Claude's panel on the profile's
 * first run, asking how text should look, and the setup check would stop on them. Each run sets
 * Claude Code's look itself.
 */
export function prepareClaudeFolder(folder: string): void {
  mkdirSync(folder, { recursive: true });
  const config = join(folder, '.claude.json');
  if (existsSync(config)) return;
  try {
    writeFileSync(config, `${JSON.stringify({ hasCompletedOnboarding: true }, null, 2)}\n`, {
      flag: 'wx',
    });
  } catch {
    // Claude Code made it first, which is just as good.
  }
}

/** The setting Claude Code saves once someone presses Enter through its first-run screens. */
const FIRST_RUN_DONE = 'hasCompletedOnboarding';

/** Whether Claude Code's first-run screens were marked done, already were, or were left alone. */
export type FirstRunMark = 'marked' | 'already' | 'left';

/**
 * Marks Claude Code's first-run screens done in the config it reads, as pressing Enter through
 * them does, so they never stop a run or the setup check: in `folder`, the one Claude Code runs
 * with as CLAUDE_CONFIG_DIR, or else the home folder. Signing in with `claude auth login` doesn't
 * mark them. Only that one setting is added: everything else in the file stays as it was. It's
 * written whole or not at all, under Claude Code's own lock, so a Claude Code saving its config
 * at the same moment never loses its change, nor this one. Left alone: a config Claude Code
 * couldn't read either, one in its older place, which it reads instead, one whose lock a Claude
 * Code holds, which waits for the next time, and one in a folder named from where Claude Code
 * runs, which isn't where the app is.
 */
export function markFirstRunDone(folder: string | null, home: string): FirstRunMark {
  if (folder !== null && !isAbsolute(folder)) return 'left';
  const file = join(folder ?? home, '.claude.json');
  if (existsSync(join(folder ?? join(home, '.claude'), '.config.json'))) return 'left';
  const before = readConfig(file);
  if (before?.[FIRST_RUN_DONE] === true) return 'already';
  if (!before) return 'left';
  // Claude Code's lock: a folder beside its config, made before it saves and removed after.
  const lock = `${file}.lock`;
  try {
    mkdirSync(lock);
  } catch {
    return 'left';
  }
  try {
    // As it is now, under the lock.
    const config = readConfig(file);
    if (config?.[FIRST_RUN_DONE] === true) return 'already';
    if (!config) return 'left';
    writeConfig(file, { ...config, [FIRST_RUN_DONE]: true });
    return 'marked';
  } catch {
    return 'left';
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      // Left to go stale, as Claude Code's own are when it can't remove them.
    }
  }
}

/**
 * Claude Code's config: empty when there's none yet, or null when there's something else there,
 * such as a file it couldn't read either, or a link to a config that's gone.
 */
function readConfig(file: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' && !isLink(file) ? {} : null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Writes Claude Code's config whole, the way it does: through a link to it, so a config kept
 * elsewhere stays there, and readable only by its owner, unless it was readable by more.
 */
function writeConfig(file: string, config: object): void {
  const target = existsSync(file) ? realpathSync(file) : file;
  const mode = existsSync(target) ? statSync(target).mode & 0o777 : 0o600;
  const draft = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(draft, JSON.stringify(config, null, 2), { mode, flag: 'wx' });
    renameSync(draft, target);
  } catch (error) {
    rmSync(draft, { force: true });
    throw error;
  }
}

export interface ProfilesDeps {
  /** The app's own data folder: the first profile's, which holds the others. */
  home: string;
  /** The profile that's open. */
  open: ProfileFolder;
  /** The open profile's own name, from About you, to name the first profile by. */
  ownName: () => string;
  /** Moves a folder to the trash, where it can be restored. */
  trash: (path: string) => Promise<void>;
  /** Whether Claude is working, which restarting the app would stop. */
  busy: () => boolean;
  /** Restarts the app, which opens the profile chosen. */
  restart: () => void;
  /** The profile whose last start stopped short, which the first profile opened in place of. */
  stopped?: ProfileFolder | null;
}

/** The profiles on this computer, as the window sees and changes them. */
export class Profiles {
  private readonly deps: ProfilesDeps;
  /** The sync account the open profile uses, as sync last said. */
  private syncAccount: SyncAccountNote | null;
  /** Whether that's kept with the profile, or doesn't need to be yet. */
  private syncKept = true;

  constructor(deps: ProfilesDeps) {
    this.deps = deps;
    this.syncAccount = deps.open.sync;
  }

  list(): ProfileList {
    const { home, open } = this.deps;
    return {
      profiles: listProfiles(home).map((profile) => ({
        id: profile.id,
        name: profile.name,
        open: profile.id === open.id,
        first: profile.id === FIRST_PROFILE,
        named: profile.named,
      })),
      claudeFolder: claudeFolder(open),
      ...(this.deps.stopped && { stopped: this.deps.stopped.name }),
    };
  }

  /**
   * The open profile started, as its window showed or the app is quitting as usual, so it opens
   * again next time. Only its own note of starting is cleared, never a choice made since, such as
   * the profile the app is about to restart on. A write that fails is tried again the next time.
   */
  started(): void {
    const { home, open } = this.deps;
    if (open.id === FIRST_PROFILE) return;
    const choice = readJson(join(home, OPEN_FILE));
    if (choice?.open !== open.id || choice?.starting === undefined) return;
    try {
      chooseProfile(home, open.id);
    } catch {
      // Tried again as the window comes forward, or the app quits.
    }
  }

  /**
   * Adds a profile for someone else, or a fresh start. It opens once the window asks. Until now
   * the first profile was the only one, with no need of a name, so it gets one too: the name the
   * window gives, or else its person's own.
   */
  add(value: unknown, firstValue?: unknown): AddProfileResult {
    const name = parseProfileName(value);
    if (!name) return failed(NAME_IT);
    const { home, open } = this.deps;
    const profiles = listProfiles(home);
    const taken = sameName(name, profiles);
    if (taken) return failed(`There’s already a profile called ${taken.name}.`);
    const first = profiles[0] as ProfileFolder;
    const naming = open.id === FIRST_PROFILE && !first.named;
    const own = naming
      ? (parseProfileName(firstValue) ?? parseProfileName(this.deps.ownName()) ?? first.name)
      : null;
    if (own && sameName(own, [{ id: '', name }])) {
      return failed('Give the two profiles different names.');
    }
    let added: ProfileFolder;
    try {
      added = addProfile(home, name);
    } catch {
      return failed('The new profile’s folder couldn’t be made. Try again.');
    }
    try {
      if (own) keep(first, { name: own });
    } catch {
      // It goes by First profile until it's renamed.
    }
    this.keepSyncAccount();
    return { ok: true, id: added.id };
  }

  rename(id: unknown, value: unknown): EditResult {
    const name = parseProfileName(value);
    if (!name) return failed(NAME_IT);
    const profiles = listProfiles(this.deps.home);
    const profile = profiles.find((each) => each.id === id);
    if (!profile) return failed('That profile isn’t on this computer anymore.');
    const taken = sameName(name, profiles, profile.id);
    if (taken) return failed(`There’s already a profile called ${taken.name}.`);
    try {
      keep(profile, { name });
    } catch {
      return failed('The new name couldn’t be saved. Try again.');
    }
    return { ok: true };
  }

  /**
   * Moves an added profile's folder to the trash, where it can be restored. Never the open one,
   * which is in use, the first, whose folder holds the others, or one open in another copy of the
   * app.
   */
  async remove(id: unknown): Promise<EditResult> {
    const { home, open } = this.deps;
    if (id === FIRST_PROFILE) return failed('The first profile can’t be removed.');
    if (id === open.id) return failed('Open another profile, then remove this one.');
    const profile = isId(id) ? readProfile(home, id) : null;
    if (!profile) return failed('That profile isn’t on this computer anymore.');
    if (openElsewhere(profile.dir)) {
      return failed('That profile is open in another copy of Factwright. Quit that copy first.');
    }
    try {
      await this.deps.trash(profile.dir);
    } catch {
      return failed('Its folder couldn’t be moved to the trash.');
    }
    return { ok: true };
  }

  /** Restarts the app on another profile. Not while Claude is working, which would stop it. */
  open(id: unknown): EditResult {
    const { home, open } = this.deps;
    const profile = isId(id) ? readProfile(home, id) : null;
    if (!profile) return failed('That profile isn’t on this computer anymore.');
    if (profile.id === open.id) return { ok: true };
    if (this.deps.busy()) {
      return failed('Stop Claude’s run first, as switching restarts Factwright.');
    }
    try {
      chooseProfile(home, profile.id);
    } catch {
      return failed('Factwright couldn’t note which profile to open. Try again.');
    }
    this.deps.restart();
    return { ok: true };
  }

  /**
   * Notes the sync account the open profile uses, by its email and server, or null once sync is
   * off here. It's kept with the profile only once there are others, so they can turn it away.
   */
  noteSync(account: SyncAccountNote | null): void {
    if (sameAccount(account, this.syncAccount) && this.syncKept) return;
    this.syncAccount = account;
    this.keepSyncAccount();
  }

  /** The sync accounts the other profiles here use, by email and server, with each one's name. */
  otherSyncAccounts(): { name: string; email: string; server: string | null }[] {
    return listProfiles(this.deps.home).flatMap((profile) =>
      profile.id !== this.deps.open.id && profile.sync
        ? [{ name: profile.name, ...profile.sync }]
        : [],
    );
  }

  private keepSyncAccount(): void {
    const { home, open } = this.deps;
    const profiles = listProfiles(home);
    const mine = profiles.find((profile) => profile.id === open.id);
    this.syncKept = true;
    if (profiles.length < 2 || !mine || sameAccount(mine.sync, this.syncAccount)) return;
    try {
      keep(mine, {
        sync: this.syncAccount?.email ?? null,
        syncServer: this.syncAccount?.server ?? null,
      });
    } catch {
      // Tried again the next time sync says where it stands.
      this.syncKept = false;
    }
  }
}
