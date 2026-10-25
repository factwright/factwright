import { randomUUID } from 'node:crypto';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  addClaim,
  factBlocks,
  findBlock,
  GAPS_FILE,
  hasGap,
  leavesCodeOpen,
  type NewGap,
  newGapsFile,
  UNCONFIRMED,
  withGap,
  withoutGap,
} from '@factwright/core';
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
  type GapTarget,
  inFactOrder,
  isFactPath,
  type NewFact,
  RUNS_ON,
  stopped,
  withChange,
  withClaim,
  withConfirmed,
  withoutClaim,
} from '../../shared/facts.ts';
import { markdownUnder } from './status.ts';

const GONE = 'That file isn’t in your fact bank anymore.';

/** Where the fact bank keeps work outside a job, which a fact from an answer can start. */
const PROJECTS = 'facts/projects.md';

/** What a file's confirmed claims say, with how many times each is there. */
function confirmedIn(file: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of factBlocks(file)) {
    if (!block.tags || block.tags.includes(UNCONFIRMED)) continue;
    const text = block.text.trimEnd();
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return counts;
}

/**
 * Whether every confirmed claim in a file is still there, word for word, in its new text, but
 * for one that may change, such as a correction the user gave.
 */
export function keepsConfirmed(
  before: string,
  after: string,
  changing: string | null = null,
): boolean {
  const kept = confirmedIn(after);
  const was = confirmedIn(before);
  if (changing !== null) {
    const claim = changing.trimEnd();
    was.set(claim, (was.get(claim) ?? 1) - 1);
  }
  for (const [claim, count] of was) {
    if ((kept.get(claim) ?? 0) < count) return false;
  }
  return true;
}

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
    return this.edit(target.path, (file, kind) => withConfirmed(file, kind, target, source), {
      keepConfirmed: true,
    });
  }

  /**
   * Files a claim from the user's answers in a run: after a file's last claim, or the last in a
   * section, such as a role's, or in place of one that still waits to be verified. A confirmed
   * claim is never changed or deleted. A file of projects is started when there's none, with the
   * claim in it.
   */
  fileClaim(
    path: string,
    text: string,
    replacing: FactTarget | null = null,
    section: string | null = null,
  ): FactResult {
    if (path === PROJECTS && !replacing && this.file(path) === null && !this.exists(path)) {
      return this.create(path, addClaim('# Projects\n', text, section));
    }
    return this.edit(
      path,
      (file, kind) => {
        if (!replacing) return withClaim(file, kind, text, section);
        const block = findBlock(factBlocks(file), replacing);
        if (!block) return { problem: CHANGED_SINCE };
        if (!block.tags?.includes(UNCONFIRMED)) {
          return { problem: 'Only a fact that waits to be verified can be replaced.' };
        }
        // A code block it never closes runs on over the facts after it, which would go with it.
        if (leavesCodeOpen(block.text)) return { problem: RUNS_ON };
        return withChange(file, kind, { ...replacing, next: text });
      },
      { keepConfirmed: true },
    );
  }

  /**
   * Puts a correction the user gave for a verified claim in its place: verified still, and every
   * other confirmed claim in the file word for word as it was.
   */
  correct(target: FactTarget, text: string): FactResult {
    return this.edit(
      target.path,
      (file, kind) => {
        const block = findBlock(factBlocks(file), target);
        if (!block) return { problem: CHANGED_SINCE };
        if (!block.tags || block.tags.includes(UNCONFIRMED)) {
          return { problem: 'Only a verified fact can be corrected this way.' };
        }
        if (leavesCodeOpen(block.text)) return { problem: RUNS_ON };
        const [next, ...more] = factBlocks(text);
        if (!next?.tags || next.tags.includes(UNCONFIRMED) || more.length > 0) {
          return { problem: 'A correction is one verified fact.' };
        }
        return withChange(file, kind, { ...target, next: text });
      },
      { keepConfirmed: true, changing: target.text },
    );
  }

  /**
   * Notes something the user said they don't have, as a row of gaps.md's Doesn't have section,
   * starting the file when there's none. A topic it has already stays as it is.
   */
  addGap(gap: NewGap): FactResult & { added?: boolean } {
    if (this.file(GAPS_FILE) === null && !this.exists(GAPS_FILE)) {
      const made = this.create(GAPS_FILE, newGapsFile(gap));
      return made.ok ? { ...made, added: true } : made;
    }
    let added = false;
    const result = this.edit(
      GAPS_FILE,
      (file) => {
        if (hasGap(file, gap.topic)) return file;
        added = true;
        return withGap(file, gap);
      },
      { keepConfirmed: true },
    );
    return result.ok ? { ...result, added } : result;
  }

  /** Takes back something the user said they don't have, if it reads as the window last saw it. */
  removeGap(target: GapTarget): FactResult {
    return this.edit(GAPS_FILE, (file) => withoutGap(file, target) ?? { problem: CHANGED_SINCE });
  }

  /**
   * Reads a fact bank file, changes it, and saves it whole, answering with the bank as it is
   * then. Just before saving, it reads the file once more: a change made meanwhile, such as by
   * Claude, is never written over. With `keepConfirmed`, a change to any confirmed claim is
   * refused, whatever made it, but for the one `changing` names.
   */
  private edit(
    path: string,
    apply: (file: string, kind: FactFileKind) => FactEdit,
    {
      keepConfirmed: keep = false,
      changing = null,
    }: { keepConfirmed?: boolean; changing?: string | null } = {},
  ): FactResult {
    const full = this.file(path);
    const file = full === null ? null : this.readText(full);
    if (full === null || typeof file !== 'string') return { ok: false, message: GONE };
    const next = apply(file, factFileKind(path));
    if (typeof next !== 'string') return stopped(next.problem);
    if (keep && !keepsConfirmed(file, next, changing)) {
      return stopped('That would change a confirmed fact, which only you can do.');
    }
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

  /** Whether anything is at a path in facts/, even a link, which a new file mustn't take the place of. */
  private exists(path: string): boolean {
    try {
      lstatSync(join(this.deps.workspace, ...path.split('/')));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Starts a file directly in facts/ that isn't there yet, whole or not at all, and never in
   * place of anything: facts/ itself must be a folder in the workspace, not a link.
   */
  private create(path: string, text: string): FactResult {
    const parts = path.split('/');
    if (!isFactPath(path) || parts.length !== 2) return { ok: false, message: GONE };
    const folder = join(this.deps.workspace, 'facts');
    try {
      mkdirSync(folder, { recursive: true });
      if (!lstatSync(folder).isDirectory()) return { ok: false, message: GONE };
      if (realpathSync(folder) !== join(realpathSync(this.deps.workspace), 'facts')) {
        return { ok: false, message: GONE };
      }
    } catch {
      return stopped('That couldn’t be saved. Try again in a moment.');
    }
    const full = join(folder, parts[1] ?? '');
    const temporary = join(folder, `.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, text, 'utf8');
      // A link to the finished file fails if anything took the name meanwhile, unlike a rename.
      linkSync(temporary, full);
    } catch {
      return this.exists(path)
        ? stopped(CHANGED_SINCE)
        : stopped('That couldn’t be saved. Try again in a moment.');
    } finally {
      rmSync(temporary, { force: true });
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
