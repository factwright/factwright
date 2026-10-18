/**
 * The browsers Save to Factwright runs in, and where each looks for the helper the app registers
 * with it. Chrome, Chromium, Edge, Brave, Vivaldi and Arc read a Chrome manifest, which names the
 * extension by its Chrome Web Store ID, and Firefox reads one of its own, which names it by its
 * Firefox ID.
 *
 * On a Mac, each reads manifest files from folders in ~/Library/Application Support. On Windows,
 * each reads keys in the registry, under HKEY_CURRENT_USER\Software, whose value is the path of a
 * manifest file, which can be anywhere.
 */

/** A browser, by the name the app knows it by. */
export type BrowserId = 'chrome' | 'chromium' | 'edge' | 'brave' | 'vivaldi' | 'arc' | 'firefox';

/** A browser, where it's found, and where it looks for the helper, on a Mac and on Windows. */
export interface Browser {
  id: BrowserId;
  /** The manifest it reads: the Chrome family's, or Firefox's. */
  manifest: 'chrome' | 'firefox';
  mac: {
    /** Its own folder, in ~/Library/Application Support, there once it has run. */
    folder: string;
    /** The folders it reads manifests from, in ~/Library/Application Support. */
    manifestFolders: readonly string[];
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
    manifest: 'chrome',
    mac: { folder: 'Google/Chrome', manifestFolders: ['Google/Chrome/NativeMessagingHosts'] },
    windows: {
      folder: '%LOCALAPPDATA%\\Google\\Chrome\\User Data',
      keys: ['Google\\Chrome\\NativeMessagingHosts'],
    },
  },
  {
    id: 'chromium',
    manifest: 'chrome',
    mac: { folder: 'Chromium', manifestFolders: ['Chromium/NativeMessagingHosts'] },
    windows: {
      folder: '%LOCALAPPDATA%\\Chromium\\User Data',
      keys: ['Chromium\\NativeMessagingHosts'],
    },
  },
  {
    id: 'edge',
    manifest: 'chrome',
    mac: { folder: 'Microsoft Edge', manifestFolders: ['Microsoft Edge/NativeMessagingHosts'] },
    windows: {
      folder: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data',
      keys: ['Microsoft\\Edge\\NativeMessagingHosts'],
    },
  },
  {
    id: 'brave',
    manifest: 'chrome',
    mac: {
      folder: 'BraveSoftware/Brave-Browser',
      manifestFolders: [
        'Google/Chrome/NativeMessagingHosts',
        'BraveSoftware/Brave-Browser/NativeMessagingHosts',
      ],
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
    manifest: 'chrome',
    mac: { folder: 'Vivaldi', manifestFolders: ['Vivaldi/NativeMessagingHosts'] },
    windows: {
      folder: '%LOCALAPPDATA%\\Vivaldi\\User Data',
      keys: ['Google\\Chrome\\NativeMessagingHosts', 'Vivaldi\\NativeMessagingHosts'],
    },
  },
  {
    id: 'arc',
    manifest: 'chrome',
    mac: { folder: 'Arc/User Data', manifestFolders: ['Arc/User Data/NativeMessagingHosts'] },
    windows: {
      folder: '%LOCALAPPDATA%\\Packages\\TheBrowserCompany.Arc_*',
      keys: ['Google\\Chrome\\NativeMessagingHosts'],
    },
  },
  {
    id: 'firefox',
    manifest: 'firefox',
    mac: { folder: 'Firefox', manifestFolders: ['Mozilla/NativeMessagingHosts'] },
    windows: {
      folder: '%APPDATA%\\Mozilla\\Firefox',
      keys: ['Mozilla\\NativeMessagingHosts'],
    },
  },
];
