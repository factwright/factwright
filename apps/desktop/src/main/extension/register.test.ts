import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROWSERS } from './browsers.ts';
import {
  type Disk,
  helperName,
  localDisk,
  registerSaveHelper,
  runProgram,
  type SaveHelperDeps,
  saveHelperStatus,
  setUpSaveHelper,
} from './register.ts';

/** The extension's Chrome Web Store item. */
const STORE = 'gjhjddlohoonikgdbfcfnljeffilblai';
/** An unpacked copy of the extension, being developed. */
const UNPACKED = 'abcdefghijklmnopabcdefghijklmnop';

/** Alex's Mac. */
const MAC_HOME = '/Users/alex';
const SUPPORT = '/Users/alex/Library/Application Support';
const MAC_APP_HOME = `${SUPPORT}/Factwright`;
const MAC_HELPER = '/Applications/Factwright.app/Contents/Resources/helper/factwright-save';
const MAC_RECORD = `${MAC_APP_HOME}/save-helper.json`;
/** Where a browser's manifest goes on a Mac, from its manifests folder. */
const manifestIn = (folder: string) =>
  `${SUPPORT}/${folder}/NativeMessagingHosts/com.factwright.save.json`;

/** Alex's Windows computer. */
const LOCAL = 'C:\\Users\\Alex\\AppData\\Local';
const ROAMING = 'C:\\Users\\Alex\\AppData\\Roaming';
const WINDOWS_APP_HOME = `${ROAMING}\\Factwright`;
const WINDOWS_HELPER = `${LOCAL}\\Programs\\Factwright\\factwright-save.exe`;
const WINDOWS_RECORD = `${WINDOWS_APP_HOME}\\save-helper.json`;
const CHROME_JSON = `${WINDOWS_APP_HOME}\\save-helper\\chrome.json`;
const FIREFOX_JSON = `${WINDOWS_APP_HOME}\\save-helper\\firefox.json`;
const REG = 'C:\\Windows\\System32\\reg.exe';
/** reg.exe setting a key under HKCU\Software to a manifest's path, as registering runs it. */
const setKey = (under: string, manifest: string) => [
  REG,
  'add',
  `HKCU\\Software\\${under}\\com.factwright.save`,
  '/ve',
  '/t',
  'REG_SZ',
  '/d',
  manifest,
  '/f',
];

const DESCRIPTION =
  'Connects Factwright’s browser extension to the Factwright app on this computer.';
const chromeManifest = (path: string, ids = [STORE]) => ({
  name: 'com.factwright.save',
  description: DESCRIPTION,
  path,
  type: 'stdio',
  allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
});
const firefoxManifest = (path: string) => ({
  name: 'com.factwright.save',
  description: DESCRIPTION,
  path,
  type: 'stdio',
  allowed_extensions: ['save@factwright.com'],
});

let root: string;
/** Each file written, by its path on the computer stood in. */
let writes: string[];
/** Each program run, its command first. */
let runs: string[][];
/** Which runs of reg.exe fail. */
let refuse: (args: readonly string[]) => boolean;
/** Each path registering looked at or wrote, on the computer stood in. */
let touched: string[];
/** The paths macOS keeps from Factwright, as it does another app's data, until the user allows it. */
let guarded: (path: string) => boolean;
/** How a guarded path refuses: macOS's own "Operation not permitted", unless a test says otherwise. */
let refusal: 'EPERM' | 'EACCES';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-register-'));
  writes = [];
  runs = [];
  refuse = () => false;
  touched = [];
  guarded = () => false;
  refusal = 'EPERM';
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Where a path on the computer stood in is, in the temporary folder: /Users/alex is
 * <root>/Users/alex, and C:\Users\Alex is <root>/C/Users/Alex.
 */
const onDisk = (path: string) =>
  join(
    root,
    ...path
      .split(/[\\/]/)
      .filter(Boolean)
      .map((part) => part.replace(/:$/, '')),
  );

/** Notes a path registering reached, and refuses it as macOS does, if it's guarded. */
function reach(path: string): void {
  touched.push(path);
  if (guarded(path)) {
    throw Object.assign(new Error(`${refusal}: refused, open '${path}'`), { code: refusal });
  }
}

