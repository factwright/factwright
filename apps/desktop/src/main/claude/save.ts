import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

/** The newest save of each file, which the next one waits for. */
const saving = new Map<string, Promise<void>>();

/**
 * Saves one of Claude's settings files as JSON, whole or not at all. Saves of one file take turns,
 * so when two are asked for at once, such as two quick changes in Claude settings, the last one
 * asked for is the one kept.
 */
export function saveJson(file: string, value: unknown): Promise<void> {
  const before = saving.get(file) ?? Promise.resolve();
  const save = before.catch(() => {}).then(() => write(file, value));
  saving.set(file, save);
  return save;
}

async function write(file: string, value: unknown): Promise<void> {
  const draft = `${file}.${randomUUID()}.tmp`;
  await writeFile(draft, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await rename(draft, file);
  } catch (error) {
    await rm(draft, { force: true });
    throw error;
  }
}
