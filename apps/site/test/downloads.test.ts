// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Browser,
  downloadPage,
  offerDownloads,
  platform,
  START_AFTER_MS,
  startDownload,
} from '../src/downloads.ts';

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

  it('knows a Windows PC with a touch screen', () => {
    expect(
      platform(
        browser('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', {
          platform: 'Win32',
          maxTouchPoints: 10,
        }),
      ),
    ).toBe('windows');
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

/** One of the site's pages, as written. */
const source = (page: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', page), 'utf8');

describe('offerDownloads', () => {
  const page = source('index.html');
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
      ['Open source', ''],
      ['Also for Windows', ''],
    ]);
    expect(root.querySelector<HTMLElement>('[data-for="mac"]')?.hidden).toBe(false);
  });

  it('offers the Windows download first on a PC, with the Mac as a link', () => {
    const root = hero();
    offerDownloads(root, 'windows');
    expect(shown(root)).toEqual([
      ['Download for Windows', 'button button-primary button-lg'],
      ['Open source', ''],
      ['Also for Mac', ''],
    ]);
    // "Apple silicon and Intel" is about the Mac download, which a PC only sees as a link.
    expect(root.querySelector<HTMLElement>('[data-for="mac"]')?.hidden).toBe(true);
  });

  it('shows both as buttons until it knows', () => {
    expect(shown(hero()).map(([text]) => text)).toEqual([
      'Download for Mac',
      'Download for Windows',
      'Open source',
    ]);
  });
});

describe('a download page', () => {
  /** A computer's download page in this test's document, with its script's download not started. */
  const open = (computer: 'mac' | 'windows') => {
    const parsed = new DOMParser().parseFromString(
      source(`download/${computer}.html`),
      'text/html',
    );
    document.body.innerHTML = parsed.body.innerHTML;
    const page = document.querySelector<HTMLElement>(`[data-get="${computer}"]`);
    if (!page) throw new Error(`no ${computer} page`);
    return page;
  };
  let started: string[];
  const go = (url: string) => started.push(url);

  beforeEach(() => {
    vi.useFakeTimers();
    started = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts its download a moment after it shows', () => {
    startDownload(open('mac'), go);
    vi.advanceTimersByTime(START_AFTER_MS - 1);
    expect(started).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(started).toEqual(['https://downloads.factwright.com/Factwright.dmg']);
  });

  it('downloads the installer its link offers, as the Worker fills it in', () => {
    const page = open('windows');
    page
      .querySelector('a[data-direct]')
      ?.setAttribute('href', 'https://downloads.factwright.com/Factwright-Setup-0.1.0.exe');
    startDownload(page, go);
    vi.advanceTimersByTime(START_AFTER_MS);
    expect(started).toEqual(['https://downloads.factwright.com/Factwright-Setup-0.1.0.exe']);
  });

  it('doesn’t start by itself once a link is followed, its own or one away', () => {
    for (const link of ['a[data-direct]', 'a[href="/download/windows"]', 'a.brand']) {
      const page = open('mac');
      startDownload(page, go);
      const anchor = document.querySelector<HTMLAnchorElement>(link) ?? page;
      anchor.addEventListener('click', (event) => event.preventDefault());
      anchor.click();
      vi.advanceTimersByTime(START_AFTER_MS);
      expect(started, link).toEqual([]);
    }
  });

  it('names each computer’s page', () => {
    expect(downloadPage('mac')).toBe('/download/mac');
    expect(downloadPage('windows')).toBe('/download/windows');
  });
});
