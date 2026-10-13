import { deviceName } from './auth-options.ts';

/** How long a sign-in limit's count is kept after its last request. Each limit lasts a minute. */
const LIMIT_COUNT_MS = 60 * 60 * 1000;

/**
 * Clears sign-in's own records once they're no longer needed, so nothing about a visitor is kept
 * longer than it's used: sessions that have ended, the sign-in limits' counts (kept by IP
 * address), and sign-in steps that ran out unfinished. Better Auth keeps their dates as ISO text,
 * so they compare as text. Sessions from before sign-in kept only a device's name get theirs.
 */
export async function forgetOldSignIns(db: D1Database, now: Date): Promise<void> {
  const at = now.toISOString();
  // Sessions from before sign-in kept only a device's name still have all it sent: shorten them.
  const sessions = await db
    .prepare('SELECT id, userAgent FROM "session" WHERE userAgent IS NOT NULL')
    .all<{ id: string; userAgent: string }>();
  const longer = sessions.results.filter((each) => deviceName(each.userAgent) !== each.userAgent);
  await db.batch([
    db.prepare('DELETE FROM "session" WHERE expiresAt < ?').bind(at),
    db.prepare('DELETE FROM "verification" WHERE expiresAt < ?').bind(at),
    db.prepare('DELETE FROM "deviceCode" WHERE expiresAt < ?').bind(at),
    db
      .prepare('DELETE FROM "rateLimit" WHERE lastRequest < ?')
      .bind(now.getTime() - LIMIT_COUNT_MS),
    ...longer.map((each) =>
      db
        .prepare('UPDATE "session" SET userAgent = ? WHERE id = ?')
        .bind(deviceName(each.userAgent), each.id),
    ),
  ]);
}
