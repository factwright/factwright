import type { SaveHelperView, SetUpResult } from '../../shared/save-helper.ts';
import { BROWSERS } from './browsers.ts';
import { type SaveHelperDeps, saveHelperStatus, setUpSaveHelper } from './register.ts';

/**
 * macOS's System Settings at Privacy & Security, then Files & Folders, where the user lets
 * Factwright reach a browser's data after saying no, or after macOS blocked it.
 */
export const FILES_AND_FOLDERS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders';

/** The app's side of the Browser extension window. */
export interface SaveHelper {
  /** Where each browser on this computer stands. Looking never touches a browser's folders. */
  status(): SaveHelperView;
  /**
   * Sets browsers up, as the user asked: the ones given, or every one found. On a Mac, macOS may
   * ask the user first, for each browser.
   */
  setUp(only?: readonly string[]): Promise<SetUpResult>;
  /** Opens Files & Folders in macOS's System Settings. Answers whether it opened. */
  openFilesAndFolders(): Promise<boolean>;
}

const nameOf = (id: string) => BROWSERS.find((browser) => browser.id === id)?.name ?? id;

/**
 * The window's side of registering, with what registering needs, or null for a copy that leaves
 * the browsers as they are: one run from the code, or one another program drives, as the tests do.
 */
export function createSaveHelper(
  deps: SaveHelperDeps | null,
  {
    platform,
    openExternal,
  }: { platform: NodeJS.Platform; openExternal: (url: string) => Promise<void> },
): SaveHelper {
  const leftAlone = (): SaveHelperView => ({
    unavailable: 'development',
    onRequest: platform === 'darwin',
    browsers: [],
  });
  return {
    status: () => (deps ? saveHelperStatus(deps) : leftAlone()),
    async setUp(only) {
      if (!deps) return { view: leftAlone(), problems: [] };
      const result = await setUpSaveHelper(deps, only);
      const problems =
        'failed' in result
          ? result.failed.map((problem) => ({
              id: problem.browser,
              name: nameOf(problem.browser),
              blocked: problem.blocked,
              message: problem.message,
            }))
          : [];
      return { view: saveHelperStatus(deps), problems };
    },
    async openFilesAndFolders() {
      if (platform !== 'darwin') return false;
      try {
        await openExternal(FILES_AND_FOLDERS);
        return true;
      } catch {
        return false;
      }
    },
  };
}
