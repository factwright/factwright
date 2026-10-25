/**
 * What a task of Claude's changed in the user's job hunt, which its card lists once it's done:
 * each file it made or changed, by Claude's own edits or through Factwright's tools, and the pages
 * it read. The app keeps a copy of each file from before the task first changed it, outside the
 * workspace, so Undo can put it back.
 */

/** One file a task made or changed. */
export interface ChangedFile {
  /** Its path in the workspace, such as applications/2026-10-25-acme-staff-engineer/job.md. */
  path: string;
  /** Whether the task made it, changed it, or it's gone since. */
  change: 'new' | 'changed' | 'gone';
  /**
   * The lines it put in and took out, for a file of text, or null for one that isn't text, such
   * as a PDF.
   */
  lines: { added: number; removed: number } | null;
  /**
   * Whether Undo can put it back as it was: a file that was there has its copy, and a new one
   * goes to the trash. A file too big to copy has none.
   */
  canUndo: boolean;
  /** Whether the user undid it. */
  undone: boolean;
}

/** What one task changed, by the ID the app keeps its copies under. */
export interface RunChanges {
  id: string;
  files: ChangedFile[];
  /**
   * The pages it read, by their addresses, in the order it read them: each one a request went
   * to, one that failed or redirected included.
   */
  pages: string[];
  /** How many more pages it read than the list keeps. */
  morePages: number;
}

/** A changed file of text, before and after the task, for the user to look through. */
export interface ChangeView {
  /** What it said before the task, or null for a file the task made. */
  before: string | null;
  /** What it says now, or null when it's gone. */
  after: string | null;
}

/** What came of Undo: what the task changed, as it stands now, or why the file stayed as it is. */
export type UndoResult =
  | { ok: true; changes: RunChanges }
  /** "since": the file changed again after the task, so the user decides. */
  | { ok: false; reason: 'since' | 'failed'; message: string };

/** The longest file, in characters, that View shows, before and after alike. */
export const MAX_VIEW_TEXT = 400_000;

/** One line of a change: the same in both, or only in the text before, or only in the text after. */
export interface DiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

/** The most lines compared one by one, against each other: past it, the middle counts as replaced. */
const MAX_COMPARED = 2_000_000;

/** A text's lines, without their endings. An ending on the last line starts no line of its own. */
export function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * How one text became another, a line at a time: the lines both have, in order, and what was taken
 * out and put in around them. The lines at either end that match are matched first, so a long
 * file with one change is quick. A middle too long to compare line by line is shown as replaced
 * whole.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const same = (lines: readonly string[]): DiffLine[] =>
    lines.map((text) => ({ kind: 'same', text }));
  const head = same(a.slice(0, start));
  const tail = same(a.slice(endA));
  const removed = a.slice(start, endA);
  const added = b.slice(start, endB);
  const n = removed.length;
  const m = added.length;
  if (n === 0 || m === 0 || n * m > MAX_COMPARED) {
    return [
      ...head,
      ...removed.map((text): DiffLine => ({ kind: 'removed', text })),
      ...added.map((text): DiffLine => ({ kind: 'added', text })),
      ...tail,
    ];
  }
  // The longest run of lines both have, in order, counted from the end of each.
  const width = m + 1;
  const longest = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      longest[i * width + j] =
        removed[i] === added[j]
          ? (longest[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(longest[(i + 1) * width + j] ?? 0, longest[i * width + j + 1] ?? 0);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (removed[i] === added[j]) {
      middle.push({ kind: 'same', text: removed[i] ?? '' });
      i++;
      j++;
    } else if ((longest[(i + 1) * width + j] ?? 0) >= (longest[i * width + j + 1] ?? 0)) {
      middle.push({ kind: 'removed', text: removed[i] ?? '' });
      i++;
    } else {
      middle.push({ kind: 'added', text: added[j] ?? '' });
      j++;
    }
  }
  for (; i < n; i++) middle.push({ kind: 'removed', text: removed[i] ?? '' });
  for (; j < m; j++) middle.push({ kind: 'added', text: added[j] ?? '' });
  return [...head, ...middle, ...tail];
}

/** How many lines a change put in and took out. */
export function lineCounts(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lineDiff(before, after)) {
    if (line.kind === 'added') added++;
    else if (line.kind === 'removed') removed++;
  }
  return { added, removed };
}

/** A run's ID, as the app makes them: when it started, sortable, and a few letters of its own. */
export const RUN_CHANGES_ID = /^\d{8}-\d{6}-\d{3}-[0-9a-f]{6}$/;

/** A path in the workspace, as the window can name one: relative, in plain parts, never "..". */
export function isWorkspacePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_000) return false;
  if (value.startsWith('/') || value.includes('\\') || /^[a-z]:/i.test(value)) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
  if (/[\u0000-\u001f]/.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}
