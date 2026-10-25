import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  type ChangedFile,
  type ChangeView,
  isWorkspacePath,
  lineCounts,
  linesOf,
  MAX_VIEW_TEXT,
  RUN_CHANGES_ID,
  type RunChanges as RunChangesView,
  type UndoResult,
} from '../../shared/run-changes.ts';

/** How many tasks' copies are kept, the newest. */
export const KEPT_RUNS = 20;

/** The biggest file a task's copy is kept of. A bigger one is listed, without Undo. */
const MAX_COPY_BYTES = 25_000_000;
/** As much as one task's copies take, all told. Past it, a file is listed without Undo. */
const MAX_RUN_BYTES = 200_000_000;
/** As many files and pages as one task keeps. */
const MAX_FILES = 1_000;
const MAX_PAGES = 200;

/** Claude Code's tools that change a file, by the field that names it. */
const EDITING_TOOLS: Readonly<Record<string, string>> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
};

/**
 * The file a tool call is about to change, from its PreToolUse hook: Claude's own edits, a
 * subagent's included. Null for any other call.
 */
export function editedPath(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return null;
  const {
    hook_event_name: name,
    tool_name: tool,
    tool_input: input,
  } = event as Record<string, unknown>;
  if (name !== 'PreToolUse' || typeof tool !== 'string' || !Object.hasOwn(EDITING_TOOLS, tool)) {
    return null;
  }
  if (typeof input !== 'object' || input === null) return null;
  const path = (input as Record<string, unknown>)[EDITING_TOOLS[tool] ?? ''];
  return typeof path === 'string' && path.trim() !== '' ? path : null;
}

/**
 * What became of a file a task is about to change: a copy kept, noted as new, changed with no
 * copy to put back (too big, a copy that failed, or a link), or left alone, outside the workspace.
 */
export type KeepResult = 'kept' | 'new' | 'no-copy' | 'ignored';

/**
 * The PreToolUse hook's answer when the app couldn't keep a copy of a file Claude is about to
 * change: Claude Code asks the user first, since Undo couldn't put it back.
 */
export const ASK_WITHOUT_COPY = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason:
      'Factwright couldn’t keep a copy of this file for Undo, such as one too big to copy, so it asks first.',
  },
};

/**
 * Keeps a copy of the file a tool call is about to change, from its PreToolUse hook, and gives
 * the hook's answer: nothing, so the call runs as it would have, or asking the user first when no
 * copy could be kept. Null for a call that changes no file.
 */
export function keepBefore(changes: Pick<TaskChanges, 'keep'>, event: unknown): unknown {
  const path = editedPath(event);
  if (!path) return null;
  try {
    return changes.keep(path) === 'no-copy' ? ASK_WITHOUT_COPY : null;
  } catch {
    return ASK_WITHOUT_COPY;
  }
}

/** One file a task changed, as its record keeps it. */
interface Kept {
  /** Its path in the workspace, with "/" between its parts. */
  path: string;
  /** Whether it was there when the task first changed it. */
  existed: boolean;
  /** Its copy's name in the task's folder, or null: a file it made, or one too big to copy. */
  copy: string | null;
  /** For a file too big to copy, its size and when it last changed, to tell whether it did. */
  size?: number;
  changed?: number;
  /** A hash of the file as it was when the task's last turn ended, or "gone" when it wasn't there. */
  after: string | null;
  /** Changed again since the task's last turn ended, by the task itself. */
  touched: boolean;
  /**
   * Another task, side by side with this one, changed it too after this one kept its copy, so
   * putting the copy back would undo that task's change as well.
   */
  shared?: boolean;
  /** Once the user undid it: what it was, as the list showed it. */
  undone: Pick<ChangedFile, 'change' | 'lines'> | null;
}

/** A task's record, kept beside its copies. */
interface RunRecord {
  id: string;
  started: string;
  files: Kept[];
  pages: string[];
  /** How many more pages it read than the record keeps. */
  morePages?: number;
  /** How many bytes its copies take. */
  bytes: number;
}

const RECORD = 'run.json';
const COPIES = 'files';

