import type { KeyRecord } from '@factwright/sync';
import {
  backupsPrefix,
  DAY_MS,
  type FileRow,
  type HeadRow,
  type Meta,
  type VersionRow,
} from './store-tables.ts';

/** How long earlier versions of a record are kept. The current version of each stays. */
const HISTORY_DAYS = 90;
/** How long each daily backup is kept. */
const BACKUP_DAYS = 14;

/** What the upkeep works on: one account's store and its files. */
export interface Upkeep {
  sql: SqlStorage;
  storage: DurableObjectStorage;
  files: R2Bucket;
  meta: Meta;
}

/** What a backup holds: the whole store. File contents stay in R2, where they're kept anyway. */
interface Snapshot {
  owner: string;
  seq: number;
  keys: KeyRecord | null;
  versions: VersionRow[];
  heads: HeadRow[];
  files: FileRow[];
}

/** Deletes everything in R2 under a prefix, a page at a time. */
export async function deletePrefix(files: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix, ...(cursor ? { cursor } : {}) });
    if (page.objects.length > 0) await files.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/**
 * Saves the whole store to R2 for the day, as `backups/<account>/<day>.json.gz`, and removes
 * backups older than two weeks. A store with nothing in it has nothing to back up.
 */
export async function backUp({ sql, files, meta }: Upkeep, owner: string, day: string) {
  if (meta.count('seq') === 0) return false;
  const snapshot: Snapshot = {
    owner,
    seq: meta.count('seq'),
    keys: meta.keys(),
    versions: sql.exec<VersionRow>('SELECT * FROM versions').toArray(),
    heads: sql.exec<HeadRow>('SELECT * FROM heads').toArray(),
    files: sql.exec<FileRow>('SELECT id, key, size, at FROM files').toArray(),
  };
  const zipped = new Response(
    new Blob([JSON.stringify(snapshot)]).stream().pipeThrough(new CompressionStream('gzip')),
  );
  await files.put(`${backupsPrefix(owner)}${day}.json.gz`, await zipped.arrayBuffer(), {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
  });
  const oldest = new Date(Date.parse(day) - BACKUP_DAYS * DAY_MS).toISOString().slice(0, 10);
  const listed = await files.list({ prefix: backupsPrefix(owner) });
  const old = listed.objects
    .map((object) => object.key)
    .filter((key) => key.slice(backupsPrefix(owner).length, -'.json.gz'.length) < oldest);
  if (old.length > 0) await files.delete(old);
  return true;
}

/**
 * Puts the store back as a day's backup left it. Each record's restored version comes after
 * anything a device saw, so every device pulls it, and finds out which of its own changes the
 * store no longer has. Null when there's no backup from that day.
 */
export async function restore(
  { sql, storage, files, meta }: Upkeep,
  owner: string,
  day: string,
  gone: () => boolean = () => false,
) {
  const object = await files.get(`${backupsPrefix(owner)}${day}.json.gz`);
  if (!object) return false;
  const text = await new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).text();
  const snapshot = JSON.parse(text) as Snapshot;
  if (snapshot.owner !== owner || gone()) return false;
  storage.transactionSync(() => {
    for (const table of ['versions', 'heads', 'files', 'links', 'requests']) {
      sql.exec(`DELETE FROM ${table}`);
    }
    for (const row of snapshot.versions) {
      sql.exec(
        `INSERT INTO versions (record, version, seq, data, file, deleted, at, device)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        row.record,
        row.version,
        row.seq,
        row.data,
        row.file,
        row.deleted,
        row.at,
        row.device,
      );
    }
    let seq = Math.max(snapshot.seq, meta.count('seq'));
    for (const row of [...snapshot.heads].sort((a, b) => a.seq - b.seq)) {
      seq += 1;
      sql.exec(
        'UPDATE versions SET seq = ? WHERE record = ? AND version = ?',
        seq,
        row.record,
        row.version,
      );
      sql.exec(
        'INSERT INTO heads (record, version, seq) VALUES (?, ?, ?)',
        row.record,
        row.version,
        seq,
      );
    }
    for (const row of snapshot.files) {
      sql.exec(
        'INSERT INTO files (id, key, size, at) VALUES (?, ?, ?, ?)',
        row.id,
        row.key,
        row.size,
        row.at,
      );
    }
    meta.set('seq', seq);
    if (snapshot.keys) meta.set('keys', JSON.stringify(snapshot.keys));
    meta.set(
      'bytes',
      snapshot.versions.reduce((total, row) => total + row.data.length, 0) +
        snapshot.files.reduce((total, row) => total + row.size, 0),
    );
  });
  return true;
}

/**
 * The daily cleanup. Links and requests to link that ran out go. Earlier versions past the
 * history window go, but each record's current version stays. File contents no version points
 * to are marked, and removed a day later if that's still so: a device may be about to point to
 * them again.
 */
export async function cleanUp({ sql, storage, files, meta }: Upkeep, now: number) {
  const cutoff = new Date(now - HISTORY_DAYS * DAY_MS).toISOString();
  const used = 'id IN (SELECT file FROM versions WHERE file IS NOT NULL)';
  const doomed = storage.transactionSync(() => {
    sql.exec('DELETE FROM links WHERE expires <= ?', now);
    sql.exec('DELETE FROM requests WHERE expires <= ?', now);
    sql.exec('DELETE FROM requests_made WHERE at <= ?', now - DAY_MS);
    const old = sql
      .exec<{ size: number }>(
        `DELETE FROM versions WHERE at < ? AND NOT EXISTS (
           SELECT 1 FROM heads h WHERE h.record = versions.record AND h.version = versions.version
         ) RETURNING length(data) AS size`,
        cutoff,
      )
      .toArray();
    sql.exec(`UPDATE files SET doomed = NULL WHERE doomed IS NOT NULL AND ${used}`);
    const gone = sql
      .exec<{ key: string; size: number }>(
        `DELETE FROM files WHERE doomed IS NOT NULL AND doomed <= ? AND NOT ${used}
         RETURNING key, size`,
        now - DAY_MS / 2,
      )
      .toArray();
    sql.exec(
      `UPDATE files SET doomed = ? WHERE doomed IS NULL AND at <= ? AND NOT ${used}`,
      now,
      now - DAY_MS,
    );
    const freed = [...old, ...gone].reduce((total, row) => total + row.size, 0);
    meta.set('bytes', Math.max(0, meta.count('bytes') - freed));
    return gone;
  });
  // Each R2 key belongs to one upload, so removing these can't catch a file uploaded again.
  if (doomed.length > 0) await files.delete(doomed.map((file) => file.key));
}
