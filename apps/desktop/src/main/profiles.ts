import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
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
 * added later gets a folder inside it, under Profiles, named by a random ID that's never used
 * again. Its own Claude Code folder sits in there too, so its Claude login is its own.
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

/** Claude Code's own folder, in an added profile's folder: its login, settings and history. */
const CLAUDE_FOLDER = 'claude';

/** An added profile's ID: 12 random letters and numbers. */
const ADDED_ID = /^[0-9a-f]{12}$/;

/** What the first profile is called until it has a name. */
const FIRST_NAME = 'First profile';

/** What a profile whose name can't be read is called, so it still shows, to open or remove. */
const NO_NAME = 'Unnamed profile';

/** A profile's folder, and what's kept about it there. */
export interface ProfileFolder {
  id: string;
  /** Its name, or what it goes by until it has one. */
  name: string;
  named: boolean;
  /** Its data folder: the app's own for the first profile, and one inside it for the rest. */
  dir: string;
  /** The email of the sync account it uses, once it's noted, so no other profile here uses it. */
  sync: string | null;
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
  writeFileSync(draft, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(draft, file);
}

/** The folder a profile's data is in. */
const folderOf = (home: string, id: string) =>
  id === FIRST_PROFILE ? home : join(home, ADDED_FOLDER, id);

/** A profile, from its folder, or null for an added one that's missing or was never finished. */
function readProfile(home: string, id: string): ProfileFolder | null {
  const dir = folderOf(home, id);
  const file = join(dir, PROFILE_FILE);
  // An added profile's file is written first, so a folder without one was never finished.
  if (id !== FIRST_PROFILE && !existsSync(file)) return null;
  const kept = readJson(file);
  const name = parseProfileName(kept?.name);
  const sync = typeof kept?.sync === 'string' && kept.sync ? kept.sync : null;
  const unnamed = id === FIRST_PROFILE ? FIRST_NAME : NO_NAME;
  return { id, name: name ?? unnamed, named: name !== null, dir, sync };
}

/** Changes what's kept about a profile, keeping the rest. */
function keep(profile: ProfileFolder, changes: Record<string, unknown>): void {
  const file = join(profile.dir, PROFILE_FILE);
  writeJson(file, { ...readJson(file), ...changes });
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
 * The profile the app opens: the one chosen last, while it's still there, or else the first.
 * Read once, as the app starts, before anything uses the data folder.
 */
export function profileToOpen(home: string): ProfileFolder {
  const open = readJson(join(home, OPEN_FILE))?.open;
  const chosen = isId(open) ? readProfile(home, open) : null;
  return chosen ?? (readProfile(home, FIRST_PROFILE) as ProfileFolder);
}

/** Notes which profile the app opens from now on. */
export function chooseProfile(home: string, id: string): void {
  writeJson(join(home, OPEN_FILE), { open: id });
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

/** Text in single quotes for a Mac or Linux shell, which take everything in them as it is. */
const shellQuoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/** Text in single quotes for PowerShell, which takes curly single quotes as quotes too. */
const powerShellQuoted = (text: string) => `'${text.replace(/['‘’‚‛]/g, '$&$&')}'`;

/**
 * The command that signs a profile in to Claude Code, for the user to run in their terminal:
 * with the profile's own Claude Code folder, when it has one.
 */
export function signInCommand(platform: NodeJS.Platform, folder: string | null): string {
  if (!folder) return 'claude auth login';
  return platform === 'win32'
    ? `$env:CLAUDE_CONFIG_DIR=${powerShellQuoted(folder)}; claude auth login`
    : `CLAUDE_CONFIG_DIR=${shellQuoted(folder)} claude auth login`;
}

export interface ProfilesDeps {
  /** The app's own data folder: the first profile's, which holds the others. */
  home: string;
  /** The profile that's open. */
  open: ProfileFolder;
  platform: NodeJS.Platform;
  /** The open profile's own name, from About you, to name the first profile by. */
  ownName: () => string;
  /** Moves a folder to the trash, where it can be restored. */
  trash: (path: string) => Promise<void>;
  /** Whether Claude is working, which restarting the app would stop. */
  busy: () => boolean;
  /** Restarts the app, which opens the profile chosen. */
  restart: () => void;
}

/** The profiles on this computer, as the window sees and changes them. */
export class Profiles {
  private readonly deps: ProfilesDeps;
  /** The sync account the open profile uses, as sync last said. */
  private syncAccount: string | null;

  constructor(deps: ProfilesDeps) {
    this.deps = deps;
    this.syncAccount = deps.open.sync;
  }

  list(): ProfileList {
    const { home, open, platform } = this.deps;
    return {
      profiles: listProfiles(home).map((profile) => ({
        id: profile.id,
        name: profile.name,
        open: profile.id === open.id,
        first: profile.id === FIRST_PROFILE,
        named: profile.named,
      })),
      claudeSignIn: signInCommand(platform, claudeFolder(open)),
    };
  }

  /**
   * Adds a profile for someone else, or a fresh start. It opens once the window asks. Until now
   * the first profile was the only one, with no need of a name, so it gets one too: the name the
   * window gives, or else its person's own.
   */
  add(value: unknown, firstValue?: unknown): AddProfileResult {
    const name = parseProfileName(value);
    if (!name) return failed('Give it a name of up to 40 letters.');
    const { home, open } = this.deps;
    const profiles = listProfiles(home);
    const taken = sameName(name, profiles);
    if (taken) return failed(`There’s already a profile called ${taken.name}.`);
    const first = profiles[0] as ProfileFolder;
    if (open.id === FIRST_PROFILE && !first.named) {
      const own =
        parseProfileName(firstValue) ?? parseProfileName(this.deps.ownName()) ?? first.name;
      if (sameName(own, [{ id: '', name }]))
        return failed('Give the two profiles different names.');
      keep(first, { name: own });
    }
    try {
      const added = addProfile(home, name);
      this.keepSyncAccount();
      return { ok: true, id: added.id };
    } catch {
      return failed('The new profile’s folder couldn’t be made.');
    }
  }

  rename(id: unknown, value: unknown): EditResult {
    const name = parseProfileName(value);
    if (!name) return failed('Give it a name of up to 40 letters.');
    const profiles = listProfiles(this.deps.home);
    const profile = profiles.find((each) => each.id === id);
    if (!profile) return failed('That profile isn’t on this computer anymore.');
    const taken = sameName(name, profiles, profile.id);
    if (taken) return failed(`There’s already a profile called ${taken.name}.`);
    keep(profile, { name });
    return { ok: true };
  }

  /**
   * Moves an added profile's folder to the trash, where it can be restored. Never the open one,
   * which is in use, or the first, whose folder holds the others.
   */
  async remove(id: unknown): Promise<EditResult> {
    const { home, open } = this.deps;
    if (id === FIRST_PROFILE) return failed('The first profile can’t be removed.');
    if (id === open.id) return failed('Open another profile, then remove this one.');
    const profile = isId(id) ? readProfile(home, id) : null;
    if (!profile) return failed('That profile isn’t on this computer anymore.');
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
    if (this.deps.busy())
      return failed('Stop Claude’s run first, as switching restarts Factwright.');
    chooseProfile(home, profile.id);
    this.deps.restart();
    return { ok: true };
  }

  /**
   * Notes the sync account the open profile uses, by its email, or null once sync is off here.
   * It's kept with the profile only once there are others, so they can turn it away.
   */
  noteSync(email: string | null): void {
    if (email === this.syncAccount) return;
    this.syncAccount = email;
    this.keepSyncAccount();
  }

  /** The sync accounts the other profiles here use, by email, with each profile's name. */
  otherSyncAccounts(): { name: string; email: string }[] {
    return listProfiles(this.deps.home).flatMap((profile) =>
      profile.id !== this.deps.open.id && profile.sync
        ? [{ name: profile.name, email: profile.sync }]
        : [],
    );
  }

  private keepSyncAccount(): void {
    const { home, open } = this.deps;
    const profiles = listProfiles(home);
    const kept = profiles.find((profile) => profile.id === open.id);
    if (profiles.length < 2 || !kept || kept.sync === this.syncAccount) return;
    try {
      keep(kept, { sync: this.syncAccount });
    } catch {
      // Noted again the next time sync says where it stands.
    }
  }
}
