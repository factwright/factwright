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

  it('never stops a download when counting fails', () => {
    const failing = {
      writeDataPoint: () => {
        throw new Error('Analytics Engine is down');
      },
    };
    expect(() => countDownload(failing, 'mac', '0.4.0')).not.toThrow();
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

  it('is a navigation, or a request that doesn’t say', () => {
    expect(asked({ 'Sec-Fetch-Mode': 'navigate' })).toBe(true);
    expect(asked({})).toBe(true);
  });

  it('isn’t a script’s request or a prefetch', () => {
    expect(asked({ 'Sec-Fetch-Mode': 'cors' })).toBe(false);
    expect(asked({ 'Sec-Fetch-Mode': 'no-cors' })).toBe(false);
    expect(asked({ 'Sec-Fetch-Mode': 'navigate', 'Sec-Purpose': 'prefetch' })).toBe(false);
    expect(asked({ 'Sec-Fetch-Mode': 'navigate', 'Sec-Purpose': 'prefetch;prerender' })).toBe(
      false,
    );
    expect(asked({ Purpose: 'Prefetch' })).toBe(false);
    expect(asked({ 'X-Moz': 'prefetch' })).toBe(false);
  });
});
