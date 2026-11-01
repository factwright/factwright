/**
 * What's new, on the first open after an update: a few plain lines for each version, from
 * release-notes/<version>.short.md. A release checks them before anything is installed, with Node
 * reading this file as it is, so it imports nothing.
 */

/** The most lines a version's short notes may have, which keeps them to what matters most. */
export const MOST_SHORT_LINES = 6;

/** The most characters in a line of them, so each reads at a glance. */
export const MOST_SHORT_LINE_LENGTH = 140;

/** Whether a value is a version as releases number them, such as 0.19.0. */
export const isVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);

/** Whether a version is newer than another. Each part counts as a number: 0.10.0 beats 0.9.3. */
export function isNewerVersion(version: string, than: string): boolean {
  const others = than.split('.').map(Number);
  for (const [index, part] of version.split('.').map(Number).entries()) {
    const other = others[index] ?? 0;
    if (part !== other) return part > other;
  }
  return false;
}

/** What's wrong with a version's short notes, in words to act on, or null when they'll do. */
export function shortNotesProblem(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return 'They’re empty: say what’s new in a few plain lines.';
  if (lines.length > MOST_SHORT_LINES) {
    return `They have ${lines.length} lines: keep them to ${MOST_SHORT_LINES} at most.`;
  }
  const notListed = lines.find((line) => !line.startsWith('- '));
  if (notListed) return `Every line starts with "- ", and this one doesn’t: ${notListed}`;
  const long = lines.find((line) => line.length > MOST_SHORT_LINE_LENGTH);
  if (long) return `Keep each line to ${MOST_SHORT_LINE_LENGTH} characters at most: ${long}`;
  return null;
}
