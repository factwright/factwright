import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shownText } from '@factwright/engine';
import { BEYOND_FILE, readProjects } from '../../shared/beyond.ts';

/** The names of the projects the user keeps private, from Beyond work's file, or none. */
export async function privateProjects(workspace: string): Promise<string[]> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(workspace, ...BEYOND_FILE.split('/')), 'utf8'));
  } catch {
    return [];
  }
  const fields =
    typeof value === 'object' && value !== null ? (value as { projects?: unknown }) : {};
  return (readProjects(fields.projects) ?? [])
    .filter((project) => project.showing === 'private')
    .map((project) => project.name.trim())
    .filter(Boolean);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The private projects a resume, letter or page names, by their names as whole words in any case,
 * each as a problem to fix: the user keeps them off everything they send. What the document
 * never shows, such as its notes, doesn't count.
 */
export function privateProblems(document: unknown, names: readonly string[], what: string) {
  const text = shownText(document).join('\n');
  return names
    .filter((name) =>
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text),
    )
    .map(
      (name) =>
        `“${name}” is a project the user keeps private, and it’s in the ${what}. Take it out: they keep it off everything they send.`,
    );
}
