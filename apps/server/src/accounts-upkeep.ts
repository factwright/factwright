/** How long a sign-in limit's count is kept after its last request. Each limit lasts a minute. */
const LIMIT_COUNT_MS = 60 * 60 * 1000;

/**
 * Clears sign-in's own records once they're no longer needed, so nothing about a visitor is kept
 * longer than it's used: sessions that have ended (each holds the IP address and device it
 * signed in from), the sign-in limits' counts (kept by IP address), and sign-in steps that ran
 * out unfinished. Better Auth keeps their dates as ISO text, so they compare as text.
 */
export async function forgetOldSignIns(db: D1Database, now: Date): Promise<void> {
  const at = now.toISOString();
  await db.batch([
    db.prepare('DELETE FROM "session" WHERE expiresAt < ?').bind(at),
    db.prepare('DELETE FROM "verification" WHERE expiresAt < ?').bind(at),
    db.prepare('DELETE FROM "deviceCode" WHERE expiresAt < ?').bind(at),
    db
      .prepare('DELETE FROM "rateLimit" WHERE lastRequest < ?')
      .bind(now.getTime() - LIMIT_COUNT_MS),
  ]);
}