/**
 * The computer's files, stood in under the temporary folder, noting each path reached and each
 * write. Like this computer's own, looking at what can't be reached finds nothing.
 */
const disk: Disk = {
  list: (path) => {
    try {
      reach(path);
    } catch {
      return [];
    }
    return localDisk.list(onDisk(path));
  },
  isFile: (path) => {
    try {
      reach(path);
    } catch {
      return false;
    }
    return localDisk.isFile(onDisk(path));
  },
  isFolder: (path) => {
    try {
      reach(path);
    } catch {
      return false;
    }
    return localDisk.isFolder(onDisk(path));
  },
  read: (path) => {
    try {
      reach(path);
    } catch {
      return null;
    }
    return localDisk.read(onDisk(path));
  },
  write: async (path, text) => {
    writes.push(path);
    reach(path);
    await localDisk.write(onDisk(path), text);
  },
};

/** reg.exe, as the tests stand it in: it notes each run, and fails the ones refuse picks. */
const run = async (command: string, args: readonly string[]) => {
  runs.push([command, ...args]);
  if (refuse(args)) throw new Error('ERROR: Access is denied.');
};

const readJson = (path: string) => JSON.parse(readFileSync(onDisk(path), 'utf8'));

/** A browser's own folder, with something in it, as it is once the browser has run. */
function ran(folder: string): void {
  mkdirSync(onDisk(`${folder}/Default`), { recursive: true });
}

/** The helper, where the app expects it. */
function install(helper: string): void {
  mkdirSync(dirname(onDisk(helper)), { recursive: true });
  writeFileSync(onDisk(helper), 'helper');
}

/** A Mac app, installed in Applications, or another folder of apps. */
function installApp(name: string, folder = '/Applications'): void {
  mkdirSync(onDisk(`${folder}/${name}/Contents`), { recursive: true });
}

/** The paths reached in the browsers' own folders: anywhere in Application Support but Factwright's. */
const inBrowsers = () =>
  touched.filter((path) => path.startsWith(`${SUPPORT}/`) && !path.startsWith(`${MAC_APP_HOME}/`));

/** A record written as Factwright 0.9.0 wrote it, before there was a digest of the manifests. */
function oldRecord(browsers: string[], helper = MAC_HELPER): void {
  mkdirSync(dirname(onDisk(MAC_RECORD)), { recursive: true });
  writeFileSync(onDisk(MAC_RECORD), JSON.stringify({ version: '0.9.0', helper, browsers }));
}

const DIGEST = expect.stringMatching(/^[0-9a-f]{64}$/);

const onMac = (changes: Partial<SaveHelperDeps> = {}): SaveHelperDeps => ({
  platform: 'darwin',
  userHome: MAC_HOME,
  env: {},
  appHome: MAC_APP_HOME,
  helper: MAC_HELPER,
  version: '0.9.0',
  run,
  disk,
  ...changes,
});

const onWindows = (changes: Partial<SaveHelperDeps> = {}): SaveHelperDeps => ({
  platform: 'win32',
  userHome: 'C:\\Users\\Alex',
  env: { LOCALAPPDATA: LOCAL, APPDATA: ROAMING, SystemRoot: 'C:\\Windows' },
  appHome: WINDOWS_APP_HOME,
  helper: WINDOWS_HELPER,
  version: '0.9.0',
  run,
  disk,
  ...changes,
});

/** Registers, as the app starts, and says what was written and run for it. */
async function register(deps: SaveHelperDeps) {
  writes = [];
  runs = [];
  const result = await registerSaveHelper(deps);
  return { result, writes, runs };
}

/** Sets browsers up, as the Browser extension window asks, and says what was written and run. */
async function setUp(deps: SaveHelperDeps, only?: string[]) {
  writes = [];
  runs = [];
  const result = await setUpSaveHelper(deps, only);
  return { result, writes, runs };
}

