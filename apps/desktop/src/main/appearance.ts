import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isThemeChoice, SYSTEM_THEME, type ThemeChoice } from '@factwright/ui/themes';
import { saveJson, settled } from './claude/save.ts';

/** The file that holds how the app looks, in the open profile's data folder. */
const FILE = 'appearance.json';

/** The theme the user chose, or following the system when they haven't, or the file won't read. */
export async function loadTheme(dataDir: string): Promise<ThemeChoice> {
  try {
    await settled(join(dataDir, FILE));
    const saved: unknown = JSON.parse(await readFile(join(dataDir, FILE), 'utf8'));
    const theme = (saved as { theme?: unknown } | null)?.theme;
    return isThemeChoice(theme) ? theme : SYSTEM_THEME;
  } catch {
    return SYSTEM_THEME;
  }
}

export const saveTheme = (dataDir: string, theme: ThemeChoice): Promise<void> =>
  saveJson(join(dataDir, FILE), { theme });
