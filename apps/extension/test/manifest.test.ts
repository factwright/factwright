import { EXTENSION_IDS } from '@factwright/sync';
import { describe, expect, it } from 'vitest';
import { FIREFOX_ID, manifest } from '../src/manifest.ts';

describe('each browser’s manifest', () => {
  it('asks for native messaging only when it’s used, so an update asks nothing of anyone', () => {
    const both = ['activeTab', 'scripting', 'storage', 'contextMenus', 'identity'];
    // Chrome's side panel and its rules for lighting the button up show no warning either.
    expect(manifest('chrome', '0.3.0').permissions).toEqual([
      ...both,
      'sidePanel',
      'declarativeContent',
    ]);
    expect(manifest('firefox', '0.3.0').permissions).toEqual(both);
    for (const target of ['chrome', 'firefox'] as const) {
      expect(manifest(target, '0.3.0').optional_permissions).toEqual(['nativeMessaging']);
    }
  });

  it('is Factwright, with a panel beside the page for filling a form, and a shortcut for it', () => {
    const chrome = manifest('chrome', '0.3.0');
    const firefox = manifest('firefox', '0.3.0');
    expect([chrome.name, firefox.name]).toEqual(['Factwright', 'Factwright']);
    expect(chrome.side_panel).toEqual({ default_path: 'sidepanel.html' });
    // Firefox's sidebar opens only when you click Fill, never on its own at install.
    expect(firefox.sidebar_action).toMatchObject({
      default_panel: 'sidepanel.html',
      open_at_install: false,
    });
    for (const built of [chrome, firefox]) {
      expect(Object.keys(built.commands as object)).toEqual(['save-job', 'fill-form']);
      // No content scripts, and nothing a page can load or message.
      expect(built).not.toHaveProperty('content_scripts');
      expect(built).not.toHaveProperty('web_accessible_resources');
      expect(built).not.toHaveProperty('externally_connectable');
    }
    expect((chrome.description as string).length).toBeLessThanOrEqual(132);
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
