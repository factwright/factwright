import { describe, expect, it } from 'vitest';
import { parsePay } from './pay.ts';

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
  });

  it.each([null, undefined, '', 'Competitive', 'DOE', '2-3 years of experience', '$5 bonus'])(
    'returns null for %j',
    (text) => {
      expect(parsePay(text)).toBeNull();
    },
  );
});
