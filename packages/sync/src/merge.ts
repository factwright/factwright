import type { RowValue, RowValues } from './record.ts';

/** How a table's columns merge when two devices change the same row. */
export interface MergeRules {
  /**
   * Columns holding a JSON list, such as a job's links. Items either device added are kept,
   * and items either device removed stay removed. Each item is matched by its key.
   */
  lists?: Readonly<Record<string, (item: unknown) => string>>;
  /** Columns of free text, such as notes. When both change, both texts are kept. */
  texts?: readonly string[];
  /** The column holding when the row last changed. Of two changes, the later one wins. */
  stamp?: string;
  /**
   * Rows that never merge column by column, such as a computer's claim on a job: of two changes,
   * the other device's, which the server took first, stands whole.
   */
  whole?: boolean;
}

const cell = (row: RowValues | null, column: string): RowValue => row?.[column] ?? null;

const isBlank = (value: RowValue) => value === null || value === '';

/** Whether two rows say the same thing, leaving out columns such as when they last changed. */
export function sameRow(a: RowValues, b: RowValues, ignore: readonly string[] = []): boolean {
  const columns = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...columns].every(
    (column) => ignore.includes(column) || cell(a, column) === cell(b, column),
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Where a device keeps its copy of a file another device changed at the same time, such as
 * "notes (Sam’s MacBook Pro, Oct 12).md" beside "notes.md". A number keeps it unique, by what
 * `free` says of each name: whether it's free, or null for a name the device can't hold, as with
 * a device's name a file's can't have, which takes "(conflict 1)" and on in its place.
 */
export function conflictCopyPath(
  path: string,
  device: string,
  when: Date,
  free: (candidate: string) => boolean | null,
): string {
  const slash = path.lastIndexOf('/');
  const folder = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  const label = `${device}, ${MONTHS[when.getMonth()]} ${when.getDate()}`;
  for (let n = 1; ; n++) {
    const candidate = `${folder}${stem} (${label}${n > 1 ? ` ${n}` : ''})${extension}`;
    const isFree = free(candidate);
    if (isFree) return candidate;
    if (isFree === null) break;
  }
  for (let n = 1; ; n++) {
    const candidate = `${folder}${stem} (conflict ${n})${extension}`;
    if (free(candidate) !== false) return candidate;
  }
}

/**
 * Keeps both texts when two devices changed the same one. When one already holds the other,
 * such as notes one device only added to, that one is enough.
 */
export function mergeText(mine: string, theirs: string, otherDevice: string): string {
  if (isBlank(mine) || theirs.includes(mine)) return theirs;
  if (isBlank(theirs) || mine.includes(theirs)) return mine;
  return `${mine}\n\nFrom ${otherDevice}:\n${theirs}`;
}

function listOf(value: RowValue): unknown[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Merges two changes to a JSON list, keeping what either added and dropping what either removed. */
function mergeList(
  base: RowValue,
  mine: RowValue,
  theirs: RowValue,
  key: (item: unknown) => string,
): string {
  const baseKeys = new Set(listOf(base).map(key));
  const mineItems = listOf(mine);
  const theirItems = listOf(theirs);
  const mineKeys = new Set(mineItems.map(key));
  const theirKeys = new Set(theirItems.map(key));
  const kept = (item: unknown) => {
    const k = key(item);
    const inMine = mineKeys.has(k);
    const inTheirs = theirKeys.has(k);
    // Kept by both, or added by one: dropped only when the other side removed it.
    return (inMine && inTheirs) || !baseKeys.has(k);
  };
  const merged = mineItems.filter(kept);
  const seen = new Set(merged.map(key));
  for (const item of theirItems) {
    if (!seen.has(key(item)) && kept(item)) {
      merged.push(item);
      seen.add(key(item));
    }
  }
  return JSON.stringify(merged);
}

/**
 * Merges two changes made to the same row: this device's and another's, which the server took
 * first. A column only one side changed takes that change. Where both changed it, lists and
 * texts keep both, the later change wins when the row says when it changed, and otherwise the
 * other device's change stands. With no base, both devices added the row: a blank on one side
 * takes the other's value. A row that's kept whole is the other device's.
 */
export function mergeRows(
  base: RowValues | null,
  mine: RowValues,
  theirs: RowValues,
  rules: MergeRules,
  otherDevice: string,
): RowValues {
  if (rules.whole) return { ...theirs };
  const columns = new Set([...Object.keys(theirs), ...Object.keys(mine)]);
  const stamp = rules.stamp;
  const mineLater =
    stamp !== undefined && String(cell(mine, stamp) ?? '') > String(cell(theirs, stamp) ?? '');
  const merged: RowValues = {};
  for (const column of columns) {
    const b = cell(base, column);
    const m = cell(mine, column);
    const t = cell(theirs, column);
    const listKey = rules.lists?.[column];
    if (m === t) merged[column] = m;
    else if (base && m === b) merged[column] = t;
    else if (base && t === b) merged[column] = m;
    else if (!base && isBlank(m)) merged[column] = t;
    else if (!base && isBlank(t)) merged[column] = m;
    else if (column === stamp) merged[column] = mineLater ? m : t;
    else if (listKey) merged[column] = mergeList(b, m, t, listKey);
    else if (rules.texts?.includes(column)) {
      merged[column] = mergeText(String(m ?? ''), String(t ?? ''), otherDevice);
    } else merged[column] = mineLater ? m : t;
  }
  return merged;
}
