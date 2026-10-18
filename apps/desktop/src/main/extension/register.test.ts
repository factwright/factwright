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
} from './register.ts';

/** Save to Factwright's Chrome Web Store item. */
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

const DESCRIPTION = 'Saves jobs from Save to Factwright to the Factwright app on this computer.';
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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-register-'));
  writes = [];
  runs = [];
  refuse = () => false;
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

/** The computer's files, stood in under the temporary folder, noting each write. */
const disk: Disk = {
  list: (path) => localDisk.list(onDisk(path)),
  isFile: (path) => localDisk.isFile(onDisk(path)),
  read: (path) => localDisk.read(onDisk(path)),
  write: (path, text) => {
    writes.push(path);
    localDisk.write(onDisk(path), text);
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

/** Registers, and says what was written and run for it. */
async function register(deps: SaveHelperDeps) {
  writes = [];
  runs = [];
  const result = await registerSaveHelper(deps);
  return { result, writes, runs };
}

describe('registering on a Mac', () => {
  beforeEach(() => install(MAC_HELPER));

  it('gives each browser found a manifest naming the helper and the extension, and no other', async () => {
    ran(`${SUPPORT}/Google/Chrome`);
    ran(`${SUPPORT}/Microsoft Edge`);
    ran(`${SUPPORT}/Firefox`);
    expect(await register(onMac())).toEqual({
      result: { registered: ['chrome', 'edge', 'firefox'], failed: [] },
      writes: [
        manifestIn('Google/Chrome'),
        manifestIn('Microsoft Edge'),
        manifestIn('Mozilla'),
        MAC_RECORD,
      ],
      runs: [],
    });
    expect(readJson(manifestIn('Google/Chrome'))).toStrictEqual(chromeManifest(MAC_HELPER));
    expect(readJson(manifestIn('Microsoft Edge'))).toStrictEqual(chromeManifest(MAC_HELPER));
    expect(readJson(manifestIn('Mozilla'))).toStrictEqual(firefoxManifest(MAC_HELPER));
    expect(readJson(MAC_RECORD)).toStrictEqual({
      version: '0.9.0',
      helper: MAC_HELPER,
      browsers: ['chrome', 'edge', 'firefox'],
    });
    // Written whole, with nothing left beside it.
    expect(readdirSync(onDisk(`${SUPPORT}/Google/Chrome/NativeMessagingHosts`))).toEqual([
      'com.factwright.save.json',
    ]);
    // The browsers that aren't here get nothing.
    for (const folder of ['Chromium', 'BraveSoftware', 'Vivaldi', 'Arc']) {
      expect(existsSync(onDisk(`${SUPPORT}/${folder}`))).toBe(false);
    }
  });

  it('registers Brave in Chrome’s folder too, even before Chrome has one', async () => {
    ran(`${SUPPORT}/BraveSoftware/Brave-Browser`);
    expect(await register(onMac())).toEqual({
      result: { registered: ['brave'], failed: [] },
      writes: [manifestIn('Google/Chrome'), manifestIn('BraveSoftware/Brave-Browser'), MAC_RECORD],
      runs: [],
    });
    expect(readJson(manifestIn('Google/Chrome'))).toStrictEqual(chromeManifest(MAC_HELPER));
    expect(readJson(manifestIn('BraveSoftware/Brave-Browser'))).toStrictEqual(
      chromeManifest(MAC_HELPER),
    );
    // Chrome's folder, with only the manifest made for Brave in it, and the Finder's file once
    // it's been looked at, isn't Chrome.
    writeFileSync(onDisk(`${SUPPORT}/Google/Chrome/.DS_Store`), '');
    expect(await register(onMac())).toEqual({
      result: { skipped: 'unchanged' },
      writes: [],
      runs: [],
    });
  });

  it('writes each manifest once, however many browsers read it', async () => {
    for (const browser of BROWSERS) ran(`${SUPPORT}/${browser.mac.folder}`);
    const { result, writes } = await register(onMac());
    expect(result).toEqual({
      registered: ['chrome', 'chromium', 'edge', 'brave', 'vivaldi', 'arc', 'firefox'],
      failed: [],
    });
    expect(writes).toEqual([
      manifestIn('Google/Chrome'),
      manifestIn('Chromium'),
      manifestIn('Microsoft Edge'),
      manifestIn('BraveSoftware/Brave-Browser'),
      manifestIn('Vivaldi'),
      manifestIn('Arc/User Data'),
      manifestIn('Mozilla'),
      MAC_RECORD,
    ]);
    expect(readJson(manifestIn('Arc/User Data'))).toStrictEqual(chromeManifest(MAC_HELPER));
  });

  it('registers again only for a new version, a moved app, a new browser or a manifest gone or changed', async () => {
    ran(`${SUPPORT}/Google/Chrome`);
    ran(`${SUPPORT}/Firefox`);
    await register(onMac());
    const unchanged = { result: { skipped: 'unchanged' }, writes: [], runs: [] };
    expect(await register(onMac())).toEqual(unchanged);

    // A new version.
    expect((await register(onMac({ version: '0.9.1' }))).writes).toHaveLength(3);
    expect(readJson(MAC_RECORD).version).toBe('0.9.1');
    expect(await register(onMac({ version: '0.9.1' }))).toEqual(unchanged);

    // The app moved.
    const moved =
      '/Users/alex/Applications/Factwright.app/Contents/Resources/helper/factwright-save';
    install(moved);
    expect((await register(onMac({ version: '0.9.1', helper: moved }))).writes).toHaveLength(3);
    expect(readJson(manifestIn('Mozilla')).path).toBe(moved);
    expect(readJson(MAC_RECORD).helper).toBe(moved);
    const now = onMac({ version: '0.9.1', helper: moved });
    expect(await register(now)).toEqual(unchanged);

    // A browser turned up.
    ran(`${SUPPORT}/Vivaldi`);
    expect((await register(now)).result).toEqual({
      registered: ['chrome', 'vivaldi', 'firefox'],
      failed: [],
    });
    expect(await register(now)).toEqual(unchanged);

    // A manifest went, or changed.
    rmSync(onDisk(manifestIn('Vivaldi')));
    expect((await register(now)).writes).toContain(manifestIn('Vivaldi'));
    writeFileSync(onDisk(manifestIn('Mozilla')), '{"name":"com.factwright.save"}');
    expect((await register(now)).writes).toContain(manifestIn('Mozilla'));
    expect(readJson(manifestIn('Mozilla'))).toStrictEqual(firefoxManifest(moved));
    expect(await register(now)).toEqual(unchanged);

    // A browser that's gone doesn't count.
    rmSync(onDisk(`${SUPPORT}/Vivaldi`), { recursive: true });
    expect(await register(now)).toEqual(unchanged);
  });

  it('leaves a browser that fails out of the record, and tries it again next time', async () => {
    ran(`${SUPPORT}/Google/Chrome`);
    ran(`${SUPPORT}/Microsoft Edge`);
    ran(`${SUPPORT}/Firefox`);
    // Something in the way of Edge's manifest.
    mkdirSync(onDisk(manifestIn('Microsoft Edge')), { recursive: true });
    const { result } = await register(onMac());
    expect(result).toMatchObject({
      registered: ['chrome', 'firefox'],
      failed: [{ browser: 'edge', message: expect.any(String) }],
    });
    expect(readJson(manifestIn('Google/Chrome'))).toStrictEqual(chromeManifest(MAC_HELPER));
    expect(readJson(MAC_RECORD).browsers).toEqual(['chrome', 'firefox']);

    rmSync(onDisk(manifestIn('Microsoft Edge')), { recursive: true });
    expect((await register(onMac())).result).toEqual({
      registered: ['chrome', 'edge', 'firefox'],
      failed: [],
    });
    expect(readJson(manifestIn('Microsoft Edge'))).toStrictEqual(chromeManifest(MAC_HELPER));
    expect(readJson(MAC_RECORD).browsers).toEqual(['chrome', 'edge', 'firefox']);
  });

  it('skips an app run from where it goes away, or without its helper', async () => {
    ran(`${SUPPORT}/Google/Chrome`);
    const translocated =
      '/private/var/folders/xy/abc/T/AppTranslocation/6A1F0C2E/d/Factwright.app/Contents/Resources/helper/factwright-save';
    install(translocated);
    expect(await register(onMac({ helper: translocated }))).toEqual({
      result: { skipped: 'translocated' },
      writes: [],
      runs: [],
    });
    const diskImage =
      '/Volumes/Factwright 0.9.0/Factwright.app/Contents/Resources/helper/factwright-save';
    install(diskImage);
    expect(await register(onMac({ helper: diskImage }))).toEqual({
      result: { skipped: 'disk-image' },
      writes: [],
      runs: [],
    });
    rmSync(onDisk(MAC_HELPER));
    expect(await register(onMac())).toEqual({
      result: { skipped: 'no-helper' },
      writes: [],
      runs: [],
    });
    expect(existsSync(onDisk(`${SUPPORT}/Google/Chrome/NativeMessagingHosts`))).toBe(false);
  });

  it('lets an unpacked extension being developed reach the helper too, and refuses an ID that isn’t one', async () => {
    ran(`${SUPPORT}/Google/Chrome`);
    ran(`${SUPPORT}/Firefox`);
    await register(onMac());
    // A new ID changes the manifest, which registers again.
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
      expect(writes).toEqual([]);
    }
    await expect(registerSaveHelper(onMac({ helper: 'factwright-save' }))).rejects.toThrow(
      'must be whole',
    );
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
      failed: [{ browser: 'firefox', message: 'ERROR: Access is denied.' }],
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
