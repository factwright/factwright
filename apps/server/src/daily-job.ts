/**
 * Runs the daily job's parts side by side, and settles only once every one has. Cloudflare can end
 * a cron run as soon as the promise it's waiting on settles, so a part that fails early mustn't
 * settle it while another, such as the backup, is still going. Cloudflare's log of every request is
 * off, so each failure is written down here, as it happens, in case a limit stops the run before
 * the rest finish. The run still fails, so Cloudflare records it as one.
 */
export async function runAll(parts: Readonly<Record<string, Promise<unknown>>>): Promise<void> {
  const entries = Object.entries(parts);
  const results = await Promise.allSettled(
    entries.map(([name, part]) =>
      part.catch((reason: unknown) => {
        console.error(`The daily job's ${name} failed: ${String(reason)}`);
        throw reason;
      }),
    ),
  );
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed > 0) {
    throw new Error(`${failed} of the daily job's ${entries.length} parts failed.`);
  }
}
