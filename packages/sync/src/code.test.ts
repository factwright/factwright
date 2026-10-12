import { describe, expect, it } from 'vitest';
import { randomBytes } from './bytes.ts';
import { fromCode, toCode } from './code.ts';

describe('codes for people', () => {
  it('writes 20 bytes as eight groups of four', () => {
    const code = toCode(randomBytes(20));
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('reads back what it wrote', () => {
    for (let i = 0; i < 50; i++) {
      const bytes = randomBytes(20);
      expect(fromCode(toCode(bytes), 20)).toEqual(bytes);
    }
  });

  it('takes the code however it’s typed', () => {
    const bytes = randomBytes(20);
    const code = toCode(bytes);
    expect(fromCode(code.toLowerCase(), 20)).toEqual(bytes);
    expect(fromCode(code.replaceAll('-', ' '), 20)).toEqual(bytes);
    expect(fromCode(code.replaceAll('-', ''), 20)).toEqual(bytes);
    // O, I and L are read as the digits people mean.
    expect(fromCode('O'.repeat(32), 20)).toEqual(new Uint8Array(20));
    expect(fromCode('1'.repeat(32), 20)).toEqual(fromCode('IlIlIlIlIlIlIlIlIlIlIlIlIlIlIlIl', 20));
  });

  it('refuses what isn’t a code of that length', () => {
    expect(fromCode('ABCD-EFGH', 20)).toBeNull();
    expect(fromCode('U'.repeat(32), 20)).toBeNull();
    expect(fromCode(`${'A'.repeat(31)}!`, 20)).toBeNull();
    expect(fromCode('', 20)).toBeNull();
  });
});
