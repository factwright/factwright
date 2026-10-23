import { deviceName } from './auth-options.ts';

/** Sessions shortened to their device's name at once, so no batch grows too big. */
const SHORTEN_AT_ONCE = 50;

/** How long a sign-in limit's count is kept after its last request. Each limit lasts a minute. */
const LIMIT_COUNT_MS = 60 * 60 * 1000;

/**
 * Clears sign-in's own records once they're no longer needed, so nothing about a visitor is kept
 * longer than it's used: sessions that have ended, the sign-in limits' counts (kept by IP
 * address), and sign-in steps that ran out unfinished. Better Auth keeps their dates as ISO text,
 * so they compare as text. Sessions from before sign-in kept only a device's name get theirs, and
 * the extension's from when it was Save to Factwright get the name it has now.
 */
export async function forgetOldSignIns(db: D1Database, now: Date): Promise<void> {
  const at = now.toISOString();
  // Sessions from before sign-in kept only a device's name still have all it sent: shorten them.
  // The extension's from when it was Save to Factwright take its name now.
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
  ]);
  // Apart from the deleting, so one that fails can't hold the rest back.
  for (let i = 0; i < longer.length; i += SHORTEN_AT_ONCE) {
    await db.batch(
      longer
        .slice(i, i + SHORTEN_AT_ONCE)
        .map((each) =>
          db
            .prepare('UPDATE "session" SET userAgent = ? WHERE id = ?')
            .bind(deviceName(each.userAgent), each.id),
        ),
    );
  }
}
