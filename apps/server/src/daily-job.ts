/**
 * Runs the daily job's parts side by side, and settles only once every one has. Cloudflare can end
 * a cron run as soon as the promise it's waiting on settles, so a part that fails early mustn't
 * settle it while another, such as the backup, is still going. Each failure is written down, as
 * Cloudflare's log of every request is off. The run still fails, so Cloudflare records it as one.
 */
export async function runAll(parts: Readonly<Record<string, Promise<unknown>>>): Promise<void> {
  const names = Object.keys(parts);
  const results = await Promise.allSettled(Object.values(parts));
  const failed = results.flatMap((result, at) =>
    result.status === 'rejected' ? [{ name: names[at], reason: result.reason }] : [],
  );
  for (const { name, reason } of failed) {
    console.error(`The daily job's ${name} failed: ${String(reason)}`);
  }
  if (failed.length > 0) {
    throw new Error(`${failed.length} of the daily job's ${names.length} parts failed.`);
  }
}
