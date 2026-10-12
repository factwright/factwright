/** A short fingerprint of some text: 32-bit FNV-1a, as eight hex digits. */
export function fingerprintText(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const STAMP = /^<!-- Written by Factwright \(([0-9a-f]{8})\)\. [^\n]*? -->\n/;

/**
 * A file the app writes from the user's answers, with a first line that says so and carries a
 * fingerprint of the rest, so the app can tell later whether anyone has changed it since.
 */
export const stamped = (body: string, how: string) =>
  `<!-- Written by Factwright (${fingerprintText(body)}). ${how} -->\n${body}`;

/**
 * Whether a file is just as the app last wrote it, so the app may write it again. A file that's
 * missing counts. One that the user or Claude has changed doesn't, and stays as they left it.
 */
export function untouched(text: string | null): boolean {
  if (text === null) return true;
  const stamp = STAMP.exec(text);
  return stamp !== null && stamp[1] === fingerprintText(text.slice(stamp[0].length));
}
