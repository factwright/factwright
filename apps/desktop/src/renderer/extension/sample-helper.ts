import type { FactwrightApi } from '../../shared/api.ts';
import type {
  HelperBrowserView,
  HelperUnavailable,
  SaveHelperView,
  SetUpResult,
} from '../../shared/save-helper.ts';

const UNAVAILABLE: readonly HelperUnavailable[] = [
  'other-system',
  'development',
  'translocated',
  'disk-image',
  'no-helper',
];

/**
 * Sample answers for the Save to Factwright window, which ?helper picks:
 * - unset: Google Chrome isn't set up yet, and Firefox is ready.
 * - blocked: macOS blocked Google Chrome.
 * - brave: Brave too, which macOS blocked, and whose file goes in Chrome's folder as well.
 * - refuse: setting a browser up is refused, as when the user chooses Don't Allow.
 * - none: no browser Save to Factwright runs in is installed.
 * - development, translocated, disk-image, no-helper or other-system: this copy can't set the
 *   browsers up, and why.
 * On Windows (?platform=win32), the browsers are set up as the app starts, so both are ready.
 * Setting up takes a moment, as macOS asking does, and sticks until the page reloads.
 */
export function sampleSaveHelper(
  choice: string | null,
  platform: string,
): Pick<FactwrightApi, 'saveHelperStatus' | 'setUpSaveHelper' | 'openFilesAndFolders'> {
  const onRequest = platform === 'darwin';
  const unavailable = UNAVAILABLE.find((reason) => reason === choice) ?? null;
  let browsers: HelperBrowserView[] =
    choice === 'none' || unavailable
      ? []
      : [
          {
            id: 'chrome',
            name: 'Google Chrome',
            state: !onRequest ? 'ready' : choice === 'blocked' ? 'blocked' : 'not-set-up',
            allow: onRequest ? ['Google Chrome'] : [],
          },
          ...(choice === 'brave'
            ? [
                {
                  id: 'brave',
                  name: 'Brave',
                  state: 'blocked' as const,
                  allow: ['Google Chrome', 'Brave Browser'],
                },
              ]
            : []),
          { id: 'firefox', name: 'Firefox', state: 'ready', allow: onRequest ? ['Firefox'] : [] },
        ];
  const view = (): SaveHelperView => ({
    unavailable,
    onRequest,
    browsers: browsers.map((browser) => ({ ...browser })),
  });
  return {
    saveHelperStatus: async () => view(),
    setUpSaveHelper: async (only) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const asked = browsers.filter((browser) => !only || only.includes(browser.id));
      const refused = choice === 'refuse';
      browsers = browsers.map((browser) =>
        asked.includes(browser) ? { ...browser, state: refused ? 'blocked' : 'ready' } : browser,
      );
      const result: SetUpResult = {
        view: view(),
        problems: refused
          ? asked.map(({ id, name }) => ({
              id,
              name,
              blocked: true,
              message: 'Operation not permitted',
            }))
          : [],
      };
      return result;
    },
    openFilesAndFolders: async () => onRequest,
  };
}
