import { createHash } from 'node:crypto';
import { questionKey } from '@factwright/core';
import { type MergeRules, type RowValues, rowName } from '@factwright/sync';
import type { SyncTable, Tracker } from '../jobs/tracker.ts';
import type { SyncState } from './state.ts';

/**
 * How each tracker table merges when two devices change the same row. A job's links,
 * application questions, the answers the user sent and the questions they asked Claude keep
 * what either device added, its notes keep both texts, and on a clash the later change wins, by
 * when the row changed. A call's notes keep both too.
 */
export const MERGE_RULES: Record<SyncTable, MergeRules> = {
  jobs: {
    lists: {
      links: (link) => String((link as { url?: unknown } | null)?.url ?? ''),
      questions: (question) => String(question),
      // An edit is the old answer gone and a new one added, so edits to different questions
      // both stay. Two edits to the same one leave both, and reading keeps the later.
      sent: (answer) => {
        const { question, nth, text } = (answer ?? {}) as Record<string, unknown>;
        return `${questionKey(String(question ?? ''))}#${Number(nth ?? 0)}\u0000${String(text ?? '')}`;
      },
      asks: (ask) => String((ask as { id?: unknown } | null)?.id ?? ''),
    },
    texts: ['notes'],
    stamp: 'updated_at',
  },
  status_log: {},
  calls: { texts: ['notes'] },
};

/** Columns that don't count as a change on their own, such as when a row last changed. */
export const IGNORED: Record<SyncTable, readonly string[]> = {
  jobs: ['updated_at'],
  status_log: [],
  calls: [],
};

/** What a row says, as a hash: the same on every device for the same values. */
export function rowHash(table: SyncTable, row: RowValues): string {
  const kept = Object.keys(row)
    .filter((column) => !IGNORED[table].includes(column))
    .sort()
    .map((column) => [column, row[column] ?? null]);
  return createHash('sha256').update(JSON.stringify(kept)).digest('base64url');
}

/**
 * Fills the columns this version just added to the tracker from what each row last synced. A
 * device on an earlier version keeps columns it doesn't know only in what it synced, so without
 * this, the new columns' empty values would look like changes made here, and go up in place of
 * the other device's. A row changed here before the update still goes up, with them filled in.
 */
export function adoptGainedColumns(
  tracker: Pick<Tracker, 'gainedColumns' | 'syncRow' | 'applySyncRow'>,
  state: Pick<SyncState, 'all' | 'save'>,
): number {
  let adopted = 0;
  for (const [table, gained] of tracker.gainedColumns()) {
    const prefix = rowName(table, '');
    for (const synced of state.all(prefix)) {
      if (synced.deleted || !synced.base) continue;
      const id = synced.name.slice(prefix.length);
      const local = tracker.syncRow(table, id);
      if (!local) continue;
      const base = JSON.parse(synced.base) as RowValues;
      // What this device had before the update, as its last sync saw it.
      const before = Object.fromEntries(
        Object.entries(local).filter(([column]) => !gained.includes(column)),
      );
      const unchanged = rowHash(table, before) === synced.hash;
      const carried = gained.filter((column) => column in base);
      if (carried.length > 0) {
        tracker.applySyncRow(table, id, {
          ...local,
          ...Object.fromEntries(carried.map((column) => [column, base[column] ?? null])),
        });
        adopted += 1;
      }
      const stored = tracker.syncRow(table, id);
      if (unchanged && stored) state.save({ ...synced, hash: rowHash(table, stored) });
    }
  }
  return adopted;
}
