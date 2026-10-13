// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Browser, offerDownloads, platform } from '../src/downloads.ts';

const browser = (userAgent: string, more: Partial<Browser> = {}): Browser => ({
  userAgent,
  platform: '',
  maxTouchPoints: 0,
  ...more,
});

describe('platform', () => {
  it('tells a Mac from a Windows PC', () => {
    expect(
      platform(
        browser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { platform: 'MacIntel' }),
      ),
    ).toBe('mac');
    expect(
      platform(browser('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', { platform: 'Win32' })),
    ).toBe('windows');
    expect(platform(browser('', { userAgentData: { platform: 'macOS' } }))).toBe('mac');
    expect(platform(browser('', { userAgentData: { platform: 'Windows' } }))).toBe('windows');
  });

  it('gives neither for a phone, a tablet, an iPad that calls itself a Mac, or Linux', () => {
    expect(platform(browser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'))).toBeNull();
    expect(platform(browser('Mozilla/5.0 (Linux; Android 15; Pixel 9)'))).toBeNull();
    expect(
      platform(
        browser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', {
          platform: 'MacIntel',
          maxTouchPoints: 5,
        }),
      ),
    ).toBeNull();
    expect(
      platform(browser('Mozilla/5.0 (X11; Linux x86_64)', { platform: 'Linux x86_64' })),
    ).toBeNull();
  });
});

describe('offerDownloads', () => {
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
    'utf8',
  );
  const hero = () => {
    document.body.innerHTML =
      new DOMParser().parseFromString(page, 'text/html').querySelector('[data-downloads]')
        ?.outerHTML ?? '';
    const root = document.querySelector<HTMLElement>('[data-downloads]');
    if (!root) throw new Error('no downloads');
    return root;
  };
  const shown = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('a')]
      .filter((link) => !link.closest('[hidden]'))
      .map((link) => [link.textContent?.trim(), link.className]);

  it('offers the Mac download first on a Mac, with Windows as a link', () => {
    const root = hero();
    offerDownloads(root, 'mac');
    expect(shown(root)).toEqual([
      ['Download for Mac', 'button button-primary button-lg'],
      ['Also for Windows', ''],
    ]);
    expect(root.querySelector<HTMLElement>('[data-for="mac"]')?.hidden).toBe(false);
  });

  it('offers the Windows download first on a PC, with the Mac as a link', () => {
    const root = hero();
    offerDownloads(root, 'windows');
    expect(shown(root)).toEqual([
      ['Download for Windows', 'button button-primary button-lg'],
      ['Also for Mac', ''],
    ]);
    // "Apple silicon and Intel" is about the Mac download, which a PC only sees as a link.
    expect(root.querySelector<HTMLElement>('[data-for="mac"]')?.hidden).toBe(true);
  });

  it('shows both as buttons until it knows', () => {
    expect(shown(hero()).map(([text]) => text)).toEqual([
      'Download for Mac',
      'Download for Windows',
    ]);
  });
});
