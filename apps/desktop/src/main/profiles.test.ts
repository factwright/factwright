import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addProfile,
  chooseProfile,
  claudeFolder,
  FIRST_PROFILE,
  listProfiles,
  markFirstRunDone,
  noteStarting,
  type ProfileFolder,
  Profiles,
  type ProfilesDeps,
  prepareClaudeFolder,
  profileToOpen,
  stoppedStart,
} from './profiles.ts';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'factwright-profiles-'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

/** A second later, so profiles added one after another keep their order. */
const tick = () => vi.setSystemTime(new Date(Date.now() + 1000));

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

/** Alex's sync account, on Factwright's own server. */
const ALEX = { email: 'alex@example.com', server: null };

/** A data folder as an earlier version left it: a job hunt, a tracker and sync's notes. */
function earlierJobHunt(): string[] {
  mkdirSync(join(home, 'workspace', 'jobs'), { recursive: true });
  writeFileSync(join(home, 'workspace', 'jobs', 'acme.md'), '# Acme\n');
  writeFileSync(join(home, 'tracker.db'), 'tracker');
  mkdirSync(join(home, 'sync'));
  writeFileSync(join(home, 'sync', 'secrets.json'), '{}');
  return readdirSync(home).sort();
}

describe('the profile the app opens', () => {
  it('is the first, in the app’s own folder, when no profile was ever added', () => {
    const before = earlierJobHunt();
    const profile = profileToOpen(home);
    expect(profile).toEqual({
      id: FIRST_PROFILE,
      name: 'First profile',
      named: false,
      dir: home,
      sync: null,
    });
    // Opening it changes nothing in the folder.
    expect(readdirSync(home).sort()).toEqual(before);
    expect(claudeFolder(profile)).toBeNull();
  });

  it('is the one chosen last, while its folder is there', () => {
    const added = addProfile(home, 'Sam');
    chooseProfile(home, added.id);
    expect(profileToOpen(home)).toMatchObject({ id: added.id, name: 'Sam', dir: added.dir });
    rmSync(added.dir, { recursive: true });
    expect(profileToOpen(home).id).toBe(FIRST_PROFILE);
  });

  it('is the first when the chosen one’s last start stopped short of its window', () => {
    const sam = addProfile(home, 'Sam');
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const choose = (starting: object) =>
      writeFileSync(join(home, 'profiles.json'), JSON.stringify({ open: sam.id, starting }));
    // Started in a copy of the app that has gone, without showing its window.
    choose({ pid: gone, at: Date.now() });
    expect(stoppedStart(home)?.id).toBe(sam.id);
    expect(profileToOpen(home).id).toBe(FIRST_PROFILE);
    // Still starting in a copy that's running, so opening the app again brings that copy forward.
    choose({ pid: process.pid, at: Date.now() });
    expect(stoppedStart(home)).toBeNull();
    expect(profileToOpen(home).id).toBe(sam.id);
    // Starting for over a minute counts as stopped.
    choose({ pid: process.pid, at: Date.now() - 61_000 });
    expect(profileToOpen(home).id).toBe(FIRST_PROFILE);
  });

  it('notes a start until the window shows, never overwriting a choice made since', () => {
    const sam = addProfile(home, 'Sam');
    tick();
    const testing = addProfile(home, 'Testing');
    noteStarting(home, sam);
    expect(readJson(join(home, 'profiles.json'))).toEqual({
      open: sam.id,
      starting: { pid: process.pid, at: Date.now() },
    });
    const opened = profiles(sam).opened;
    opened.started();
    expect(readJson(join(home, 'profiles.json'))).toEqual({ open: sam.id });
    // Switching chose another before the app quit: quitting leaves that choice alone.
    chooseProfile(home, testing.id);
    opened.started();
    expect(readJson(join(home, 'profiles.json'))).toEqual({ open: testing.id });
    // The first profile is where the others fall back to, so its starts aren't noted.
    noteStarting(home, { id: FIRST_PROFILE });
    expect(readJson(join(home, 'profiles.json'))).toEqual({ open: testing.id });
  });

  it('says which profile stopped short, for the window to tell', () => {
    const sam = addProfile(home, 'Sam');
    const { opened } = profiles(profileToOpen(home), { stopped: sam });
    expect(opened.list().stopped).toBe('Sam');
    expect(profiles(profileToOpen(home)).opened.list()).not.toHaveProperty('stopped');
  });

  it('never opens a profile folder that’s a link to a folder somewhere else', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'factwright-elsewhere-'));
    try {
      writeFileSync(join(elsewhere, 'profile.json'), JSON.stringify({ name: 'Linked' }));
      mkdirSync(join(home, 'Profiles'));
      symlinkSync(elsewhere, join(home, 'Profiles', 'abcdefabcdef'));
      chooseProfile(home, 'abcdefabcdef');
      expect(profileToOpen(home).id).toBe(FIRST_PROFILE);
      expect(listProfiles(home).map((profile) => profile.id)).toEqual([FIRST_PROFILE]);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('is the first when the choice can’t be read, or names no profile', () => {
    writeFileSync(join(home, 'profiles.json'), 'not json');
    expect(profileToOpen(home).id).toBe(FIRST_PROFILE);
    writeFileSync(join(home, 'profiles.json'), JSON.stringify({ open: '../../elsewhere' }));
    expect(profileToOpen(home).id).toBe(FIRST_PROFILE);
    writeFileSync(join(home, 'profiles.json'), JSON.stringify({ open: 'abcdefabcdef' }));
    expect(profileToOpen(home).id).toBe(FIRST_PROFILE);
  });
});

