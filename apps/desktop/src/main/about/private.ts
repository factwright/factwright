import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { KeptPrivate } from '@factwright/core';
import { readPrivate } from '../../shared/private.ts';

/**
 * The answers Profile keeps for applications on this computer alone: your street, postal code and
 * equal-opportunity answers, in the profile's data folder, beside the job tracker. They're never
 * in the workspace, so they never sync and Claude's tools never reach them. Only you read the file.
 */
export class PrivateAnswers {
  private readonly file: string;

  /** The file in the profile's data folder (PRIVATE_FILE). */
  constructor(file: string) {
    this.file = file;
  }

  /** What's kept, or nothing told yet. */
  read(): KeptPrivate {
    try {
      return readPrivate(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return readPrivate(null);
    }
  }

  /** Saves changes, and answers with all that's kept. */
  save(changes: Partial<KeptPrivate>): KeptPrivate {
    const next = { ...this.read(), ...changes };
    const draft = join(
      dirname(this.file),
      `.${basename(this.file)}.${randomBytes(4).toString('hex')}.tmp`,
    );
    try {
      writeFileSync(draft, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      renameSync(draft, this.file);
    } finally {
      rmSync(draft, { force: true });
    }
    return next;
  }
}
