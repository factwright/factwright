import { describe, expect, it } from 'vitest';
import { escapeTerm, plainTerm, TERMS_HEADER, termsIn, withTerms } from './terms.ts';

describe('confidential terms', () => {
  it('escapes a name so it matches as it reads', () => {
    expect(escapeTerm('Acme (US) Inc.')).toBe('Acme \\(US\\) Inc\\.');
    expect(plainTerm('Acme \\(US\\) Inc\\.')).toBe('Acme (US) Inc.');
    expect(new RegExp(escapeTerm('C++ team'), 'i').test('the c++ team')).toBe(true);
  });

  it('starts the file with what it’s for', () => {
    expect(withTerms(null, ['Bluebird'])).toBe(`${TERMS_HEADER}\nBluebird\n`);
  });

  it('keeps the lines it keeps exactly, adds new names escaped, and drops removed ones', () => {
    const file = `${TERMS_HEADER}\n# customers\nacme(corp)?\nBluebird\nhost-17\\.internal\n`;
    expect(withTerms(file, ['acme(corp)?', 'host-17.internal', 'Project Kite'])).toBe(
      `${TERMS_HEADER}\n# customers\nacme(corp)?\nhost-17\\.internal\nProject Kite\n`,
    );
    expect(termsIn(file)).toEqual(['acme(corp)?', 'Bluebird', 'host-17.internal']);
  });

  it('keeps each name once, whatever its case', () => {
    expect(withTerms(`${TERMS_HEADER}\nBluebird\n`, ['bluebird', 'BLUEBIRD'])).toBe(
      `${TERMS_HEADER}\nBluebird\n`,
    );
  });
});
