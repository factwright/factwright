import { describe, expect, it, vi } from 'vitest';
import type { SaveHelperView } from '../../shared/save-helper.ts';
import type { SaveHelperDeps } from './register.ts';
import { createSaveHelper, FILES_AND_FOLDERS } from './save-helper.ts';

const VIEW: SaveHelperView = {
  unavailable: null,
  onRequest: true,
  browsers: [
    { id: 'chrome', name: 'Google Chrome', state: 'blocked', allow: ['Google Chrome'] },
    { id: 'firefox', name: 'Firefox', state: 'ready', allow: ['Firefox'] },
  ],
};

vi.mock('./register.ts', () => ({
  saveHelperStatus: vi.fn(() => VIEW),
  setUpSaveHelper: vi.fn(async () => ({
    registered: ['firefox'],
    failed: [{ browser: 'chrome', message: 'EPERM: operation not permitted', blocked: true }],
  })),
}));

const deps = { platform: 'darwin' } as SaveHelperDeps;

describe('the Browser extension window’s side of registering', () => {
  it('leaves the browsers alone in a copy run from the code, or driven by the tests', async () => {
    const helper = createSaveHelper(null, { platform: 'darwin', openExternal: vi.fn() });
    const leftAlone = { unavailable: 'development', onRequest: true, browsers: [] };
    expect(helper.status()).toEqual(leftAlone);
    expect(await helper.setUp(['chrome'])).toEqual({ view: leftAlone, problems: [] });
    expect(
      createSaveHelper(null, { platform: 'win32', openExternal: vi.fn() }).status().onRequest,
    ).toBe(false);
  });

  it('answers with where each browser stands now, and names the ones that didn’t work', async () => {
    const helper = createSaveHelper(deps, { platform: 'darwin', openExternal: vi.fn() });
    expect(helper.status()).toEqual(VIEW);
    expect(await helper.setUp(['chrome', 'firefox'])).toEqual({
      view: VIEW,
      problems: [
        {
          id: 'chrome',
          name: 'Google Chrome',
          blocked: true,
          message: 'EPERM: operation not permitted',
        },
      ],
    });
  });

  it('opens Files & Folders on a Mac only, and says when it couldn’t', async () => {
    const openExternal = vi.fn(async () => {});
    expect(
      await createSaveHelper(deps, { platform: 'darwin', openExternal }).openFilesAndFolders(),
    ).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(FILES_AND_FOLDERS);
    openExternal.mockClear();
    expect(
      await createSaveHelper(deps, { platform: 'win32', openExternal }).openFilesAndFolders(),
    ).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
    const failing = vi.fn(async () => {
      throw new Error('No app for that address.');
    });
    expect(
      await createSaveHelper(deps, {
        platform: 'darwin',
        openExternal: failing,
      }).openFilesAndFolders(),
    ).toBe(false);
  });
});
