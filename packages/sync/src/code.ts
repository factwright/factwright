import type { Bytes } from './bytes.ts';

/**
 * Crockford's base32: digits and capital letters, without I, L, O and U, which people misread.
 * Recovery keys and link codes are written in it, for people to type or keep on paper.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** What each character reads as. Lowercase counts, as do I and L for 1 and O for 0. */
const VALUES = new Map<string, number>([
  ...[...ALPHABET].map((char, value): [string, number] => [char, value]),
  ['I', 1],
  ['L', 1],
  ['O', 0],
]);

/** Bytes as groups of four characters, such as "7KQ2-M9XD-…". A multiple of 5 bytes reads best. */
export function toCode(bytes: Bytes): string {
  let text = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += ALPHABET.charAt((value >> bits) & 31);
    }
  }
  if (bits > 0) text += ALPHABET.charAt((value << (5 - bits)) & 31);
  return text.match(/.{1,4}/g)?.join('-') ?? '';
}

/**
 * The bytes a code holds, or null when it isn't a code of that many bytes. Spaces and dashes
 * don't count, so it can be typed with or without them.
 */
export function fromCode(text: string, length: number): Bytes | null {
  const chars = text.toUpperCase().replace(/[\s-]/g, '');
  if (chars.length !== Math.ceil((length * 8) / 5)) return null;
  const bytes = new Uint8Array(length);
  let value = 0;
  let bits = 0;
  let at = 0;
  for (const char of chars) {
    const digit = VALUES.get(char);
    if (digit === undefined) return null;
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (at < length) bytes[at++] = (value >> bits) & 255;
    }
  }
  return bytes;
}
