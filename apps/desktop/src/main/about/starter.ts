import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * Copies the starter files a new workspace needs into it: the binding rules, the writing guide,
 * the resume styles and the fact bank's format, from the plugin's starter folder. A file that's
 * already there stays as it is, so nothing the user or Claude has changed is ever replaced.
 * Returns the paths it added.
 */
export function copyStarter(starterDir: string, workspace: string): string[] {
  const added: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const from = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(from);
        continue;
      }
      // The starter folder's own README explains the folder, and isn't a starter file.
      if (!entry.isFile() || (entry.name === 'README.md' && dir === starterDir)) continue;
      const path = relative(starterDir, from);
      const to = join(workspace, path);
      if (exists(to)) continue;
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      added.push(path.split(sep).join('/'));
    }
  };
  walk(starterDir);
  return added.sort();
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
