import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { JOB_EXTRAS, SHOT_TYPES, shotsFolder } from '@factwright/core';
import { LIMITS } from '@factwright/sync';
import type { ShotFor, ShotResult } from '../../shared/api.ts';
import { checkUpload } from '../about/uploads.ts';

/** A job's ID, as the app makes them, which names its folder of screenshots. */
const JOB_ID = /^[a-z0-9][a-z0-9-]{0,199}$/;

const REFUSED = 'That screenshot couldn’t be saved. Try again.';

/** A name for a new screenshot, saying what it was added with, numbered to be unique. */
export function shotName(
  purpose: ShotFor,
  extension: string,
  at: { today: string; time: string },
  taken: readonly string[],
): string {
  const stem =
    purpose.kind === 'form'
      ? `form-${at.today}`
      : purpose.kind === 'ask'
        ? `ask-${purpose.ask}`
        : `pasted-${at.today}-${at.time}`;
  let n = 1;
  while (taken.includes(`${stem}-${n}.${extension}`)) n++;
  return `${stem}-${n}.${extension}`;
}

/**
 * Saves a screenshot the user added: for a job, in its own folder of screenshots, or with no job
 * when pasted into Claude's panel outside one. It's checked like any shared picture: a type
 * Claude reads, the size sync carries, and bytes that are what the name says.
 */
export async function saveShot(
  workspace: string,
  jobId: string | null,
  upload: unknown,
  purpose: ShotFor,
  at: { today: string; time: string },
): Promise<ShotResult> {
  if (jobId !== null && !JOB_ID.test(jobId)) return { ok: false, message: REFUSED };
  const fields = typeof upload === 'object' && upload !== null ? upload : {};
  const checked = checkUpload({ ...fields, kind: 'screenshot', text: null });
  if ('problem' in checked) return { ok: false, message: checked.problem };
  const folder = jobId ? shotsFolder(jobId) : JOB_EXTRAS.screenshots;
  const full = join(workspace, ...folder.split('/'));
  await mkdir(full, { recursive: true });
  // Two saved at once could pick the same number, so the second takes the next.
  for (let tries = 0; tries < 5; tries++) {
    const name = shotName(purpose, checked.extension, at, await readdir(full));
    try {
      await writeFile(join(full, name), checked.bytes, { flag: 'wx' });
      return { ok: true, path: `${folder}/${name}` };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  return { ok: false, message: REFUSED };
}

/**
 * The file a screenshot's workspace path names, or null for anything else: a picture in the
 * screenshots folder, never a path that leads out of it.
 */
export function shotFile(workspace: string, path: unknown): string | null {
  if (typeof path !== 'string' || path.length > 500 || !SHOT_TYPES.test(path)) return null;
  const base = resolve(workspace, JOB_EXTRAS.screenshots);
  const file = resolve(workspace, path);
  return file.startsWith(base + sep) ? file : null;
}

/** A screenshot's bytes, to show it in the window. */
export async function readShot(workspace: string, path: unknown): Promise<Uint8Array | null> {
  const file = shotFile(workspace, path);
  if (!file) return null;
  try {
    if ((await stat(file)).size > LIMITS.fileBytes) return null;
    return new Uint8Array(await readFile(file));
  } catch {
    return null;
  }
}