const hashOf = (bytes: Buffer | null) =>
  bytes === null ? 'gone' : createHash('sha256').update(bytes).digest('hex');

/** Whether bytes are text: no NUL among their first few thousand, and every one UTF-8. */
function isText(bytes: Buffer): boolean {
  if (bytes.subarray(0, 8_000).includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** A run's ID: when it started, in UTC, to the millisecond, and a few letters of its own. */
function newId(now: Date): string {
  const at = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-');
  return `${at.slice(0, 19)}-${randomBytes(3).toString('hex')}`;
}

export interface RunChangesDeps {
  /** The workspace, whose files a task changes. */
  workspace: string;
  /** Where the copies are kept: a folder of the app's data folder, outside the workspace. */
  folder: string;
  /** Moves a file a task made to the system's trash, when it's undone. Tests delete it instead. */
  trash?: (path: string) => Promise<void>;
  now?: () => Date;
}

/** What one run's tasks change: its task at hand, from its start to each turn's end. */
export interface TaskChanges {
  /** Starts a new task's record, with nothing changed yet. */
  begin(): RunChangesView;
  /** Keeps a copy of a file before the task first changes it, and says what became of it. */
  keep(path: string): KeepResult;
  /** Notes a page the task read, by its address. */
  read(url: string): void;
  /** What the task changed, as it stands once a turn ends, or null before it began. */
  settle(): RunChangesView | null;
  /** The run ended: its task's record stays on file, with the newest tasks', for Undo. */
  end(): void;
}

/**
 * What each of Claude's tasks changes in the workspace, with a copy of each file from before the
 * task first changed it, kept outside the workspace, so Claude can't reach them. Claude's own
 * edits are heard before they happen, from Claude Code's PreToolUse hook, and Factwright's tools
 * say before they write. Once a task's turn ends, its list says what changed, and Undo puts a
 * file back, or a new one in the trash. The newest tasks' copies are kept, and the rest go.
 */
export class RunChanges {
  private readonly workspace: string;
  private readonly folder: string;
  private readonly trash: (path: string) => Promise<void>;
  private readonly now: () => Date;
  /** Each run's task at hand, which what that run changes from now on belongs to. */
  private readonly live = new Set<RunRecord>();

  constructor(deps: RunChangesDeps) {
    this.workspace = resolve(deps.workspace);
    this.folder = deps.folder;
    this.trash = deps.trash ?? (async (path) => rmSync(path, { force: true }));
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * What one run's tasks change, in a record of their own, beside every other run's, so runs side
   * by side each list only what they changed.
   */
  forRun(): TaskChanges {
    let current: RunRecord | null = null;
    return {
      begin: () => {
        if (current) this.live.delete(current);
        current = this.begin(current);
        this.live.add(current);
        return { id: current.id, files: [], pages: [], morePages: 0 };
      },
      keep: (path) => (current ? this.keep(current, path) : 'ignored'),
      read: (url) => {
        if (current) this.read(current, url);
      },
      settle: () => (current ? this.settle(current) : null),
      end: () => {
        if (!current) return;
        this.live.delete(current);
        // A task that changed and read nothing leaves no record, so it takes no other's place.
        if (current.files.length === 0 && current.pages.length === 0) {
          rmSync(join(this.folder, current.id), { recursive: true, force: true });
        }
      },
    };
  }

  /**
   * Starts a new task's record, with nothing changed yet, and lets the oldest tasks' copies go. A
   * task before it in the same run that changed and read nothing leaves no record, so it takes no
   * newer one's place.
   */
  private begin(was: RunRecord | null): RunRecord {
    if (was && was.files.length === 0 && was.pages.length === 0) {
      rmSync(join(this.folder, was.id), { recursive: true, force: true });
    }
    const id = newId(this.now());
    const run: RunRecord = {
      id,
      started: this.now().toISOString(),
      files: [],
      pages: [],
      bytes: 0,
    };
    try {
      mkdirSync(join(this.folder, id, COPIES), { recursive: true });
      this.save(run);
    } catch {
      // Nothing can be kept, so nothing can be undone. The task goes on.
    }
    this.prune(run);
    return run;
  }

  /**
   * Keeps a copy of a file before a run's task first changes it, by its path in full or in the
   * workspace, and says what became of it. A file outside the workspace is left alone. One that
   * isn't there yet is noted as new. One too big to copy is noted with no copy, so nothing can put
   * it back, and one reached through a link, there or not, gets no copy either. A file the user
   * undid that changes again is the task's again, with the copy from before the task.
   */
  private keep(run: RunRecord, path: string): KeepResult {
    const full = resolve(this.workspace, path);
    const inside = this.inside(full);
    if (!inside) return 'ignored';
    this.sharing(run, inside);
    const known = run.files.find((each) => each.path === inside);
    if (known) {
      known.touched = true;
      if (known.undone) {
        known.undone = null;
        this.trySave(run);
      }
      return known.existed && !known.copy ? 'no-copy' : 'kept';
    }
    if (run.files.length >= MAX_FILES) return 'no-copy';
    let found: Stats;
    try {
      found = lstatSync(full);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'no-copy';
      // A new file in a folder that's a link would land wherever the link goes.
      if (!this.reachableUp(full)) return 'no-copy';
      run.files.push({
        path: inside,
        existed: false,
        copy: null,
        after: null,
        touched: true,
        undone: null,
      });
      this.trySave(run);
      return 'new';
    }
    if (found.isDirectory()) return 'ignored';
    if (!found.isFile() || !this.reachable(full)) return 'no-copy';
    let copy: string | null =
      found.size <= MAX_COPY_BYTES && run.bytes + found.size <= MAX_RUN_BYTES
        ? String(run.files.length + 1)
        : null;
    if (copy) {
      try {
        copyFileSync(full, join(this.folder, run.id, COPIES, copy));
        run.bytes += found.size;
      } catch {
        // No copy, such as on a full disk: the file is listed, but nothing can put it back.
        copy = null;
      }
    }
    run.files.push({
      path: inside,
      existed: true,
      copy,
      ...(!copy && { size: found.size, changed: found.mtimeMs }),
      after: null,
      touched: true,
      undone: null,
    });
    this.trySave(run);
    return copy ? 'kept' : 'no-copy';
  }

  /**
   * Notes that a run is about to change a file another run's task at hand has a copy of, so
   * Undo there asks first: the copy would put back what this run changes too.
   */
  private sharing(run: RunRecord, path: string): void {
    for (const other of this.live) {
      if (other === run) continue;
      const kept = other.files.find((each) => each.path === path && !each.undone);
      if (!kept || kept.shared) continue;
      kept.shared = true;
      this.trySave(other);
    }
  }

  /** Notes a page a run's task read, by its address, and counts the ones past what it keeps. */
  private read(run: RunRecord, url: string): void {
    if (run.pages.includes(url)) return;
    if (run.pages.length >= MAX_PAGES) run.morePages = (run.morePages ?? 0) + 1;
    else run.pages.push(url);
    this.trySave(run);
  }

  /**
   * What a run's task changed, once a turn of it ends, with each file as it is then: that's what
   * Undo checks a file against, to tell whether it changed again since.
   */
  private settle(run: RunRecord): RunChangesView {
    for (const each of run.files) {
      if (!each.touched || each.undone) continue;
      each.after = hashOf(this.bytesOf(each.path));
      each.touched = false;
    }
    this.trySave(run);
    return this.view(run);
  }

  /** What a task changed, as it stands now, by its ID. Null for a task the app has no record of. */
  changes(id: string): RunChangesView | null {
    const run = this.load(id);
    return run ? this.view(run) : null;
  }

  /**
   * A changed file of text before and after a task, to look through. Null when the app has no
   * record of the task changing it, or it isn't text, or it's too long to show.
   */
  see(id: string, path: string): ChangeView | null {
    const run = this.load(id);
    const kept = run?.files.find((each) => each.path === path);
    if (!run || !kept || (kept.existed && !kept.copy)) return null;
    const before = kept.copy ? this.copyOf(run, kept) : null;
    const now = this.bytesOf(kept.path);
    if ((kept.copy && before === null) || (before === null && now === null)) return null;
    const text = (bytes: Buffer | null) => {
      if (bytes === null) return null;
      return isText(bytes) ? bytes.toString('utf8') : undefined;
    };
    const was = text(before);
    const is = text(now);
    if (was === undefined || is === undefined) return null;
    if ((was?.length ?? 0) > MAX_VIEW_TEXT || (is?.length ?? 0) > MAX_VIEW_TEXT) return null;
    return { before: was, after: is };
  }

  /**
   * Puts a file a task changed back as it was before the task, from its copy, or moves a file it
   * made to the trash. A file that changed again since the task's last turn ended is left as it
   * is unless `anyway`, so the user decides. Only files in the task's own record, in the
   * workspace, never through a link.
   */
  async undo(id: string, path: string, anyway = false): Promise<UndoResult> {
    const failed = (message: string): UndoResult => ({ ok: false, reason: 'failed', message });
    const run = this.load(id);
    const kept = run?.files.find((each) => each.path === path);
    if (!run || !kept) return failed('Factwright has no copy of that file from Claude’s task.');
    const listed = this.view(run).files.find((each) => each.path === path);
    if (kept.undone || !listed) return { ok: true, changes: this.view(run) };
    if (!listed.canUndo) {
      return failed('That file was too big to keep a copy of, so it can’t be put back.');
    }
    const full = join(this.workspace, ...kept.path.split('/'));
    const now = this.bytesOf(kept.path);
    if (!anyway && kept.shared) {
      return {
        ok: false,
        reason: 'since',
        message:
          'Another of Claude’s tasks changed this file too. Undo puts it back as it was before this task, and what the other task changed is lost.',
      };
    }
    if (!anyway && kept.after !== null && hashOf(now) !== kept.after) {
      return {
        ok: false,
        reason: 'since',
        message:
          'This file changed again after Claude’s task. Undo puts it back as it was before the task, and what changed since is lost.',
      };
    }
    try {
      if (kept.existed) {
        const copy = kept.copy ? this.copyOf(run, kept) : null;
        if (copy === null) return failed('The copy of that file is gone.');
        this.restore(full, copy);
      } else if (now !== null) {
        await this.trash(full);
      }
    } catch {
      return failed('That file couldn’t be put back. Try again in a moment.');
    }
    kept.undone = { change: listed.change, lines: listed.lines };
    kept.after = hashOf(this.bytesOf(kept.path));
    this.trySave(run);
    return { ok: true, changes: this.view(run) };
  }

  /** What a task changed, compared with its copies, leaving out files that ended up as they were. */
  private view(run: RunRecord): RunChangesView {
    const files: ChangedFile[] = [];
    for (const kept of run.files) {
      if (kept.undone) {
        files.push({ path: kept.path, ...kept.undone, canUndo: false, undone: true });
        continue;
      }
      const now = this.bytesOf(kept.path);
      if (!kept.existed) {
        if (now === null) continue;
        const lines = isText(now)
          ? { added: linesOf(now.toString('utf8')).length, removed: 0 }
          : null;
        files.push({ path: kept.path, change: 'new', lines, canUndo: true, undone: false });
        continue;
      }
      if (!kept.copy) {
        const found = this.statOf(kept.path);
        const same = found && found.size === kept.size && found.mtimeMs === kept.changed;
        if (same) continue;
        const change = found ? 'changed' : 'gone';
        files.push({ path: kept.path, change, lines: null, canUndo: false, undone: false });
        continue;
      }
      const before = this.copyOf(run, kept);
      if (before === null || (now !== null && before.equals(now))) continue;
      const text = isText(before) && (now === null || isText(now));
      const lines = text
        ? lineCounts(before.toString('utf8'), now === null ? '' : now.toString('utf8'))
        : null;
      const change = now === null ? 'gone' : 'changed';
      files.push({ path: kept.path, change, lines, canUndo: true, undone: false });
    }
    return { id: run.id, files, pages: [...run.pages], morePages: run.morePages ?? 0 };
  }

  /** A file's path in the workspace, with "/" between its parts, or null when it's elsewhere. */
  private inside(full: string): string | null {
    const path = relative(this.workspace, full);
    if (!path || path.startsWith('..') || isAbsolute(path)) return null;
    const parts = path.split(sep).join('/');
    return isWorkspacePath(parts) ? parts : null;
  }

  /** Whether a path in the workspace is reached with no link along the way, so it stays there. */
  private reachable(full: string): boolean {
    try {
      return (
        realpathSync(full) === join(realpathSync(this.workspace), relative(this.workspace, full))
      );
    } catch {
      return false;
    }
  }

  /**
   * Whether a path that may not be there yet would be reached with no link along the way: the
   * nearest folder above it that is there is reached so, and what isn't there can't be a link.
   */
  private reachableUp(full: string): boolean {
    for (
      let at = dirname(full);
      this.inside(at) !== null || at === this.workspace;
      at = dirname(at)
    ) {
      try {
        lstatSync(at);
      } catch {
        continue;
      }
      return this.reachable(at) || at === this.workspace;
    }
    return false;
  }

  /** A file's bytes as they are now, or null when it isn't there, isn't a file, or is a link. */
  private bytesOf(path: string): Buffer | null {
    const full = join(this.workspace, ...path.split('/'));
    try {
      if (!lstatSync(full).isFile() || !this.reachable(full)) return null;
      return readFileSync(full);
    } catch {
      return null;
    }
  }

  private statOf(path: string) {
    try {
      const found = lstatSync(join(this.workspace, ...path.split('/')));
      return found.isFile() ? found : null;
    } catch {
      return null;
    }
  }

  private copyOf(run: RunRecord, kept: Kept): Buffer | null {
    if (!kept.copy) return null;
    try {
      return readFileSync(join(this.folder, run.id, COPIES, kept.copy));
    } catch {
      return null;
    }
  }

  /**
   * Writes a file back whole, in place of what's there: never half written, and never through a
   * link. Its folder is made again if it's gone, in the workspace.
   */
  private restore(full: string, bytes: Buffer): void {
    const folder = dirname(full);
    if (!this.reachableUp(full)) throw new Error('Its folder leads out of the workspace.');
    mkdirSync(folder, { recursive: true });
    if (!this.reachable(folder)) throw new Error('Its folder leads out of the workspace.');
    try {
      if (!lstatSync(full).isFile()) throw new Error('Something else is in its place.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = join(folder, `.${randomBytes(6).toString('hex')}.undo`);
    try {
      writeFileSync(temporary, bytes, { flag: 'wx' });
      renameSync(temporary, full);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  /** A task's record by its ID, a run's task at hand from memory. */
  private load(id: string): RunRecord | null {
    if (!RUN_CHANGES_ID.test(id)) return null;
    for (const run of this.live) if (run.id === id) return run;
    try {
      const record = JSON.parse(readFileSync(join(this.folder, id, RECORD), 'utf8')) as RunRecord;
      return record.id === id && Array.isArray(record.files) && Array.isArray(record.pages)
        ? record
        : null;
    } catch {
      return null;
    }
  }

  private save(run: RunRecord): void {
    const file = join(this.folder, run.id, RECORD);
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`);
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  /** Saves a record, and goes on without it when it can't, as with a full disk. */
  private trySave(run: RunRecord): void {
    try {
      this.save(run);
    } catch {
      // The copies already kept stay, and the list still shows what changed.
    }
  }

  /** Lets go of every task's copies but the newest, and any run's task at hand. */
  private prune(started: RunRecord): void {
    let ids: string[];
    try {
      ids = readdirSync(this.folder).filter((name) => RUN_CHANGES_ID.test(name));
    } catch {
      return;
    }
    ids.sort();
    const live = new Set([started.id, ...[...this.live].map((run) => run.id)]);
    for (const id of ids.slice(0, Math.max(0, ids.length - KEPT_RUNS))) {
      if (live.has(id)) continue;
      rmSync(join(this.folder, id), { recursive: true, force: true });
    }
  }
}
