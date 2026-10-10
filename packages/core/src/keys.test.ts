import { describe, expect, it } from 'vitest';
import { companyKey, roleKey, slug } from './keys.ts';

describe('slug', () => {
  it.each([
    ['Café & Co.', 'cafe-and-co'],
    ['  Senior Engineer, Platform  ', 'senior-engineer-platform'],
    ['Ünïcödé', 'unicode'],
    ['---', ''],
  ])('turns "%s" into "%s"', (text, expected) => {
    expect(slug(text)).toBe(expected);
  });
});

describe('companyKey', () => {
  it('gives one key for different spellings of a company', () => {
    expect(companyKey('Acme, Inc.')).toBe('acme');
    expect(companyKey('The Acme Company (US)')).toBe('acme');
    expect(companyKey('ACME Corp')).toBe('acme');
  });
});

describe('roleKey', () => {
  it('ignores parentheticals', () => {
    expect(roleKey('Senior Engineer (Remote)')).toBe('senior-engineer');
  });
});
