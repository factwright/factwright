import { EXTENSION_IDS } from '@factwright/sync';

/** The browsers the extension is built for, each with a manifest of its own. */
export type Target = 'chrome' | 'firefox';

/**
 * Factwright's sync server: the one the stores' builds sync through, unless you choose a server of
 * your own in setup. A build can name another with VITE_FACTWRIGHT_SYNC_SERVER (src/server.ts).
 */
export const FACTWRIGHT_SYNC = 'https://app.factwright.com';

/**
 * A sync server's site, as a browser's permission names it: the server's, on any port, since match
 * patterns leave ports out.
 */
export const hostPattern = (server: string) => {
  const { protocol, hostname } = new URL(server);
  return `${protocol}//${hostname}/*`;
};

/**
 * Where a sync server of your own may be, which the extension may ask the browser to let it reach:
 * any https address, and in a build for testing, this computer's over http too. Setup asks for the
 * one address you type, only when you choose a server of your own.
 */
export const ownServers = (forStores: boolean): string[] =>
  forStores ? ['https://*/*'] : ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'];

/**
 * The extension's ID on Firefox, which Firefox needs to sign it and to keep its data, and which
 * its sign-in window's return address comes from, as sync servers know it (@factwright/sync),
 * and which Factwright's helper lets reach it on this computer.
 */
export const FIREFOX_ID = EXTENSION_IDS.firefox;

/** The icon sizes each browser shows, from the toolbar up to the store. */
export const ICON_SIZES = [16, 32, 48, 128] as const;

const icons = Object.fromEntries(ICON_SIZES.map((size) => [size, `icons/${size}.png`]));

/** What a build asks for beyond what the stores' build does. */
export interface Asks {
  /**
   * Native messaging at install, for the end-to-end run, whose browser can't answer the prompt
   * that asks for it when setup does. Never in the stores' build.
   */
  nativeAtInstall?: boolean;
}

/**
 * The extension's manifest for a browser. It asks for as little as it can:
 * - the page you're on, only when you click to save it (activeTab), to read the job there
 * - running that one reading function in it (scripting)
 * - its own storage, for its sign-in and settings (storage)
 * - its item in the page's right-click menu (contextMenus)
 * - the browser's own window to sign in to sync through (identity), which shows no warning in
 *   either browser, at install or on an update
 * - reaching the sync server it's built for, Factwright's, and no other site (host permissions)
 * - reaching a sync server of your own instead, asked for only when you choose one in setup, and
 *   then only for its address (optional host permissions)
 * - talking to Factwright on this computer, through the helper Factwright installs, asked for only
 *   when you choose to save there in setup, or fill a form (optional native messaging)
 * - in Chrome, its side panel, where filling a form is checked (sidePanel), and the browser's own
 *   rules for lighting its button up on pages that look like an application form, which Chrome
 *   checks itself (declarativeContent). Firefox has a sidebar instead, and no such rules. Neither
 *   shows a warning, at install or on an update.
 * It has no content scripts and nothing pages can load, so sites can't tell it's installed.
 */
export function manifest(
  target: Target,
  version: string,
  server: string = FACTWRIGHT_SYNC,
  asks: Asks = {},
): Record<string, unknown> {
  const common = {
    manifest_version: 3,
    name: 'Factwright',
    description:
      'Save the job you’re looking at to your Factwright job hunt, and fill in its application for you to check.',
    version,
    homepage_url: 'https://factwright.com',
    icons,
    action: {
      default_title: 'Factwright',
      default_popup: 'popup.html',
      default_icon: icons,
    },
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'contextMenus',
      'identity',
      ...(asks.nativeAtInstall ? ['nativeMessaging'] : []),
    ],
    // Asked for when you choose to save to Factwright on this computer, so an update that brings
    // it asks nothing of anyone: a new permission the extension needs from install would turn it
    // off in Chrome until accepted.
    ...(asks.nativeAtInstall ? {} : { optional_permissions: ['nativeMessaging'] }),
    host_permissions: [hostPattern(server)],
    // The server it's built for is asked for at install, so it's never asked for again.
    optional_host_permissions: ownServers(server === FACTWRIGHT_SYNC).filter(
      (pattern) => pattern !== hostPattern(server),
    ),
    commands: {
      'save-job': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Save the job on this page, without opening the extension',
      },
      'fill-form': {
        suggested_key: { default: 'Alt+Shift+F' },
        description: 'Fill the application form on this page',
      },
    },
  };
  if (target === 'chrome') {
    return {
      ...common,
      permissions: [...common.permissions, 'sidePanel', 'declarativeContent'],
      side_panel: { default_path: 'sidepanel.html' },
      background: { service_worker: 'background.js', type: 'module' },
      // Chrome 127 is the first to let an extension open its popup, as a save that needs checking does.
      minimum_chrome_version: '127',
    };
  }
  return {
    ...common,
    // Firefox's sidebar, as Chrome's side panel, which opens only when you click Fill.
    sidebar_action: {
      default_panel: 'sidepanel.html',
      default_title: 'Factwright',
      default_icon: icons,
      open_at_install: false,
    },
    background: { scripts: ['background.js'], type: 'module' },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ID,
        // Firefox 140 is the first to show what an extension sends, in its own words, at install.
        strict_min_version: '140.0',
        data_collection_permissions: {
          // Sent only when you save a job: through sync, end-to-end encrypted, to your own sync
          // account, the job's address, the posting's text, and the sign-in that saves it there.
          // Saved to Factwright on this computer instead, the extension sends it to the app there.
          required: ['browsingActivity', 'websiteContent', 'authenticationInfo'],
        },
      },
    },
  };
}
