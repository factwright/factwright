import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AT_ONCE, atOnceFrom } from '../../shared/runs.ts';
import { saveJson, settled } from './save.ts';

/** The file that holds how many of Claude's runs may go at once, in the app's data folder. */
const FILE = 'claude-runs.json';

/** How many runs may go at once, as the user chose, or three when they haven't, or it won't read. */
export async function loadAtOnce(dataDir: string): Promise<number> {
  try {
    await settled(join(dataDir, FILE));
    const saved: unknown = JSON.parse(await readFile(join(dataDir, FILE), 'utf8'));
    const count =
      typeof saved === 'object' && saved !== null
        ? (saved as Record<string, unknown>).atOnce
        : null;
    return atOnceFrom(count) ?? AT_ONCE.usual;
  } catch {
    return AT_ONCE.usual;
  }
}

/** Saves how many runs may go at once, whole or not at all. */
export const saveAtOnce = (dataDir: string, count: number): Promise<void> =>
  saveJson(join(dataDir, FILE), { atOnce: count });
