/** The browsers the extension is built for, each with a manifest of its own. */
export type Target = 'chrome' | 'firefox';

/** Factwright's sync server, the only site the extension may reach, unless a build names another. */
export const DEFAULT_SERVER = 'https://app.factwright.com';

/**
 * The site the extension may reach, as a browser's permission names it: the sync server's, on any
 * port, since match patterns leave ports out.
 */
export const hostPattern = (server: string) => {
  const { protocol, hostname } = new URL(server);
  return `${protocol}//${hostname}/*`;
};

/** The extension's ID on Firefox, which Firefox needs to sign it and to keep its data. */
export const FIREFOX_ID = 'save@factwright.com';

/** The icon sizes each browser shows, from the toolbar up to the store. */
export const ICON_SIZES = [16, 32, 48, 128] as const;

const icons = Object.fromEntries(ICON_SIZES.map((size) => [size, `icons/${size}.png`]));

/**
 * The extension's manifest for a browser. It asks for as little as it can:
 * - the page you're on, only when you click to save it (activeTab), to read the job there
 * - running that one reading function in it (scripting)
 * - its own storage, for its sign-in and settings (storage)
 * - its item in the page's right-click menu (contextMenus)
 * - reaching Factwright's sync server, and no other site (host permissions)
 * It has no content scripts and nothing pages can load, so sites can't tell it's installed.
 */
export function manifest(
  target: Target,
  version: string,
  server: string = DEFAULT_SERVER,
): Record<string, unknown> {
  const common = {
    manifest_version: 3,
    name: 'Save to Factwright',
    short_name: 'Factwright',
    description:
      'Save the job you’re looking at, with its posting, to your Factwright job hunt. End-to-end encrypted.',
    version,
    homepage_url: 'https://factwright.com',
    icons,
    action: {
      default_title: 'Save this job to Factwright',
      default_popup: 'popup.html',
      default_icon: icons,
    },
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus'],
    host_permissions: [hostPattern(server)],
    commands: {
      'save-job': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Save the job on this page, without opening the extension',
      },
    },
  };
  if (target === 'chrome') {
    return {
      ...common,
      background: { service_worker: 'background.js', type: 'module' },
      // Chrome 127 is the first to let an extension open its popup, as a save that needs checking does.
      minimum_chrome_version: '127',
    };
  }
  return {
    ...common,
    background: { scripts: ['background.js'], type: 'module' },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ID,
        // Firefox 140 is the first to show what an extension sends, in its own words, at install.
        strict_min_version: '140.0',
        data_collection_permissions: {
          // Sent only when you save a job, end-to-end encrypted, to your own sync account: the
          // job's address, the posting's text, and the sign-in that saves it there.
          required: ['browsingActivity', 'websiteContent', 'authenticationInfo'],
        },
      },
    },
  };
}
