import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_MODELS, type ModelChoices, parseModels } from '../../shared/models.ts';

/** The file that holds which model Claude runs on, in the app's data folder. */
const FILE = 'claude-models.json';

/**
 * Marks a file saved since models could be recommended for everything, so Opus in it is the
 * user's own choice.
 */
const VERSION = 2;

/**
 * Files saved before that always name a model for everything: Opus was the default, with no
 * recommended to go back to. So Opus there reads as recommended, which follows the plan, while
 * Sonnet or Haiku stays the user's choice.
 */
function fromOlder(saved: unknown): unknown {
  if (typeof saved !== 'object' || saved === null || 'version' in saved) return saved;
  const older = saved as Record<string, unknown>;
  return older.main === 'opus' ? { ...older, main: null } : older;
}

/**
 * What the user chose, or each task's recommended model when they haven't, or the file won't
 * read.
 */
export async function loadModels(dataDir: string): Promise<ModelChoices> {
  try {
    const saved: unknown = JSON.parse(await readFile(join(dataDir, FILE), 'utf8'));
    return parseModels(fromOlder(saved)) ?? DEFAULT_MODELS;
  } catch {
    return DEFAULT_MODELS;
  }
}

/** Saves what the user chose, whole or not at all. */
export async function saveModels(dataDir: string, choices: ModelChoices): Promise<void> {
  const file = join(dataDir, FILE);
  const draft = `${file}.${process.pid}.tmp`;
  await writeFile(draft, `${JSON.stringify({ version: VERSION, ...choices }, null, 2)}\n`);
  await rename(draft, file);
}