describe('registering on a Mac', () => {
  beforeEach(() => install(MAC_HELPER));

  it('leaves every browser’s folders alone until one is set up, looking only for their apps', async () => {
    // Browsers that have run, whose folders macOS keeps from other apps, and says so when one tries.
    for (const folder of ['Google/Chrome', 'Firefox', 'Microsoft Edge'])
      ran(`${SUPPORT}/${folder}`);
    guarded = (path) => path.startsWith(`${SUPPORT}/`) && !path.startsWith(`${MAC_APP_HOME}/`);
    installApp('Google Chrome.app');
    installApp('Firefox.app');
    expect(await register(onMac())).toEqual({
      result: { skipped: 'not-set-up' },
      writes: [],
      runs: [],
    });
    expect(inBrowsers()).toEqual([]);
    // Nor does the window, looking.
    expect(saveHelperStatus(onMac())).toEqual({
      unavailable: null,
      onRequest: true,
      browsers: [
        { id: 'chrome', name: 'Google Chrome', state: 'not-set-up', allow: ['Google Chrome'] },
        { id: 'firefox', name: 'Firefox', state: 'not-set-up', allow: ['Firefox'] },
      ],
    });
    expect(inBrowsers()).toEqual([]);
  });

  it('sets up the browsers asked for, found by their apps, with a manifest naming the helper and the extension', async () => {
    installApp('Google Chrome.app');
    installApp('Microsoft Edge.app');
    installApp('Firefox Developer Edition.app', `${MAC_HOME}/Applications`);
    expect(await setUp(onMac(), ['chrome', 'firefox', 'vivaldi'])).toEqual({
      result: { registered: ['chrome', 'firefox'], failed: [] },
      writes: [manifestIn('Google/Chrome'), manifestIn('Mozilla'), MAC_RECORD],
      runs: [],
    });
    expect(readJson(manifestIn('Google/Chrome'))).toStrictEqual(chromeManifest(MAC_HELPER));
    expect(readJson(manifestIn('Mozilla'))).toStrictEqual(firefoxManifest(MAC_HELPER));
    expect(readJson(MAC_RECORD)).toStrictEqual({
      version: '0.9.0',
      helper: MAC_HELPER,
      browsers: ['chrome', 'firefox'],
      blocked: [],
      manifests: DIGEST,
    });
    // Written whole, with nothing left beside it.
    expect(readdirSync(onDisk(`${SUPPORT}/Google/Chrome/NativeMessagingHosts`))).toEqual([
      'com.factwright.save.json',
    ]);
    // Edge waits to be asked for, and Vivaldi isn't installed.
    expect(existsSync(onDisk(`${SUPPORT}/Microsoft Edge`))).toBe(false);
    expect(existsSync(onDisk(`${SUPPORT}/Vivaldi`))).toBe(false);
    expect(saveHelperStatus(onMac()).browsers).toEqual([
      { id: 'chrome', name: 'Google Chrome', state: 'ready', allow: ['Google Chrome'] },
      { id: 'edge', name: 'Microsoft Edge', state: 'not-set-up', allow: ['Microsoft Edge'] },
      { id: 'firefox', name: 'Firefox', state: 'ready', allow: ['Firefox'] },
    ]);
    // Asked for none in particular, every browser found.
    expect((await setUp(onMac())).result).toEqual({
      registered: ['chrome', 'edge', 'firefox'],
      failed: [],
    });
    expect(readJson(MAC_RECORD).browsers).toEqual(['chrome', 'edge', 'firefox']);
  });

  it('registers Brave in Chrome’s folder too, as it reads that one', async () => {
    installApp('Brave Browser.app');
    expect(await setUp(onMac(), ['brave'])).toEqual({
      result: { registered: ['brave'], failed: [] },
      writes: [manifestIn('Google/Chrome'), manifestIn('BraveSoftware/Brave-Browser'), MAC_RECORD],
      runs: [],
    });
    expect(readJson(manifestIn('BraveSoftware/Brave-Browser'))).toStrictEqual(
      chromeManifest(MAC_HELPER),
    );
    // Where macOS keeps Chrome's folder, Brave is blocked, and the steps name Chrome to allow too.
    rmSync(onDisk(MAC_RECORD));
    guarded = (path) => path.startsWith(`${SUPPORT}/Google/Chrome/`);
    expect((await setUp(onMac(), ['brave'])).result).toMatchObject({
      registered: [],
      failed: [{ browser: 'brave', blocked: true }],
    });
    expect(saveHelperStatus(onMac()).browsers).toEqual([
      { id: 'brave', name: 'Brave', state: 'blocked', allow: ['Google Chrome', 'Brave Browser'] },
    ]);
  });

  // Windows refuses to put a file where a folder is with EPERM, the error macOS refuses with, so
  // what's in the way below would read as macOS refusing.
  it.skipIf(process.platform === 'win32')(
    'notes a browser macOS refused, which the others don’t wait on, until the user allows it',
    async () => {
      installApp('Google Chrome.app');
      installApp('Firefox.app');
      guarded = (path) => path.startsWith(`${SUPPORT}/Google/Chrome/`);
      expect((await setUp(onMac())).result).toEqual({
        registered: ['firefox'],
        failed: [{ browser: 'chrome', message: expect.stringContaining('EPERM'), blocked: true }],
      });
      expect(readJson(MAC_RECORD)).toMatchObject({ browsers: ['firefox'], blocked: ['chrome'] });
      expect(saveHelperStatus(onMac()).browsers.map(({ id, state }) => [id, state])).toEqual([
        ['chrome', 'blocked'],
        ['firefox', 'ready'],
      ]);
      // A start keeps Firefox current, and leaves Chrome to the user, so macOS isn't asked again.
      touched = [];
      expect(await register(onMac())).toEqual({
        result: { skipped: 'unchanged' },
        writes: [],
        runs: [],
      });
      expect(inBrowsers()).toEqual([]);

      // A folder's own permissions are a failure, but not macOS refusing: Files & Folders can't help.
      refusal = 'EACCES';
      expect((await setUp(onMac(), ['chrome'])).result).toEqual({
        registered: [],
        failed: [{ browser: 'chrome', message: expect.stringContaining('EACCES'), blocked: false }],
      });
      expect(readJson(MAC_RECORD)).toMatchObject({ browsers: ['firefox'], blocked: [] });

      // Nor is something else in the way.
      guarded = () => false;
      mkdirSync(onDisk(manifestIn('Google/Chrome')), { recursive: true });
      expect((await setUp(onMac(), ['chrome'])).result).toEqual({
        registered: [],
        failed: [{ browser: 'chrome', message: expect.any(String), blocked: false }],
      });
      expect(readJson(MAC_RECORD)).toMatchObject({ browsers: ['firefox'], blocked: [] });

      // Once nothing's in the way and the user has allowed it, trying again works.
      rmSync(onDisk(manifestIn('Google/Chrome')), { recursive: true });
      expect((await setUp(onMac(), ['chrome'])).result).toEqual({
        registered: ['chrome'],
        failed: [],
      });
      expect(readJson(MAC_RECORD)).toMatchObject({ browsers: ['chrome', 'firefox'], blocked: [] });
    },
  );

  it('keeps the browsers set up current, reaching their folders only when a manifest would change', async () => {
    installApp('Google Chrome.app');
    installApp('Firefox.app');
    await setUp(onMac(), ['chrome']);
    const unchanged = { result: { skipped: 'unchanged' }, writes: [], runs: [] };
    touched = [];
    expect(await register(onMac())).toEqual(unchanged);
    expect(inBrowsers()).toEqual([]);

    // A new version: the manifests read the same, so only the record learns it.
    expect(await register(onMac({ version: '0.9.1' }))).toEqual({
      result: { skipped: 'unchanged' },
      writes: [MAC_RECORD],
      runs: [],
    });
    expect(readJson(MAC_RECORD).version).toBe('0.9.1');
    expect(inBrowsers()).toEqual([]);
    expect(await register(onMac({ version: '0.9.1' }))).toEqual(unchanged);

    // The app moved: the browsers set up get theirs again, and only those.
    const moved =
      '/Users/alex/Applications/Factwright.app/Contents/Resources/helper/factwright-save';
    install(moved);
    const now = onMac({ version: '0.9.1', helper: moved });
    expect(await register(now)).toEqual({
      result: { registered: ['chrome'], failed: [] },
      writes: [manifestIn('Google/Chrome'), MAC_RECORD],
      runs: [],
    });
    expect(readJson(manifestIn('Google/Chrome')).path).toBe(moved);
    expect(existsSync(onDisk(manifestIn('Mozilla')))).toBe(false);
    expect(await register(now)).toEqual(unchanged);

    // Setting up another browser brings any set up before up to date too.
    const back = onMac({ version: '0.9.1' });
    expect((await setUp(back, ['firefox'])).result).toEqual({
      registered: ['chrome', 'firefox'],
      failed: [],
    });
    expect(readJson(manifestIn('Google/Chrome')).path).toBe(MAC_HELPER);
  });

  it('takes over 0.9.0’s record without reaching the browsers, unless the app has moved since', async () => {
    // 0.9.0 registered Chrome as it started, where macOS let it, and noted no digest. Its
    // manifests read as 0.9.1's would for the same helper, so the record only gains the digest.
    oldRecord(['chrome']);
    expect(await register(onMac({ version: '0.9.1' }))).toEqual({
      result: { skipped: 'unchanged' },
      writes: [MAC_RECORD],
      runs: [],
    });
    expect(inBrowsers()).toEqual([]);
    expect(readJson(MAC_RECORD)).toStrictEqual({
      version: '0.9.1',
      helper: MAC_HELPER,
      browsers: ['chrome'],
      blocked: [],
      manifests: DIGEST,
    });
    // Registered for a helper somewhere else, Chrome's manifest is written again.
    oldRecord(['chrome'], '/Volumes/Old/Factwright.app/Contents/Resources/helper/factwright-save');
    expect(await register(onMac({ version: '0.9.1' }))).toEqual({
      result: { registered: ['chrome'], failed: [] },
      writes: [manifestIn('Google/Chrome'), MAC_RECORD],
      runs: [],
    });
    expect(readJson(manifestIn('Google/Chrome')).path).toBe(MAC_HELPER);
    // Where macOS kept it out of every browser, 0.9.0 noted none, and that's left as it is.
    oldRecord([]);
    touched = [];
    expect(await register(onMac({ version: '0.9.1' }))).toEqual({
      result: { skipped: 'not-set-up' },
      writes: [],
      runs: [],
    });
    expect(inBrowsers()).toEqual([]);
  });

  it('skips an app run from where it goes away, or without its helper', async () => {
    installApp('Google Chrome.app');
    const translocated =
      '/private/var/folders/xy/abc/T/AppTranslocation/6A1F0C2E/d/Factwright.app/Contents/Resources/helper/factwright-save';
    install(translocated);
    expect(await setUp(onMac({ helper: translocated }))).toEqual({
      result: { skipped: 'translocated' },
      writes: [],
      runs: [],
    });
    expect(saveHelperStatus(onMac({ helper: translocated }))).toEqual({
      unavailable: 'translocated',
      onRequest: true,
      browsers: [],
    });
    const diskImage =
      '/Volumes/Factwright 0.9.0/Factwright.app/Contents/Resources/helper/factwright-save';
    install(diskImage);
    expect(await setUp(onMac({ helper: diskImage }))).toEqual({
      result: { skipped: 'disk-image' },
      writes: [],
      runs: [],
    });
    expect(saveHelperStatus(onMac({ helper: diskImage })).unavailable).toBe('disk-image');
    rmSync(onDisk(MAC_HELPER));
    expect(await setUp(onMac())).toEqual({
      result: { skipped: 'no-helper' },
      writes: [],
      runs: [],
    });
    expect(await register(onMac())).toEqual({
      result: { skipped: 'no-helper' },
      writes: [],
      runs: [],
    });
    expect(saveHelperStatus(onMac()).unavailable).toBe('no-helper');
    expect(existsSync(onDisk(`${SUPPORT}/Google/Chrome/NativeMessagingHosts`))).toBe(false);
  });

  it('lets an unpacked extension being developed reach the helper too, and refuses an ID that isn’t one', async () => {
    installApp('Google Chrome.app');
    installApp('Firefox.app');
    await setUp(onMac());
    // A new ID changes the manifests, which a start writes again for the browsers set up.
    const developing = onMac({ extraChromeIds: [UNPACKED, STORE] });
    expect((await register(developing)).writes).toContain(manifestIn('Google/Chrome'));
    expect(readJson(manifestIn('Google/Chrome'))).toStrictEqual(
      chromeManifest(MAC_HELPER, [STORE, UNPACKED]),
    );
    expect(readJson(manifestIn('Mozilla'))).toStrictEqual(firefoxManifest(MAC_HELPER));

    for (const id of [
      'ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP',
      'abcdefghijklmnopabcdefghijklmnoq',
      'abcdefghijklmnop',
      '',
    ]) {
      writes = [];
      await expect(registerSaveHelper(onMac({ extraChromeIds: [id] }))).rejects.toThrow(
        'isn’t a Chrome extension’s ID',
      );
      await expect(setUpSaveHelper(onMac({ extraChromeIds: [id] }))).rejects.toThrow(
        'isn’t a Chrome extension’s ID',
      );
      expect(writes).toEqual([]);
    }
    await expect(registerSaveHelper(onMac({ helper: 'factwright-save' }))).rejects.toThrow(
      'must be whole',
    );
    expect(saveHelperStatus(onMac({ helper: 'factwright-save' })).unavailable).toBe('no-helper');
  });
});