describe('adding a profile', () => {
  it('makes an empty folder inside the first profile’s, leaving the first profile’s job hunt as it was', () => {
    const before = earlierJobHunt();
    const added = addProfile(home, 'Sam');
    expect(added.id).toMatch(/^[0-9a-f]{12}$/);
    expect(added.dir).toBe(join(home, 'Profiles', added.id));
    expect(readdirSync(home).sort()).toEqual([...before, 'Profiles'].sort());
    expect(readFileSync(join(home, 'workspace', 'jobs', 'acme.md'), 'utf8')).toBe('# Acme\n');
    expect(readJson(join(added.dir, 'profile.json'))).toMatchObject({ name: 'Sam' });
    // Its own Claude Code folder, with Claude Code's first-run screens marked done.
    expect(claudeFolder(added)).toBe(join(added.dir, 'claude'));
    expect(readJson(join(added.dir, 'claude', '.claude.json'))).toEqual({
      hasCompletedOnboarding: true,
    });
  });

  it('lists profiles in the order they came, and skips folders that were never finished', () => {
    const sam = addProfile(home, 'Sam');
    tick();
    const testing = addProfile(home, 'Testing');
    mkdirSync(join(home, 'Profiles', '0123456789ab'));
    mkdirSync(join(home, 'Profiles', 'not-a-profile'));
    expect(listProfiles(home).map((profile) => profile.id)).toEqual([
      FIRST_PROFILE,
      sam.id,
      testing.id,
    ]);
  });

  it('still lists a profile whose name can’t be read, so it can be opened or removed', () => {
    const sam = addProfile(home, 'Sam');
    writeFileSync(join(sam.dir, 'profile.json'), '{');
    expect(listProfiles(home)[1]).toMatchObject({
      id: sam.id,
      name: 'Unnamed profile',
      named: false,
    });
  });
});

describe('Claude Code for a profile', () => {
  it('keeps what Claude Code already wrote in its folder', () => {
    const folder = join(home, 'claude');
    mkdirSync(folder);
    writeFileSync(join(folder, '.claude.json'), '{"theme":"dark"}');
    prepareClaudeFolder(folder);
    expect(readFileSync(join(folder, '.claude.json'), 'utf8')).toBe('{"theme":"dark"}');
  });
});

