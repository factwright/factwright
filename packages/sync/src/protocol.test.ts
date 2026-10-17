import { describe, expect, it } from 'vitest';
import { isLegal } from './protocol.ts';

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
