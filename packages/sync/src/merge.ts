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
 * takes the other's value.
 */
export function mergeRows(
  base: RowValues | null,
  mine: RowValues,
  theirs: RowValues,
  rules: MergeRules,
  otherDevice: string,
): RowValues {
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
