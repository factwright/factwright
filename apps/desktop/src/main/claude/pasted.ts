import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where the workspace keeps long text the user sent their Claude, each in a file of its own, for
 * Claude to read whole. Hidden, so sync leaves it on this computer: Claude has read it by then.
 */
export const PASTED_FOLDER = '.pasted';

/** How long it keeps that text: a week. */
export const KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/** Its files' names: when, to the second, then six letters of their own. */
const NAME = /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}\.md$/;

/** A file's name for text kept at a moment, as "2026-11-06-152000-a1b2c3.md". */
const nameAt = (now: Date) =>
  `${now.toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '')}-${randomBytes(3).toString('hex')}.md`;

/**
 * Text as a file holds it: lines end with a line feed, and nothing in it is a control character
 * but a tab or a line's end, so it reads as text.
 */
const asFile = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: these are what it's there to take out
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

/**
 * Takes away the text the workspace kept more than a week ago, its own files only, as the app
 * starts. A folder that's missing, or is a link, is left alone.
 */
export async function clearPasted(workspace: string, now = Date.now()): Promise<void> {
  const folder = join(workspace, PASTED_FOLDER);
  try {
    if ((await lstat(folder)).isDirectory()) await clearOld(folder, now);
  } catch {
    // Nothing kept yet, or nothing it can read: the next start tries again.
  }
}

/** Takes away the text it kept more than a week ago: its own files only. */
async function clearOld(folder: string, now: number): Promise<void> {
  for (const name of await readdir(folder)) {
    if (!NAME.test(name)) continue;
    const file = join(folder, name);
    try {
      const info = await lstat(file);
      if (info.isFile() && now - info.mtimeMs > KEPT_MS) await rm(file, { force: true });
    } catch {
      // One it can't read or take away waits for the next time.
    }
  }
}

/**
 * Keeps text the user sent their Claude, such as a posting, in a file of its own in the
 * workspace, and says where it is from the workspace, with "/" between folders, as Claude Code
 * takes a path on Windows too. Text kept more than a week ago goes as it does. Null when it
 * can't keep it, as when its folder is a link, which could lead anywhere.
 */
export async function keepPasted(
  workspace: string,
  text: string,
  now = new Date(),
): Promise<string | null> {
  const folder = join(workspace, PASTED_FOLDER);
  try {
    await mkdir(folder, { recursive: true });
    if (!(await lstat(folder)).isDirectory()) return null;
    await clearOld(folder, now.getTime());
    const name = nameAt(now);
    await writeFile(join(folder, name), asFile(text), { flag: 'wx' });
    return `${PASTED_FOLDER}/${name}`;
  } catch {
    return null;
  }
}

/** What's typed for a long reply from a run's bar, kept in a file: where it is, to read it. */
export const replyIn = (path: string) =>
  `My reply is long, so Factwright saved it in ${path}. Read that file: it is my whole reply.`;

/** What goes in Claude Code's box in place of long text pasted into it, kept in a file. */
export const pastedIn = (path: string) => `[I pasted text: it is in ${path}] `;
