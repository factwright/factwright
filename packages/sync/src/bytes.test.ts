import { describe, expect, it } from 'vitest';
import {
  concat,
  fromBase64Url,
  fromUtf8,
  randomBytes,
  sameBytes,
  toBase64Url,
  utf8,
} from './bytes.ts';

describe('URL-safe base64', () => {
  it('matches the standard test vectors, without padding', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(toBase64Url(utf8(plain))).toBe(encoded);
      expect(fromUtf8(fromBase64Url(encoded) ?? new Uint8Array())).toBe(plain);
    }
  });

  it('uses the URL-safe characters', () => {
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff))).toBe('-_8');
  });

  it('gets back any bytes it wrote', () => {
    for (let length = 0; length < 70; length++) {
      const bytes = randomBytes(length);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('refuses anything but the one exact spelling', () => {
    expect(fromBase64Url('Zg==')).toBeNull();
    expect(fromBase64Url('Zm9v+')).toBeNull();
    expect(fromBase64Url('Z')).toBeNull();
    // "Zh" would also decode as "f", if leftover bits were allowed.
    expect(fromBase64Url('Zh')).toBeNull();
  });
});

describe('bytes', () => {
  it('reads UTF-8, and refuses bytes that aren’t', () => {
    expect(fromUtf8(utf8('Café ✓'))).toBe('Café ✓');
    expect(fromUtf8(Uint8Array.of(0xc3))).toBeNull();
  });

  it('joins and compares', () => {
    expect(concat(Uint8Array.of(1), Uint8Array.of(), Uint8Array.of(2, 3))).toEqual(
      Uint8Array.of(1, 2, 3),
    );
    expect(sameBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(sameBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(sameBytes(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
  });

  it('makes random bytes that differ each time', () => {
    expect(randomBytes(32)).toHaveLength(32);
    expect(sameBytes(randomBytes(16), randomBytes(16))).toBe(false);
  });
});
