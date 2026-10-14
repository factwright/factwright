import { DatabaseSync } from 'node:sqlite';

/**
 * What each of the tracker's versions after the first added, in order: the first is version 2's.
 * Add one for each step added to the tracker's migrations.
 */
const ADDED: readonly ({ table: string } | { jobColumns: readonly string[] })[] = [
  { jobColumns: ['questions'] },
  { jobColumns: ['sent', 'asks'] },
  { table: 'notes' },
  { jobColumns: ['back_on', 'pass_reason'] },
  { jobColumns: ['kind'] },
];

/**
 * Takes a tracker file back to an earlier version, as an older app would have left it, for tests
 * of how the app updates and syncs across versions. What later versions added goes, and the rest
 * stays. Another connection can have the file open. With `keepTables`, the tables later versions
 * made stay, for a test that syncs with this version's code all along, which needs them.
 */
export function trackerAsOf(file: string, version: number, { keepTables = false } = {}): void {
  const db = new DatabaseSync(file);
  try {
    const current = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    if (current !== ADDED.length + 1) {
      throw new Error(`The tracker is at version ${current}: add what it added to ADDED.`);
    }
    for (let at = current; at > version; at--) {
      const added = ADDED[at - 2];
      if (!added) continue;
      if ('table' in added) {
        if (!keepTables) db.exec(`DROP TABLE ${added.table}`);
      } else {
        for (const column of added.jobColumns) db.exec(`ALTER TABLE jobs DROP COLUMN ${column}`);
      }
    }
    db.exec(`PRAGMA user_version = ${version}`);
  } finally {
    db.close();
  }
}
