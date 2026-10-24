import { EXTENSION_IDS } from '@factwright/sync';
import { describe, expect, it } from 'vitest';
import { jobSites } from '../src/applicant-systems.ts';
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

  it('has a panel beside the page for filling a form, and a shortcut for it', () => {
    const chrome = manifest('chrome', '0.3.0');
    const firefox = manifest('firefox', '0.3.0');
    expect(chrome.side_panel).toEqual({ default_path: 'sidepanel.html' });
    // Firefox's sidebar opens only when you click Fill, never on its own at install.
    expect(firefox.sidebar_action).toMatchObject({
      default_panel: 'sidepanel.html',
      open_at_install: false,
    });
    for (const built of [chrome, firefox]) {
      expect(Object.keys(built.commands as object)).toEqual(['save-job', 'fill-form']);
      // No content scripts of its own, and nothing a page can message. Its frame is for its
      // script on the job sites you allowed, which it registers once you allow them.
      expect(built).not.toHaveProperty('content_scripts');
      expect(built).not.toHaveProperty('externally_connectable');
      expect(built.web_accessible_resources).toMatchObject([{ resources: ['frame.html'] }]);
    }
    expect((chrome.description as string).length).toBeLessThanOrEqual(132);
  });

  it('is called Factwright, on its button and on Firefox’s sidebar too', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      const built = manifest(target, '0.3.0');
      expect(built.name).toBe('Factwright');
      expect(built.action).toMatchObject({ default_title: 'Factwright' });
    }
    expect(manifest('firefox', '0.3.0').sidebar_action).toMatchObject({
      default_title: 'Factwright',
    });
  });

  it('asks for it at install only in the end-to-end run’s build', () => {
    const built = manifest('chrome', '0.2.0', 'http://127.0.0.1:8787', { nativeAtInstall: true });
    expect(built.permissions).toContain('nativeMessaging');
    expect(built).not.toHaveProperty('optional_permissions');
  });

  it('needs Chrome 130, the first to keep its frame at an address of each session’s own', () => {
    expect(manifest('chrome', '0.3.0').minimum_chrome_version).toBe('130');
  });

  it('asks for the job application sites when you turn them on, never at install', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      const built = manifest(target, '0.3.0');
      expect(built.host_permissions).toEqual(['https://app.factwright.com/*']);
      expect(built.optional_host_permissions).toEqual(
        expect.arrayContaining(['https://jobs.lever.co/*', 'https://*.myworkdayjobs.com/*']),
      );
      const asked = [
        ...(built.host_permissions as string[]),
        ...(built.optional_host_permissions as string[]),
      ];
      expect(asked).not.toContain('<all_urls>');
      expect(asked.some((site) => /linkedin|indeed/.test(site))).toBe(false);
    }
    // Only the end-to-end run in Chromium has them at install, as it can't answer the prompt.
    const forTests = manifest('chrome', '0.3.0', 'http://127.0.0.1:8787', {
      jobSitesAtInstall: true,
    });
    expect(forTests.host_permissions).toEqual(['http://127.0.0.1/*', ...jobSites(false)]);
    expect(forTests.optional_host_permissions).toEqual(['https://*/*', 'http://localhost/*']);
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
