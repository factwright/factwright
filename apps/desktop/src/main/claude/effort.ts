import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_EFFORT, type EffortChoices, parseEffort } from '../../shared/effort.ts';
import { saveJson } from './save.ts';

/** The file that holds how hard Claude thinks, in the app's data folder. */
const FILE = 'claude-effort.json';

/** What the user chose, or each task's recommended level when they haven't, or it won't read. */
export async function loadEffort(dataDir: string): Promise<EffortChoices> {
  try {
    return parseEffort(JSON.parse(await readFile(join(dataDir, FILE), 'utf8'))) ?? DEFAULT_EFFORT;
  } catch {
    return DEFAULT_EFFORT;
  }
}

/** Saves what the user chose, whole or not at all. */
export const saveEffort = (dataDir: string, choices: EffortChoices): Promise<void> =>
  saveJson(join(dataDir, FILE), choices);
