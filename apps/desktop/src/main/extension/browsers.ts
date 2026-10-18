/**
 * The browsers Save to Factwright runs in, and where each looks for the helper the app registers
 * with it. Chrome, Chromium, Edge, Brave, Vivaldi and Arc read a Chrome manifest, which names the
 * extension by its Chrome Web Store ID, and Firefox reads one of its own, which names it by its
 * Firefox ID.
 *
 * On a Mac, the app finds each by its app in Applications, and each reads manifest files from
 * folders in ~/Library/Application Support. On Windows, each reads keys in the registry, under
 * HKEY_CURRENT_USER\Software, whose value is the path of a manifest file, which can be anywhere.
 */

/** A browser, by the name the app knows it by. */
export type BrowserId = 'chrome' | 'chromium' | 'edge' | 'brave' | 'vivaldi' | 'arc' | 'firefox';

/** A browser, where it's found, and where it looks for the helper, on a Mac and on Windows. */
export interface Browser {
  id: BrowserId;
  /** Its name, as the app shows it. */
  name: string;
  /** The manifest it reads: the Chrome family's, or Firefox's. */
  manifest: 'chrome' | 'firefox';
  mac: {
    /**
     * Its app, by the names it's installed under in Applications. The app looks for these, never in
     * the browser's own folder, which macOS keeps from other apps without the user's OK.
     */
    apps: readonly string[];
    /** The folders it reads manifests from, in ~/Library/Application Support. */
    manifestFolders: readonly string[];
    /**
     * The apps whose folders those are, as macOS names them in Files & Folders, where the user lets
     * Factwright reach them: Brave's include Chrome's, as Brave reads Chrome's folder too.
     */
    allow: readonly string[];
  };
  windows: {
    /**
     * Its own folder, in LOCALAPPDATA or APPDATA, there once it has run. A name ending in *
     * stands for any folder whose name starts with the rest.
     */
    folder: string;
    /** The keys it reads a manifest's path from, under HKEY_CURRENT_USER\Software. */
    keys: readonly string[];
  };
}

/**
 * Every browser the helper is registered with. Brave reads Chrome's folder on a Mac (brave-core's
 * app/brave_main_delegate.cc), and older versions its own, so it gets both. On Windows, Brave and
 * Vivaldi read Chrome's key as well as their own, and Arc is taken to read Chrome's, as it says
 * nothing of its own.
 */
export const BROWSERS: readonly Browser[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    manifest: 'chrome',
    mac: {
      apps: ['Google Chrome.app'],
      manifestFolders: ['Google/Chrome/NativeMessagingHosts'],
      allow: ['Google Chrome'],
    },
    windows: {
      folder: '%LOCALAPPDATA%\\Google\\Chrome\\User Data',
      keys: ['Google\\Chrome\\NativeMessagingHosts'],
    },
  },
  {
    id: 'chromium',
    name: 'Chromium',
    manifest: 'chrome',
    mac: {
      apps: ['Chromium.app'],
      manifestFolders: ['Chromium/NativeMessagingHosts'],
      allow: ['Chromium'],
    },
    windows: {
      folder: '%LOCALAPPDATA%\\Chromium\\User Data',
      keys: ['Chromium\\NativeMessagingHosts'],
    },
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    manifest: 'chrome',
    mac: {
      apps: ['Microsoft Edge.app'],
      manifestFolders: ['Microsoft Edge/NativeMessagingHosts'],
      allow: ['Microsoft Edge'],
    },
    windows: {
      folder: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data',
      keys: ['Microsoft\\Edge\\NativeMessagingHosts'],
    },
  },
  {
    id: 'brave',
    name: 'Brave',
    manifest: 'chrome',
    mac: {
      apps: ['Brave Browser.app'],
      manifestFolders: [
        'Google/Chrome/NativeMessagingHosts',
        'BraveSoftware/Brave-Browser/NativeMessagingHosts',
      ],
      allow: ['Google Chrome', 'Brave Browser'],
    },
    windows: {
      folder: '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data',
      keys: [
        'Google\\Chrome\\NativeMessagingHosts',
        'BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
      ],
    },
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    manifest: 'chrome',
    mac: {
      apps: ['Vivaldi.app'],
      manifestFolders: ['Vivaldi/NativeMessagingHosts'],
      allow: ['Vivaldi'],
    },
    windows: {
      folder: '%LOCALAPPDATA%\\Vivaldi\\User Data',
      keys: ['Google\\Chrome\\NativeMessagingHosts', 'Vivaldi\\NativeMessagingHosts'],
    },
  },
  {
    id: 'arc',
    name: 'Arc',
    manifest: 'chrome',
    mac: {
      apps: ['Arc.app'],
      manifestFolders: ['Arc/User Data/NativeMessagingHosts'],
      allow: ['Arc'],
    },
    windows: {
      folder: '%LOCALAPPDATA%\\Packages\\TheBrowserCompany.Arc_*',
      keys: ['Google\\Chrome\\NativeMessagingHosts'],
    },
  },
  {
    id: 'firefox',
    name: 'Firefox',
    manifest: 'firefox',
    mac: {
      apps: ['Firefox.app', 'Firefox Developer Edition.app', 'Firefox Nightly.app'],
      manifestFolders: ['Mozilla/NativeMessagingHosts'],
      allow: ['Firefox'],
    },
    windows: {
      folder: '%APPDATA%\\Mozilla\\Firefox',
      keys: ['Mozilla\\NativeMessagingHosts'],
    },
  },
];
