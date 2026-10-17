import { describe, expect, it } from 'vitest';
import { isLegal, knownFeatures } from './protocol.ts';

describe('a server’s terms and privacy policy', () => {
  it('are two https pages', () => {
    expect(
      isLegal({ terms: 'https://factwright.com/terms', privacy: 'https://factwright.com/privacy' }),
    ).toBe(true);
  });

  it('aren’t anything a link could run, or anything else', () => {
    const privacy = 'https://factwright.com/privacy';
    for (const terms of [
      'javascript:alert(1)',
      'http://factwright.com/terms',
      'data:text/html,hi',
      '/terms',
      `https://factwright.com/${'a'.repeat(2000)}`,
      42,
      undefined,
    ]) {
      expect(isLegal({ terms, privacy })).toBe(false);
    }
    expect(isLegal({ terms: privacy })).toBe(false);
    expect(isLegal(null)).toBe(false);
    expect(isLegal('https://factwright.com/terms')).toBe(false);
  });
});

describe('a server’s features', () => {
  it('are the ones this version knows, from a list', () => {
    expect(knownFeatures(['approve', 'subscription'])).toEqual(['approve', 'subscription']);
    expect(knownFeatures(['approve', 'teleport', 7, null])).toEqual(['approve']);
  });

  it('are none from a server too old to list them', () => {
    expect(knownFeatures(undefined)).toEqual([]);
    expect(knownFeatures('approve')).toEqual([]);
    expect(knownFeatures({ approve: true })).toEqual([]);
  });
});
