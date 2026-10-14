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

  it('takes the code as other apps and keyboards change it', () => {
    const bytes = randomBytes(20);
    const code = toCode(bytes);
    // Long dashes, as a phone or a note app puts in, and a line break from copying.
    expect(fromCode(code.replaceAll('-', '\u2014'), 20)).toEqual(bytes);
    expect(fromCode(code.replaceAll('-', '\u2013'), 20)).toEqual(bytes);
    expect(fromCode(code.replaceAll('-', '\u2011'), 20)).toEqual(bytes);
    expect(fromCode(`  ${code}\n`, 20)).toEqual(bytes);
    expect(fromCode(code.replaceAll('-', '\u00a0'), 20)).toEqual(bytes);
    // Full-width letters and digits, as some keyboards type them.
    const wide = [...code]
      .map((char) =>
        char === '-' ? char : String.fromCodePoint((char.codePointAt(0) ?? 0) + 0xfee0),
      )
      .join('');
    expect(fromCode(wide, 20)).toEqual(bytes);
  });

  it('refuses what isn’t a code of that length', () => {
    expect(fromCode('ABCD-EFGH', 20)).toBeNull();
    expect(fromCode('U'.repeat(32), 20)).toBeNull();
    expect(fromCode(`${'A'.repeat(31)}!`, 20)).toBeNull();
    expect(fromCode('', 20)).toBeNull();
  });
});
