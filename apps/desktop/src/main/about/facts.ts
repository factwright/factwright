import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CHANGED_SINCE,
  FACT_LIMITS,
  type FactBank,
  type FactChange,
  type FactEdit,
  type FactFile,
  type FactFileKind,
  type FactResult,
  type FactTarget,
  factFile,
  factFileKind,
  firstNameOf,
  inFactOrder,
  isFactPath,
  type NewFact,
  stopped,
  withChange,
  withClaim,
  withConfirmed,
  withoutClaim,
} from '../../shared/facts.ts';
import { markdownUnder } from './status.ts';

const GONE = 'That file isn’t in your fact bank anymore.';

export interface FactBankDeps {
  workspace: string;
  /** The user's name, as they gave it in About you. */
  name: () => string;
  /** Today, as YYYY-MM-DD, on the user's computer. */
  today: () => string;
}

/**
 * The fact bank's files in the workspace, for the window to read and change. A change is to one
 * block, a claim or a section, as the window last read it: one that changed since, such as by
 * Claude or another computer, is refused rather than overwritten. Only Markdown files already in
 * facts/ are changed, each one whole or not at all, and never through a link.
 */
export class FactBankFiles {
  private readonly deps: FactBankDeps;

  constructor(deps: FactBankDeps) {
    this.deps = deps;
  }

  read(): FactBank {
    const files: FactFile[] = [];
    const skipped: FactBank['skipped'] = [];
    const listed = markdownUnder(this.deps.workspace, 'facts');
    for (const path of inFactOrder(listed)) {
      if (files.length >= FACT_LIMITS.files) {
        skipped.push({ path, why: 'many' });
        continue;
      }
      const full = this.file(path, listed);
      if (full === null) {
        skipped.push({ path, why: isFactPath(path) ? 'unreadable' : 'name' });
        continue;
      }
      const text = this.readText(full);
      if (typeof text === 'string') files.push(factFile(path, text));
      else skipped.push({ path, why: text.why });
    }
    return { files, skipped, firstName: firstNameOf(this.deps.name()) };
  }

  /** Gives a claim or a section new text. */
  change(change: FactChange): FactResult {
    return this.edit(change.path, (file, kind) => withChange(file, kind, change));
  }

  /** Adds a claim to a file of claims, after its last one. */
  add({ path, text }: NewFact): FactResult {
    return this.edit(path, (file, kind) => withClaim(file, kind, text));
  }

  /** Deletes a claim. */
  remove(target: FactTarget): FactResult {
    return this.edit(target.path, (file, kind) => withoutClaim(file, kind, target));
  }

  /** Confirms a claim drafted from the user's files, with them as its source and today's date. */
  confirm(target: FactTarget): FactResult {
    const source = `${firstNameOf(this.deps.name()) ?? 'confirmed'} ${this.deps.today()}`;
    return this.edit(target.path, (file, kind) => withConfirmed(file, kind, target, source));
  }

  /**
   * Reads a fact bank file, changes it, and saves it whole, answering with the bank as it is
   * then. Just before saving, it reads the file once more: a change made meanwhile, such as by
   * Claude, is never written over.
   */
  private edit(path: string, apply: (file: string, kind: FactFileKind) => FactEdit): FactResult {
    const full = this.file(path);
    const file = full === null ? null : this.readText(full);
    if (full === null || typeof file !== 'string') return { ok: false, message: GONE };
    const next = apply(file, factFileKind(path));
    if (typeof next !== 'string') return stopped(next.problem);
    if (Buffer.byteLength(next, 'utf8') > FACT_LIMITS.file) {
      return stopped('That file would get too big.');
    }
    if (next !== file) {
      if (this.readText(full) !== file) return stopped(CHANGED_SINCE);
      try {
        this.write(full, next);
      } catch {
        return stopped('That couldn’t be saved. Try again in a moment.');
      }
    }
    return { ok: true, bank: this.read() };
  }

  /**
   * The file a path names, when it's one the app may read and change: a Markdown file already in
   * facts/, named exactly as the folder lists it, so a name in other letters can't reach it as
   * another kind of file, and with no link along the way, which could lead outside the workspace.
   */
  private file(path: string, listed = markdownUnder(this.deps.workspace, 'facts')): string | null {
    if (!isFactPath(path) || !listed.includes(path)) return null;
    const parts = path.split('/');
    const full = join(this.deps.workspace, ...parts);
    try {
      if (!lstatSync(full).isFile()) return null;
      return realpathSync(full) === join(realpathSync(this.deps.workspace), ...parts) ? full : null;
    } catch {
      return null;
    }
  }

  /** A file's text, or why it can't be shown: too big, or it can't be read. */
  private readText(full: string): string | { why: 'big' | 'unreadable' } {
    try {
      if (lstatSync(full).size > FACT_LIMITS.file) return { why: 'big' };
      return readFileSync(full, 'utf8');
    } catch {
      return { why: 'unreadable' };
    }
  }

  /** Saves a file whole or not at all: a half-written fact bank file never shows. */
  private write(full: string, text: string): void {
    const temporary = join(dirname(full), `.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, text, 'utf8');
      renameSync(temporary, full);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
