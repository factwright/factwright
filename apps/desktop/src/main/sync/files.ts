import { randomUUID } from 'node:crypto';
import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type Bytes, isSyncPath, LIMITS } from '@factwright/sync';

/** A file in the workspace, as sync sees it on disk. */
export interface LocalFile {
  /** Where it is in the workspace, with "/" between folders. */
  path: string;
  size: number;
  /** When it last changed, in whole milliseconds. */
  mtime: number;
}

/** A file that stays on this computer, and why. */
export interface SkippedFile {
  path: string;
  reason: 'too-big' | 'name';
}

/** Files that belong to other tools, or are only on their way to being saved. */
const JUNK = /^(\.ds_store|thumbs\.db|desktop\.ini|~\$.*|\.~lock\..*#|.*\.(tmp|swp|crdownload))$/i;

/** Sync's own half-written files, renamed into place once they're whole. */
const PARTIAL = '.factwright-sync-';

/** A path inside the workspace, or null for one that would lead out of it. */
function inside(root: string, path: string): string | null {
  if (!isSyncPath(path)) return null;
  const base = resolve(root);
  const full = resolve(base, ...path.split('/'));
  return full.startsWith(base + sep) ? full : null;
}

/**
 * Every file in the workspace that syncs. Hidden files and folders, links, and other tools'
 * temporary files stay put, as do files too big to sync, or with a name another computer can't
 * hold. Those come back as skipped, to say so.
 */
export function listSyncFiles(root: string): { files: LocalFile[]; skipped: SkippedFile[] } {
  const files: LocalFile[] = [];
  const skipped: SkippedFile[] = [];
  const walk = (folder: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || JUNK.test(entry.name)) continue;
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      if (!entry.isFile()) continue;
      const path = relative(root, full).split(sep).join('/');
      const stats = statSync(full);
      if (!isSyncPath(path)) skipped.push({ path, reason: 'name' });
      else if (stats.size > LIMITS.fileBytes) skipped.push({ path, reason: 'too-big' });
      else files.push({ path, size: stats.size, mtime: Math.floor(stats.mtimeMs) });
    }
  };
  walk(resolve(root));
  return { files, skipped };
}

/** A file's size and time on disk, or null when it isn't there. */
export function statSyncFile(root: string, path: string): LocalFile | null {
  const full = inside(root, path);
  if (!full) return null;
  try {
    const stats = statSync(full);
    return stats.isFile() ? { path, size: stats.size, mtime: Math.floor(stats.mtimeMs) } : null;
  } catch {
    return null;
  }
}

export function readSyncFile(root: string, path: string): Bytes | null {
  const full = inside(root, path);
  if (!full) return null;
  try {
    return new Uint8Array(readFileSync(full));
  } catch {
    return null;
  }
}

/**
 * Writes a file another device synced, whole: to a hidden file first, then moved into place,
 * so nothing reads half of it. It gets the time it last changed on that device.
 */
export function writeSyncFile(
  root: string,
  path: string,
  contents: Bytes,
  modified: Date,
): LocalFile {
  const full = inside(root, path);
  if (!full) throw new Error(`Refused to write outside the workspace: ${path}`);
  mkdirSync(dirname(full), { recursive: true });
  const partial = join(dirname(full), `${PARTIAL}${randomUUID()}`);
  try {
    writeFileSync(partial, contents);
    utimesSync(partial, modified, modified);
    renameSync(partial, full);
  } finally {
    rmSync(partial, { force: true });
  }
  return statSyncFile(root, path) ?? { path, size: contents.length, mtime: modified.getTime() };
}

/** Removes a file another device deleted, and any folders it leaves empty. */
export function removeSyncFile(root: string, path: string): void {
  const full = inside(root, path);
  if (!full) return;
  rmSync(full, { force: true });
  const base = resolve(root);
  for (let folder = dirname(full); folder.startsWith(base + sep); folder = dirname(folder)) {
    try {
      rmdirSync(folder);
    } catch {
      break;
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Where to keep this computer's copy of a file another device changed at the same time, such
 * as "notes (Sam’s MacBook Pro, Oct 12).md" beside "notes.md". A number keeps it unique.
 */
export function conflictCopyPath(root: string, path: string, device: string, when: Date): string {
  const slash = path.lastIndexOf('/');
  const folder = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  const label = `${device}, ${MONTHS[when.getMonth()]} ${when.getDate()}`;
  for (let n = 1; ; n++) {
    const candidate = `${folder}${stem} (${label}${n > 1 ? ` ${n}` : ''})${extension}`;
    const full = inside(root, candidate);
    if (full && !existsSync(full)) return candidate;
    if (!full) return `${folder}${stem} (conflict ${n})${extension}`;
  }
}