describe('registering on Windows', () => {
  beforeEach(() => install(WINDOWS_HELPER));

  it('sets each key once, naming a manifest in the app’s data folder, for every browser found', async () => {
    ran(`${LOCAL}\\Google\\Chrome\\User Data`);
    ran(`${LOCAL}\\Chromium\\User Data`);
    ran(`${LOCAL}\\Microsoft\\Edge\\User Data`);
    ran(`${LOCAL}\\BraveSoftware\\Brave-Browser\\User Data`);
    ran(`${LOCAL}\\Vivaldi\\User Data`);
    ran(`${LOCAL}\\Packages\\TheBrowserCompany.Arc_ttt1ap7aakyb4`);
    ran(`${ROAMING}\\Mozilla\\Firefox`);
    expect(await register(onWindows())).toEqual({
      result: {
        registered: ['chrome', 'chromium', 'edge', 'brave', 'vivaldi', 'arc', 'firefox'],
        failed: [],
      },
      writes: [CHROME_JSON, FIREFOX_JSON, WINDOWS_RECORD],
      runs: [
        setKey('Google\\Chrome\\NativeMessagingHosts', CHROME_JSON),
        setKey('Chromium\\NativeMessagingHosts', CHROME_JSON),
        setKey('Microsoft\\Edge\\NativeMessagingHosts', CHROME_JSON),
        setKey('BraveSoftware\\Brave-Browser\\NativeMessagingHosts', CHROME_JSON),
        setKey('Vivaldi\\NativeMessagingHosts', CHROME_JSON),
        setKey('Mozilla\\NativeMessagingHosts', FIREFOX_JSON),
      ],
    });
    expect(readJson(CHROME_JSON)).toStrictEqual(chromeManifest(WINDOWS_HELPER));
    expect(readJson(FIREFOX_JSON)).toStrictEqual(firefoxManifest(WINDOWS_HELPER));
    expect(readJson(WINDOWS_RECORD)).toStrictEqual({
      version: '0.9.0',
      helper: WINDOWS_HELPER,
      browsers: ['chrome', 'chromium', 'edge', 'brave', 'vivaldi', 'arc', 'firefox'],
    });
  });

  it('registers only the browsers found, with Chrome’s key for Arc', async () => {
    ran(`${LOCAL}\\Packages\\Microsoft.WindowsCalculator_8wekyb3d8bbwe`);
    ran(`${LOCAL}\\Packages\\TheBrowserCompany.Arc_ttt1ap7aakyb4`);
    expect(await register(onWindows())).toEqual({
      result: { registered: ['arc'], failed: [] },
      writes: [CHROME_JSON, WINDOWS_RECORD],
      runs: [setKey('Google\\Chrome\\NativeMessagingHosts', CHROME_JSON)],
    });

    rmSync(onDisk(`${LOCAL}\\Packages`), { recursive: true });
    rmSync(onDisk(WINDOWS_APP_HOME), { recursive: true });
    ran(`${ROAMING}\\Mozilla\\Firefox`);
    expect(await register(onWindows())).toEqual({
      result: { registered: ['firefox'], failed: [] },
      writes: [FIREFOX_JSON, WINDOWS_RECORD],
      runs: [setKey('Mozilla\\NativeMessagingHosts', FIREFOX_JSON)],
    });
    expect(existsSync(onDisk(CHROME_JSON))).toBe(false);
  });

  it('runs no reg.exe on an ordinary start, and registers again when something changed', async () => {
    ran(`${LOCAL}\\Google\\Chrome\\User Data`);
    ran(`${ROAMING}\\Mozilla\\Firefox`);
    await register(onWindows());
    const unchanged = { result: { skipped: 'unchanged' }, writes: [], runs: [] };
    expect(await register(onWindows())).toEqual(unchanged);

    // A manifest went.
    rmSync(onDisk(CHROME_JSON));
    expect((await register(onWindows())).runs).toHaveLength(2);
    expect(readJson(CHROME_JSON)).toStrictEqual(chromeManifest(WINDOWS_HELPER));
    expect(await register(onWindows())).toEqual(unchanged);

    // A new version.
    expect((await register(onWindows({ version: '0.9.1' }))).runs).toHaveLength(2);
    expect(await register(onWindows({ version: '0.9.1' }))).toEqual(unchanged);

    // The app moved.
    const moved = 'D:\\Apps\\Factwright\\factwright-save.exe';
    install(moved);
    const now = onWindows({ version: '0.9.1', helper: moved });
    expect((await register(now)).runs).toHaveLength(2);
    expect(readJson(CHROME_JSON).path).toBe(moved);
    expect(readJson(FIREFOX_JSON).path).toBe(moved);
    expect(await register(now)).toEqual(unchanged);

    // A browser turned up.
    ran(`${LOCAL}\\Microsoft\\Edge\\User Data`);
    expect((await register(now)).runs).toEqual([
      setKey('Google\\Chrome\\NativeMessagingHosts', CHROME_JSON),
      setKey('Microsoft\\Edge\\NativeMessagingHosts', CHROME_JSON),
      setKey('Mozilla\\NativeMessagingHosts', FIREFOX_JSON),
    ]);
    expect(await register(now)).toEqual(unchanged);
  });

  it('leaves a browser whose key couldn’t be set out of the record, and tries it again next time', async () => {
    ran(`${LOCAL}\\Google\\Chrome\\User Data`);
    ran(`${ROAMING}\\Mozilla\\Firefox`);
    refuse = (args) => String(args[1]).includes('Mozilla');
    expect((await register(onWindows())).result).toEqual({
      registered: ['chrome'],
      failed: [{ browser: 'firefox', message: 'ERROR: Access is denied.', blocked: false }],
    });
    expect(readJson(WINDOWS_RECORD).browsers).toEqual(['chrome']);

    refuse = () => false;
    expect((await register(onWindows())).result).toEqual({
      registered: ['chrome', 'firefox'],
      failed: [],
    });
    expect(readJson(WINDOWS_RECORD).browsers).toEqual(['chrome', 'firefox']);
  });

  it('counts a browser only once every key it reads is set', async () => {
    ran(`${LOCAL}\\Google\\Chrome\\User Data`);
    ran(`${LOCAL}\\Microsoft\\Edge\\User Data`);
    ran(`${LOCAL}\\BraveSoftware\\Brave-Browser\\User Data`);
    refuse = (args) => String(args[1]).includes('Google\\Chrome');
    const { result, runs } = await register(onWindows());
    expect(result).toMatchObject({
      registered: ['edge'],
      failed: [{ browser: 'chrome' }, { browser: 'brave' }],
    });
    // Brave's own key was still set.
    expect(runs).toContainEqual(
      setKey('BraveSoftware\\Brave-Browser\\NativeMessagingHosts', CHROME_JSON),
    );
    expect(readJson(WINDOWS_RECORD).browsers).toEqual(['edge']);
  });

  it('writes no record when nothing worked, so it all goes again next time', async () => {
    ran(`${LOCAL}\\Google\\Chrome\\User Data`);
    refuse = () => true;
    expect((await register(onWindows())).result).toMatchObject({
      registered: [],
      failed: [{ browser: 'chrome' }],
    });
    expect(existsSync(onDisk(WINDOWS_RECORD))).toBe(false);
    refuse = () => false;
    expect((await register(onWindows())).runs).toHaveLength(1);
    expect(readJson(WINDOWS_RECORD).browsers).toEqual(['chrome']);
  });

  it('skips without its helper', async () => {
    ran(`${LOCAL}\\Google\\Chrome\\User Data`);
    rmSync(onDisk(WINDOWS_HELPER));
    expect(await register(onWindows())).toEqual({
      result: { skipped: 'no-helper' },
      writes: [],
      runs: [],
    });
  });
  it('never counts a refusal on Windows as macOS’s, which only a Mac has', async () => {
    ran(`${LOCAL}\\Google\\Chrome\\User Data`);
    guarded = (path) => path === CHROME_JSON;
    expect((await register(onWindows())).result).toEqual({
      registered: [],
      failed: [{ browser: 'chrome', message: expect.stringContaining('EPERM'), blocked: false }],
    });
  });

  it('says each browser found is ready, and registers again when the window asks, even unchanged', async () => {
    ran(`${LOCAL}\\Google\\Chrome\\User Data`);
    await register(onWindows());
    expect(saveHelperStatus(onWindows())).toEqual({
      unavailable: null,
      onRequest: false,
      browsers: [{ id: 'chrome', name: 'Google Chrome', state: 'ready', allow: [] }],
    });
    expect((await register(onWindows())).result).toEqual({ skipped: 'unchanged' });
    expect((await setUp(onWindows())).runs).toEqual([
      setKey('Google\\Chrome\\NativeMessagingHosts', CHROME_JSON),
    ]);
  });
});

