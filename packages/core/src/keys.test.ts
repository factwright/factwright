import { describe, expect, it } from 'vitest';
import { companyKey, roleKey, slug } from './keys.ts';

/** How long something takes, in milliseconds. */
function timed(work: () => unknown): number {
  const start = Date.now();
  work();
  return Date.now() - start;
}

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

describe('keys from names made to keep the app busy', () => {
  it('are made in a moment, however many "(" are left open', () => {
    expect(timed(() => companyKey('('.repeat(100_000)))).toBeLessThan(1000);
    expect(timed(() => roleKey('('.repeat(100_000)))).toBeLessThan(1000);
  });

  it('are the same as before, so saved jobs keep matching', () => {
    expect(companyKey('Acme (US) Inc. (Remote)')).toBe('acme');
    expect(roleKey('Engineer (a (b) c)')).toBe('engineer-c');
    expect(roleKey('Engineer (left open')).toBe('engineer-left-open');
    // A "(…)" ends on its own line.
    expect(companyKey('Acme (x\ny) Co')).toBe('acme-x-y');
  });
});
