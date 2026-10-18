import { EXTENSION_IDS } from '@factwright/sync';
import { describe, expect, it } from 'vitest';
import { FIREFOX_ID, manifest } from '../src/manifest.ts';

describe('each browser’s manifest', () => {
  it('asks for native messaging only when it’s used, so an update asks nothing of anyone', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      const built = manifest(target, '0.2.0');
      expect(built.permissions).toEqual([
        'activeTab',
        'scripting',
        'storage',
        'contextMenus',
        'identity',
      ]);
      expect(built.optional_permissions).toEqual(['nativeMessaging']);
    }
  });

  it('asks for it at install only in the end-to-end run’s build', () => {
    const built = manifest('chrome', '0.2.0', 'http://127.0.0.1:8787', { nativeAtInstall: true });
    expect(built.permissions).toContain('nativeMessaging');
    expect(built).not.toHaveProperty('optional_permissions');
  });

  it('has the Firefox ID Factwright’s helper lets reach it', () => {
    const gecko = (
      manifest('firefox', '0.2.0').browser_specific_settings as {
        gecko: { id: string };
      }
    ).gecko;
    expect(gecko.id).toBe(FIREFOX_ID);
    expect(FIREFOX_ID).toBe(EXTENSION_IDS.firefox);
  });
});