describe('registering anywhere else', () => {
  it('does nothing', async () => {
    install(MAC_HELPER);
    ran(`${SUPPORT}/Google/Chrome`);
    expect(await register(onMac({ platform: 'linux' }))).toEqual({
      result: { skipped: 'other-system' },
      writes: [],
      runs: [],
    });
    expect(await setUp(onMac({ platform: 'linux' }))).toEqual({
      result: { skipped: 'other-system' },
      writes: [],
      runs: [],
    });
    expect(saveHelperStatus(onMac({ platform: 'linux' }))).toEqual({
      unavailable: 'other-system',
      onRequest: false,
      browsers: [],
    });
  });
});

describe('the Windows uninstaller', () => {
  const script = readFileSync(new URL('../../../build/installer.nsh', import.meta.url), 'utf8');

  it('takes away every key registering sets, and the manifests and the record', () => {
    const deleted = [
      ...script.matchAll(/DeleteRegKey HKCU "Software\\(.+)\\com\.factwright\.save"/g),
    ]
      .map((match) => match[1])
      .sort();
    const keys = [...new Set(BROWSERS.flatMap((browser) => browser.windows.keys))].sort();
    expect(deleted).toEqual(keys);
    expect(keys).toHaveLength(6);
    for (const line of [
      'Delete "$APPDATA\\Factwright\\save-helper\\chrome.json"',
      'Delete "$APPDATA\\Factwright\\save-helper\\firefox.json"',
      'RMDir "$APPDATA\\Factwright\\save-helper"',
      'Delete "$APPDATA\\Factwright\\save-helper.json"',
    ]) {
      expect(script).toContain(line);
    }
  });
});

describe('running a program', () => {
  it('runs it without a shell, and fails when it does', async () => {
    const literal = '$HOME; echo';
    await expect(
      runProgram(process.execPath, [
        '-e',
        `process.exit(process.argv[1] === '${literal}' ? 0 : 1)`,
        literal,
      ]),
    ).resolves.toBeUndefined();
    await expect(runProgram(process.execPath, ['-e', 'process.exit(3)'])).rejects.toThrow();
  });

  it('names the helper as the installers do', () => {
    expect(helperName('darwin')).toBe('factwright-save');
    expect(helperName('win32')).toBe('factwright-save.exe');
  });
});
