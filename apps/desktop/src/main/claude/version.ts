/** The oldest Claude Code the app's flags were tested with, on 2026-10-10. */
export const MIN_VERSION = '2.1.270';

/** What the installed Claude Code's version means for the app. */
export type VersionCheck =
  | { status: 'ok'; version: string }
  | { status: 'too-old'; version: string }
  | { status: 'unreadable' };

// The version comes first, as in "2.1.296 (Claude Code)".
const LEADING_VERSION = /^\d+\.\d+\.\d+\b/;

/** Reads `claude --version` output. Claude Code updates itself, so check it at every launch. */
export function checkVersion(output: string): VersionCheck {
  const version = LEADING_VERSION.exec(output.trim())?.[0];
  if (version === undefined) return { status: 'unreadable' };
  return { status: isAtLeast(version, MIN_VERSION) ? 'ok' : 'too-old', version };
}

/** Compares each part as a number, so 2.1.1000 is newer than 2.1.270. */
function isAtLeast(version: string, minimum: string): boolean {
  const parts = version.split('.').map(Number);
  for (const [index, required] of minimum.split('.').map(Number).entries()) {
    const part = parts[index] ?? 0;
    if (part !== required) return part > required;
  }
  return true;
}
