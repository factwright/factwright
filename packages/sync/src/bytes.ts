/** Bytes in memory. Web Crypto takes and gives these on every platform the app runs on. */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const utf8 = (text: string): Bytes => encoder.encode(text);

/** Text from UTF-8 bytes, or null when they aren't valid UTF-8. */
export function fromUtf8(bytes: Bytes): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/** Random bytes from the system's secure random generator. */
export function randomBytes(length: number): Bytes {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function concat(...parts: Bytes[]): Bytes {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

export function sameBytes(a: Bytes, b: Bytes): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_VALUES = new Map([...BASE64URL].map((char, value) => [char, value]));

/** URL-safe base64 without padding, for IDs and data in JSON and URLs. */
export function toBase64Url(bytes: Bytes): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const left = bytes.length - i;
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    text += BASE64URL.charAt((n >> 18) & 63) + BASE64URL.charAt((n >> 12) & 63);
    if (left > 1) text += BASE64URL.charAt((n >> 6) & 63);
    if (left > 2) text += BASE64URL.charAt(n & 63);
  }
  return text;
}

/**
 * Bytes from URL-safe base64 without padding, or null for anything else. Only the one exact
 * spelling of each value is taken, so the same bytes can't arrive under two names.
 */
export function fromBase64Url(text: string): Bytes | null {
  if (text.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of text) {
    const digit = BASE64URL_VALUES.get(char);
    if (digit === undefined) return null;
    value = ((value << 6) | digit) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (value >> bits) & 255;
    }
  }
  // Leftover bits must be zero, or two spellings would decode the same.
  if ((value & ((1 << bits) - 1)) !== 0) return null;
  return bytes;
}
