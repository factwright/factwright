import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_MODELS, type ModelChoices, parseModels } from '../../shared/models.ts';
import { saveJson } from './save.ts';

/** The file that holds which model Claude runs on, in the app's data folder. */
const FILE = 'claude-models.json';

/**
 * Marks a file saved since models could be recommended for everything, so Opus in it is the
 * user's own choice.
 */
const VERSION = 2;

/** What 0.1's "Use Sonnet for those" button, for Pro plans, put on Sonnet. */
const PRO_BUTTON = ['fit-check', 'salary-check', 'job-search', 'who-to-message'];

/**
 * Files saved before that always name a model for everything: Opus was the default, with no
 * recommended to go back to. So Opus there reads as recommended, which follows the plan, while
 * Sonnet or Haiku stays the user's choice. Those four tasks on Sonnet, as the old button for Pro
 * plans left them, read as recommended too, which now does the same on Pro and follows the plan
 * when it changes.
 */
function fromOlder(saved: unknown): unknown {
  if (typeof saved !== 'object' || saved === null || 'version' in saved) return saved;
  const older = saved as { main?: unknown; tasks?: unknown };
  if (older.main !== 'opus') return older;
  const picks =
    typeof older.tasks === 'object' && older.tasks !== null ? Object.entries(older.tasks) : [];
  const button = PRO_BUTTON.every((task) =>
    picks.some(([each, model]) => each === task && model === 'sonnet'),
  );
  const tasks = button
    ? Object.fromEntries(picks.filter(([task]) => !PRO_BUTTON.includes(task)))
    : older.tasks;
  return { ...older, main: null, tasks };
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
export const saveModels = (dataDir: string, choices: ModelChoices): Promise<void> =>
  saveJson(join(dataDir, FILE), { version: VERSION, ...choices });
