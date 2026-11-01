// What a release needs to say about itself, which release-check.ts checks before its installers
// are built, and a test checks on every pull request.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shortNotesProblem } from '../src/shared/whats-new.ts';

/** The notes installed copies show under "What's new" before they update, and GitHub's release. */
export const fullNotesFile = (version: string) => `${version}.md`;

/** The few plain lines the app shows on its first open after an update. */
export const shortNotesFile = (version: string) => `${version}.short.md`;

/** What's missing from a version's notes in a folder of them, in words to act on, or null. */
export function notesProblem(version: string, folder: string): string | null {
  const read = (name: string) =>
    existsSync(join(folder, name)) ? readFileSync(join(folder, name), 'utf8').trim() : '';
  const full = `apps/desktop/release-notes/${fullNotesFile(version)}`;
  if (!read(fullNotesFile(version))) return `Say what's new in ${full} first.`;
  const short = `apps/desktop/release-notes/${shortNotesFile(version)}`;
  const shortNotes = read(shortNotesFile(version));
  if (!shortNotes) return `Say what's new in a few plain lines in ${short} first.`;
  const problem = shortNotesProblem(shortNotes);
  return problem && `${short} won't do. ${problem}`;
}
