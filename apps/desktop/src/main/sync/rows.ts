import { createHash } from 'node:crypto';
import { questionKey } from '@factwright/core';
import type { MergeRules, RowValues } from '@factwright/sync';
import type { SyncTable } from '../jobs/tracker.ts';

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
      sent: (answer) =>
        questionKey(String((answer as { question?: unknown } | null)?.question ?? '')),
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