describe('Claude Code’s first-run screens', () => {
  // `home` stands in for the user's home folder, and the folder Claude Code runs with.
  const POSIX = process.platform !== 'win32';

  /** A config as Claude Code writes it, with a sign-in, a trusted folder and its own settings. */
  const CONFIG = {
    numStartups: 3,
    oauthAccount: { emailAddress: 'alex@example.com', organizationUuid: 'org-1' },
    projects: { '/Users/alex/work': { hasTrustDialogAccepted: true, allowedTools: [] } },
    theme: 'light',
    tipsHistory: { 'new-user-warmup': 1 },
    userID: 'é…✓',
  };

  it('marks them done in the home folder’s config, keeping everything else as it was', () => {
    const file = join(home, '.claude.json');
    writeFileSync(file, JSON.stringify(CONFIG, null, 2), { mode: 0o600 });
    expect(markFirstRunDone(null, home)).toBe('marked');
    const written = readJson(file);
    expect(written).toEqual({ ...CONFIG, hasCompletedOnboarding: true });
    expect(Object.keys(written)).toEqual([...Object.keys(CONFIG), 'hasCompletedOnboarding']);
    // Still only its owner's to read, with no draft or lock left behind.
    if (POSIX) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(home)).toEqual(['.claude.json']);
    // Once they're done, there's nothing to write.
    const text = readFileSync(file, 'utf8');
    expect(markFirstRunDone(null, home)).toBe('already');
    expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('marks them in the folder Claude Code runs with, making its config when there’s none', () => {
    const folder = join(home, 'claude');
    mkdirSync(folder);
    expect(markFirstRunDone(folder, home)).toBe('marked');
    expect(readJson(join(folder, '.claude.json'))).toEqual({ hasCompletedOnboarding: true });
    if (POSIX) expect(statSync(join(folder, '.claude.json')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(home, '.claude.json'))).toBe(false);
  });

  it('leaves a config alone that Claude Code couldn’t read either', () => {
    const file = join(home, '.claude.json');
    for (const text of ['{"theme": "dark",', '[]', '"done"', '']) {
      writeFileSync(file, text);
      expect(markFirstRunDone(null, home)).toBe('left');
      expect(readFileSync(file, 'utf8')).toBe(text);
    }
  });

  it('leaves a folder named from where Claude Code runs, which isn’t where the app is', () => {
    expect(markFirstRunDone('claude-config', home)).toBe('left');
    expect(existsSync(join(home, '.claude.json'))).toBe(false);
  });

  it('leaves the config alone when Claude Code reads one from its older place instead', () => {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', '.config.json'), '{"theme":"dark"}');
    expect(markFirstRunDone(null, home)).toBe('left');
    expect(existsSync(join(home, '.claude.json'))).toBe(false);
    const folder = join(home, 'claude');
    mkdirSync(folder);
    writeFileSync(join(folder, '.config.json'), '{"theme":"dark"}');
    expect(markFirstRunDone(folder, home)).toBe('left');
    expect(existsSync(join(folder, '.claude.json'))).toBe(false);
  });

  it('waits while a Claude Code holds the lock on its config, and leaves its lock be', () => {
    const file = join(home, '.claude.json');
    writeFileSync(file, '{"theme":"dark"}');
    mkdirSync(`${file}.lock`);
    expect(markFirstRunDone(null, home)).toBe('left');
    expect(readFileSync(file, 'utf8')).toBe('{"theme":"dark"}');
    expect(existsSync(`${file}.lock`)).toBe(true);
    // Once Claude Code has saved and let go, the next time marks them.
    rmdirSync(`${file}.lock`);
    expect(markFirstRunDone(null, home)).toBe('marked');
    expect(readJson(file)).toEqual({ theme: 'dark', hasCompletedOnboarding: true });
  });

  it.skipIf(!POSIX)('writes through a link to a config kept elsewhere, which stays a link', () => {
    const file = join(home, '.claude.json');
    mkdirSync(join(home, 'dotfiles'));
    const kept = join(home, 'dotfiles', 'claude.json');
    writeFileSync(kept, '{"theme":"dark"}', { mode: 0o644 });
    symlinkSync(kept, file);
    expect(markFirstRunDone(null, home)).toBe('marked');
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(readJson(kept)).toEqual({ theme: 'dark', hasCompletedOnboarding: true });
    expect(statSync(kept).mode & 0o777).toBe(0o644);
    expect(readdirSync(join(home, 'dotfiles'))).toEqual(['claude.json']);
    // A link to a config that's gone is left as it is.
    rmSync(kept);
    expect(markFirstRunDone(null, home)).toBe('left');
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(existsSync(kept)).toBe(false);
  });
});

/** The profiles as the open app sees them, with the restart and the trash stood in for. */
function profiles(open: ProfileFolder, deps: Partial<ProfilesDeps> = {}) {
  const restart = vi.fn();
  const trash = vi.fn(async (_path: string) => {});
  const busy = vi.fn(() => false);
  const opened = new Profiles({
    home,
    open,
    ownName: () => 'Alex Rivera',
    trash,
    busy,
    restart,
    ...deps,
  });
  return { opened, restart, trash, busy };
}

describe('Profiles, as the window uses them', () => {
  it('lists each profile, which one is open, and where the open one keeps its Claude login', () => {
    const sam = addProfile(home, 'Sam');
    const { opened } = profiles(sam);
    expect(opened.list()).toEqual({
      profiles: [
        { id: FIRST_PROFILE, name: 'First profile', open: false, first: true, named: false },
        { id: sam.id, name: 'Sam', open: true, first: false, named: true },
      ],
      claudeFolder: join(sam.dir, 'claude'),
    });
    // The first profile uses the user's own Claude Code setup.
    expect(profiles(profileToOpen(home)).opened.list().claudeFolder).toBeNull();
  });

  it('names the first profile when the second is added: as asked, or after its person', () => {
    const { opened } = profiles(profileToOpen(home));
    expect(opened.add('  Sam  ', 'Alex')).toMatchObject({ ok: true });
    expect(listProfiles(home).map((profile) => profile.name)).toEqual(['Alex', 'Sam']);
    // Once it has a name, adding another leaves it.
    expect(opened.add('Testing', 'Someone else')).toMatchObject({ ok: true });
    expect(listProfiles(home)[0]?.name).toBe('Alex');
  });

  it('names the first profile after its person, when the window doesn’t say', () => {
    const { opened } = profiles(profileToOpen(home));
    expect(opened.add('Sam')).toMatchObject({ ok: true });
    expect(listProfiles(home).map((profile) => profile.name)).toEqual(['Alex Rivera', 'Sam']);
  });

  it('won’t give the first profile and the new one the same name', () => {
    const { opened } = profiles(profileToOpen(home));
    expect(opened.add('Sam', 'sam')).toEqual({
      ok: false,
      message: 'Give the two profiles different names.',
    });
    expect(listProfiles(home)).toHaveLength(1);
  });

  it('keeps the first profile’s own name once it has one', () => {
    const { opened } = profiles(profileToOpen(home), { ownName: () => '' });
    expect(opened.add('Sam').ok).toBe(true);
    expect(opened.rename(FIRST_PROFILE, 'Alex')).toEqual({ ok: true });
    tick();
    expect(opened.add('Testing').ok).toBe(true);
    expect(listProfiles(home).map((profile) => profile.name)).toEqual(['Alex', 'Sam', 'Testing']);
  });

  it('turns away a name that’s empty, too long, or another profile’s', () => {
    const { opened } = profiles(profileToOpen(home));
    expect(opened.add('Sam')).toMatchObject({ ok: true });
    expect(opened.add('sam')).toEqual({
      ok: false,
      message: 'There’s already a profile called Sam.',
    });
    expect(opened.add('   ')).toMatchObject({ ok: false });
    expect(opened.add('x'.repeat(41))).toMatchObject({ ok: false });
    expect(opened.add('Sam\u0007')).toMatchObject({ ok: false });
    expect(opened.add(42)).toMatchObject({ ok: false });
    const sam = listProfiles(home)[1] as ProfileFolder;
    expect(opened.rename(sam.id, 'alex rivera')).toEqual({
      ok: false,
      message: 'There’s already a profile called Alex Rivera.',
    });
    expect(opened.rename(sam.id, 'Samantha')).toEqual({ ok: true });
    expect(opened.rename('abcdefabcdef', 'Pat')).toMatchObject({ ok: false });
  });

  it('removes an added profile to the trash, but never the open one or the first', async () => {
    const sam = addProfile(home, 'Sam');
    const testing = addProfile(home, 'Testing');
    const { opened, trash } = profiles(sam);
    expect(await opened.remove(FIRST_PROFILE)).toMatchObject({ ok: false });
    expect(await opened.remove(sam.id)).toMatchObject({ ok: false });
    expect(await opened.remove('../..')).toMatchObject({ ok: false });
    expect(trash).not.toHaveBeenCalled();
    expect(await opened.remove(testing.id)).toEqual({ ok: true });
    expect(trash).toHaveBeenCalledWith(testing.dir);
  });

  it.runIf(process.platform === 'win32')(
    'won’t remove a profile another copy of the app has open, on Windows',
    async () => {
      const testing = addProfile(home, 'Testing');
      const { opened, trash } = profiles(profileToOpen(home));
      // On Windows, Chromium's lock is a file that goes when the copy that holds it closes.
      writeFileSync(join(testing.dir, 'lockfile'), '');
      expect(await opened.remove(testing.id)).toEqual({
        ok: false,
        message: 'That profile is open in another copy of Factwright. Quit that copy first.',
      });
      expect(trash).not.toHaveBeenCalled();
      rmSync(join(testing.dir, 'lockfile'));
      expect(await opened.remove(testing.id)).toEqual({ ok: true });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'won’t remove a profile another copy of the app has open',
    async () => {
      const testing = addProfile(home, 'Testing');
      const { opened, trash } = profiles(profileToOpen(home));
      const lock = (holder: string) => {
        rmSync(join(testing.dir, 'SingletonLock'), { force: true });
        symlinkSync(holder, join(testing.dir, 'SingletonLock'));
      };
      // Chromium's lock names the computer and process that hold the folder.
      lock(`${hostname()}-${process.pid}`);
      expect(await opened.remove(testing.id)).toEqual({
        ok: false,
        message: 'That profile is open in another copy of Factwright. Quit that copy first.',
      });
      expect(trash).not.toHaveBeenCalled();
      // A lock left by a copy that's no longer running, or by another computer, doesn't count.
      lock(`other-computer-${process.pid}`);
      expect(await opened.remove(testing.id)).toEqual({ ok: true });
      lock(`${hostname()}-${spawnSync(process.execPath, ['-e', '']).pid}`);
      expect(await opened.remove(testing.id)).toEqual({ ok: true });
    },
  );

  it('says so when the trash won’t take a profile', async () => {
    const sam = addProfile(home, 'Sam');
    const { opened } = profiles(profileToOpen(home), {
      trash: async () => {
        throw new Error('no trash here');
      },
    });
    expect(await opened.remove(sam.id)).toEqual({
      ok: false,
      message: 'Its folder couldn’t be moved to the trash.',
    });
    expect(existsSync(sam.dir)).toBe(true);
  });

  it('restarts on another profile, but not while Claude is working', () => {
    const sam = addProfile(home, 'Sam');
    const working = profiles(profileToOpen(home), { busy: () => true });
    expect(working.opened.open(sam.id)).toEqual({
      ok: false,
      message: 'Stop Claude’s run first, as switching restarts Factwright.',
    });
    expect(working.restart).not.toHaveBeenCalled();
    expect(profileToOpen(home).id).toBe(FIRST_PROFILE);

    const { opened, restart } = profiles(profileToOpen(home));
    expect(opened.open(FIRST_PROFILE)).toEqual({ ok: true });
    expect(restart).not.toHaveBeenCalled();
    expect(opened.open('abcdefabcdef')).toMatchObject({ ok: false });
    expect(opened.open(sam.id)).toEqual({ ok: true });
    expect(restart).toHaveBeenCalledOnce();
    expect(profileToOpen(home).id).toBe(sam.id);
  });

  it('says so when a profile can’t be added, and leaves the first profile as it was', () => {
    writeFileSync(join(home, 'Profiles'), 'not a folder');
    const { opened } = profiles(profileToOpen(home));
    expect(opened.add('Sam', 'Alex')).toEqual({
      ok: false,
      message: 'The new profile’s folder couldn’t be made. Try again.',
    });
    expect(listProfiles(home)).toEqual([profileToOpen(home)]);
    expect(existsSync(join(home, 'profile.json'))).toBe(false);
  });

  it('notes a sync account again when it couldn’t be kept the first time', () => {
    const first = profiles(profileToOpen(home));
    // The first profile's file can't be written for now.
    mkdirSync(join(home, 'profile.json'));
    first.opened.noteSync(ALEX);
    expect(first.opened.add('Sam').ok).toBe(true);
    rmSync(join(home, 'profile.json'), { recursive: true });
    first.opened.noteSync(ALEX);
    expect(readJson(join(home, 'profile.json'))).toMatchObject({ sync: 'alex@example.com' });
    expect(readdirSync(home).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('notes the sync account a profile uses only once there are others, for them to turn away', () => {
    const first = profiles(profileToOpen(home));
    first.opened.noteSync(ALEX);
    // With one profile, nothing is written in the app's folder.
    expect(existsSync(join(home, 'profile.json'))).toBe(false);
    expect(first.opened.add('Sam').ok).toBe(true);
    expect(readJson(join(home, 'profile.json'))).toMatchObject({ sync: 'alex@example.com' });

    const sam = listProfiles(home)[1] as ProfileFolder;
    const second = profiles(sam);
    expect(second.opened.otherSyncAccounts()).toEqual([
      { name: 'Alex Rivera', email: 'alex@example.com', server: null },
    ]);
    second.opened.noteSync({ email: 'sam@example.com', server: null });
    expect(first.opened.otherSyncAccounts()).toEqual([
      { name: 'Sam', email: 'sam@example.com', server: null },
    ]);
    // Turning sync off frees the account.
    second.opened.noteSync(null);
    expect(first.opened.otherSyncAccounts()).toEqual([]);
  });

  it('notes which server a profile syncs with, as the same email elsewhere is another account', () => {
    const first = profiles(profileToOpen(home));
    expect(first.opened.add('Sam').ok).toBe(true);
    const own = 'https://factwright-sync.sam.workers.dev';
    first.opened.noteSync({ email: 'alex@example.com', server: own });
    expect(readJson(join(home, 'profile.json'))).toMatchObject({
      sync: 'alex@example.com',
      syncServer: own,
    });
    const second = profiles(listProfiles(home)[1] as ProfileFolder);
    expect(second.opened.otherSyncAccounts()).toEqual([
      { name: 'Alex Rivera', email: 'alex@example.com', server: own },
    ]);
    // Moving to Factwright's own sync, with the same email, is noted too.
    first.opened.noteSync(ALEX);
    expect(second.opened.otherSyncAccounts()).toEqual([
      { name: 'Alex Rivera', email: 'alex@example.com', server: null },
    ]);
  });

  it('reads a sync account noted before there were servers of your own as Factwright’s', () => {
    expect(profiles(profileToOpen(home)).opened.add('Sam').ok).toBe(true);
    writeFileSync(
      join(home, 'profile.json'),
      JSON.stringify({ name: 'Alex Rivera', sync: 'alex@example.com' }),
    );
    expect(profileToOpen(home).sync).toEqual(ALEX);
  });
});
