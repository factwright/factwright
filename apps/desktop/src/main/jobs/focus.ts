import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FOCUS_ID, focusFile, readFocus, type SearchFocus } from '@factwright/core';

/** What a focus holds, by name, so one from the window holds nothing else. */
const FIELDS = new Set(
  Object.keys({
    stages: 0,
    payMin: 0,
    payMax: 0,
    workplaces: 0,
    industries: 0,
    avoid: 0,
    posted: 0,
    notes: 0,
  } satisfies Record<keyof SearchFocus, 0>),
);

/** A focus the window sent: one that reads, with nothing it doesn't know. Anything else is null. */
export function parseFocus(value: unknown): SearchFocus | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!Object.keys(value).every((key) => FIELDS.has(key))) return null;
  return readFocus(value);
}

const fileOf = (workspace: string, id: string) => join(workspace, ...focusFile(id).split('/'));

/**
 * Keeps a focus for one job search in the workspace, where the search reads it with
 * search_focus and the app names the search by it, and says its ID: today's date and four hex
 * digits. A focus is a few hundred bytes, written at once, and never over another one.
 */
export function saveFocus(workspace: string, focus: SearchFocus, today: string): string {
  const text = `${JSON.stringify(focus, null, 2)}\n`;
  for (;;) {
    const id = `${today}-${randomBytes(2).toString('hex')}`;
    const file = fileOf(workspace, id);
    mkdirSync(dirname(file), { recursive: true });
    try {
      writeFileSync(file, text, { flag: 'wx' });
      return id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Whether the workspace keeps a focus by this ID. */
export const hasFocus = (workspace: string, id: string) =>
  FOCUS_ID.test(id) && existsSync(fileOf(workspace, id));
