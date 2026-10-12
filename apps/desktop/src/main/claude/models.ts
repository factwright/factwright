import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_MODELS, type ModelChoices, parseModels } from '../../shared/models.ts';

/** The file that holds which model Claude runs on, in the app's data folder. */
const FILE = 'claude-models.json';

/** What the user chose, or Opus for everything when they haven't, or the file won't read. */
export async function loadModels(dataDir: string): Promise<ModelChoices> {
  try {
    return parseModels(JSON.parse(await readFile(join(dataDir, FILE), 'utf8'))) ?? DEFAULT_MODELS;
  } catch {
    return DEFAULT_MODELS;
  }
}

/** Saves what the user chose, whole or not at all. */
export async function saveModels(dataDir: string, choices: ModelChoices): Promise<void> {
  const file = join(dataDir, FILE);
  const draft = `${file}.${process.pid}.tmp`;
  await writeFile(draft, `${JSON.stringify(choices, null, 2)}\n`);
  await rename(draft, file);
}
