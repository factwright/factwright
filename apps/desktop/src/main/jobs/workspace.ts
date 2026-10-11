import { type FSWatcher, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { WorkspaceEntry, WorkspaceReader } from '@factwright/core';

/** The workspace: the folder Claude reads and writes, inside the app's data folder. */
export function workspaceDir(dataDir: string): string {
  return join(dataDir, 'workspace');
}

/** A path inside the workspace, or null for one that would lead out of it. */
function inside(root: string, path: string): string | null {
  const base = resolve(root);
  const full = resolve(base, path);
  return full === base || full.startsWith(base + sep) ? full : null;
}

/** Reads the workspace folder on disk. Links are skipped, so reading stays inside it. */
export function diskWorkspace(root: string): WorkspaceReader {
  return {
    readText(path) {
      const file = inside(root, path);
      if (!file) return null;
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    },
    list(path) {
      const folder = inside(root, path);
      if (!folder) return [];
      try {
        return readdirSync(folder, { withFileTypes: true }).flatMap((entry): WorkspaceEntry[] => {
          if (!entry.isFile() && !entry.isDirectory()) return [];
          const stats = statSync(join(folder, entry.name));
          return [
            {
              name: entry.name,
              folder: entry.isDirectory(),
              size: stats.size,
              modified: stats.mtime.toISOString(),
            },
          ];
        });
      } catch {
        return [];
      }
    },
  };
}

/**
 * Calls back whenever something in the workspace changes, once things go quiet for a moment,
 * so a skill saving several files means one call. Returns a function that stops watching.
 */
export function watchWorkspace(root: string, onChange: () => void, quietMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, quietMs);
    });
  } catch {
    return () => {};
  }
  // The folder can go away under the watcher, such as when the user deletes it.
  watcher.on('error', () => watcher.close());
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
