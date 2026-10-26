import { describe, expect, it } from 'vitest';
import { parsePay, payBand } from './pay.ts';

describe('parsePay', () => {
  it.each([
    ['$190,000 - $250,000', { min: 190_000, max: 250_000 }],
    ['$150-200k', { min: 150_000, max: 200_000 }],
    ['$150k to $200k', { min: 150_000, max: 200_000 }],
    ['$142k–$172k', { min: 142_000, max: 172_000 }],
    ['$70-$85 an hour', { min: 145_600, max: 176_800 }],
    ['$1.2M', { min: 1_200_000, max: 1_200_000 }],
    ['Base salary 165000 plus equity', { min: 165_000, max: 165_000 }],
    ['$120k base, 401(k) match', { min: 120_000, max: 120_000 }],
    ['2-3 years of experience, $150k-$180k', { min: 150_000, max: 180_000 }],
    // A number right after a sentence's full stop is still read.
    ['The pay range is below.150,000 - 200,000', { min: 150_000, max: 200_000 }],
    ['Pay..95,000-110,000', { min: 95_000, max: 110_000 }],
    ['$161,000 - $245,000 a year', { min: 161_000, max: 245_000 }],
    ['$144000.00 To $237500.00 / year', { min: 144_000, max: 237_500 }],
  ])('reads "%s"', (text, range) => {
    expect(parsePay(text)).toEqual(range);
  });

  it('ignores a range in parentheses, which usually belongs to another level', () => {
    expect(parsePay('Senior: $142k-$172k (Staff: $180k-$220k)')).toEqual({
      min: 142_000,
      max: 172_000,
    });
    // From a "(" to the next ")", as it always was, nested or not, and a "(" never closed stays.
    expect(parsePay('Senior: $142k-$172k (Staff: $180k-$220k (remote) or more)')).toEqual({
      min: 142_000,
      max: 172_000,
    });
    expect(parsePay('$150k-$170k (and equity')).toEqual({ min: 150_000, max: 170_000 });
  });

  it('reads text a page made to be slow as fast as any', () => {
    for (const text of [
      '('.repeat(100_000),
      `1${' '.repeat(100_000)}x`,
      `${'1'.repeat(100_000)}x`,
      `$${' '.repeat(100_000)}`,
      `401${' '.repeat(100_000)}`,
      `${'1.'.repeat(50_000)}x`,
    ]) {
      const start = Date.now();
      parsePay(text);
      expect(Date.now() - start).toBeLessThan(1000);
    }
  });

  it.each([null, undefined, '', 'Competitive', 'DOE', '2-3 years of experience', '$5 bonus'])(
    'returns null for %j',
    (text) => {
      expect(parsePay(text)).toBeNull();
    },
  );
});

describe('payBand', () => {
  it.each([
    ['$100,000 - $149,999', { min: 100_000, max: 149_999 }],
    ['$100k–$150k', { min: 100_000, max: 150_000 }],
    ['100-150k', { min: 100_000, max: 150_000 }],
    ['$50,000 to $74,999 per year', { min: 50_000, max: 74_999 }],
    ['$40,000 up to $60,000', { min: 40_000, max: 60_000 }],
    ['$0 - $49,999', { min: 0, max: 49_999 }],
    ['Less than $100,000', { min: 0, max: 100_000 }],
    ['Under $50k', { min: 0, max: 50_000 }],
    ['Up to $75,000', { min: 0, max: 75_000 }],
    ['$200,000 or more', { min: 200_000, max: Number.POSITIVE_INFINITY }],
    ['$250k+', { min: 250_000, max: Number.POSITIVE_INFINITY }],
    ['More than $300,000', { min: 300_000, max: Number.POSITIVE_INFINITY }],
    ['200,000 and above', { min: 200_000, max: Number.POSITIVE_INFINITY }],
    ['$70 - $85 per hour', { min: 145_600, max: 176_800 }],
    ['$150,000', { min: 150_000, max: 150_000 }],
    ['$50,000 or less', { min: 0, max: 50_000 }],
    ['$200,000 or greater', { min: 200_000, max: Number.POSITIVE_INFINITY }],
    // A tier's or level's number before the band isn't money.
    ['Tier 2 - $100k-$150k', { min: 100_000, max: 150_000 }],
    ['Level 3 – $150,000 to $199,999', { min: 150_000, max: 199_999 }],
  ])('reads "%s"', (text, band) => {
    expect(payBand(text)).toEqual(band);
  });

  it.each(['Prefer not to say', 'Negotiable', 'Other', '0-2 years', ''])(
    'returns null for %j',
    (text) => {
      expect(payBand(text)).toBeNull();
    },
  );

  it('reads no band from an option longer than a band takes, or one a page made to be slow', () => {
    expect(payBand(`$100,000 - $149,999 ${'x'.repeat(300)}`)).toBeNull();
    for (const text of [
      '('.repeat(300),
      `1${' '.repeat(298)}x`,
      `${'1'.repeat(299)}x`,
      `1${' '.repeat(298)}+`.slice(0, 300),
    ]) {
      const start = Date.now();
      payBand(text);
      expect(Date.now() - start).toBeLessThan(100);
    }
  });
});
