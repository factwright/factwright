import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

/** The newest save of each file, which the next one waits for. */
const saving = new Map<string, Promise<void>>();

/**
 * Settles once the saves of a file asked for so far are done, whether they worked or not. Reading
 * the file after it gets what they saved.
 */
export const settled = (file: string): Promise<void> =>
  (saving.get(file) ?? Promise.resolve()).catch(() => {});

/**
 * Saves one of Claude's settings files as JSON, whole or not at all. Saves of one file take turns,
 * so when two are asked for at once, such as two quick changes in Claude settings, the last one
 * asked for is the one kept.
 */
export function saveJson(file: string, value: unknown): Promise<void> {
  const save = settled(file).then(() => write(file, value));
  saving.set(file, save);
  return save;
}

async function write(file: string, value: unknown): Promise<void> {
  const draft = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(draft, `${JSON.stringify(value, null, 2)}\n`);
    await rename(draft, file);
  } catch (error) {
    // A draft left half written, or not moved into place, goes, and the save's own error stays.
    await rm(draft, { force: true }).catch(() => {});
    throw error;
  }
}
