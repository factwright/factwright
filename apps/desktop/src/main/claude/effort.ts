import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_EFFORT, type EffortChoices, parseEffort } from '../../shared/effort.ts';

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
export async function saveEffort(dataDir: string, choices: EffortChoices): Promise<void> {
  const file = join(dataDir, FILE);
  const draft = `${file}.${process.pid}.tmp`;
  await writeFile(draft, `${JSON.stringify(choices, null, 2)}\n`);
  await rename(draft, file);
}
