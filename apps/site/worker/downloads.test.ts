import { describe, expect, it } from 'vitest';
import { COUNTED_DOWNLOADS, countDownload, downloadLink, isFollowedLink } from './downloads.ts';

/** Stands in for the Analytics Engine dataset, keeping what's written. */
function dataset() {
  const written: AnalyticsEngineDataPoint[] = [];
  return {
    written,
    writeDataPoint: (point?: AnalyticsEngineDataPoint) => written.push(point ?? {}),
  };
}

describe('a download’s count', () => {
  it('keeps the computer and the version, and nothing about who downloaded it', () => {
    const downloads = dataset();
    countDownload(downloads, 'mac', '0.4.0');
    countDownload(downloads, 'windows', null);
    expect(downloads.written).toEqual([
      { indexes: ['mac'], blobs: ['mac', '0.4.0'], doubles: [1] },
      { indexes: ['windows'], blobs: ['windows', 'unknown'], doubles: [1] },
    ]);
  });

  it('counts nothing without a dataset', () => {
    expect(() => countDownload(undefined, 'mac', '0.4.0')).not.toThrow();
  });
});

describe('the links that count', () => {
  it('are one for each computer, under /download/get/', () => {
    expect(downloadLink('mac')).toBe('/download/get/mac');
    expect([...COUNTED_DOWNLOADS]).toEqual([
      ['/download/get/mac', 'mac'],
      ['/download/get/windows', 'windows'],
    ]);
  });
});

describe('a followed link', () => {
  const asked = (headers: Record<string, string>) =>
    isFollowedLink(new Request('https://factwright.com/download/get/mac', { headers }));
  const tab = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };

  it('is the whole tab going to the link, as every current browser marks it', () => {
    expect(asked(tab)).toBe(true);
  });

  it('isn’t anything that doesn’t say how it asked, such as a link preview or a download tool', () => {
    expect(asked({})).toBe(false);
    expect(asked({ 'Sec-Fetch-Mode': 'navigate' })).toBe(false);
  });

  it('isn’t a script, a frame, a prefetch, or a download picking up where it left off', () => {
    expect(asked({ 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' })).toBe(false);
    expect(asked({ 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'image' })).toBe(false);
    expect(asked({ ...tab, 'Sec-Fetch-Dest': 'iframe' })).toBe(false);
    expect(asked({ ...tab, 'Sec-Purpose': 'prefetch' })).toBe(false);
    expect(asked({ ...tab, 'Sec-Purpose': 'prefetch;prerender' })).toBe(false);
    expect(asked({ ...tab, Purpose: 'Prefetch' })).toBe(false);
    expect(asked({ ...tab, 'X-Moz': 'prefetch' })).toBe(false);
    expect(asked({ ...tab, Range: 'bytes=1000-' })).toBe(false);
  });
});
