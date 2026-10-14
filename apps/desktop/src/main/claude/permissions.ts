import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ASK_FIRST, type ClaudePermissions, parsePermissions } from '../../shared/permissions.ts';
import { saveJson } from './save.ts';

/**
 * The file that holds what Claude may do without asking. It sits in the app's data folder,
 * beside the workspace rather than in it, so Claude can't change its own permissions.
 */
const FILE = 'claude-permissions.json';

/** What the user chose, or asking first when they haven't chosen, or the file won't read. */
export async function loadPermissions(dataDir: string): Promise<ClaudePermissions> {
  try {
    return parsePermissions(JSON.parse(await readFile(join(dataDir, FILE), 'utf8'))) ?? ASK_FIRST;
  } catch {
    return ASK_FIRST;
  }
}

/** Saves what the user chose, whole or not at all. */
export const savePermissions = (dataDir: string, permissions: ClaudePermissions): Promise<void> =>
  saveJson(join(dataDir, FILE), permissions);
