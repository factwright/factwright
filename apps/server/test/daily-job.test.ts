import type { PushChange } from '@factwright/sync';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAll } from '../src/daily-job.ts';
import { someId, startServer, type TestServer } from './server.ts';

/** A part of the job that finishes a moment later, noting when it has. */
function slowPart() {
  const part = { done: false, promise: Promise.resolve() };
  part.promise = new Promise<void>((resolve) =>
    setTimeout(() => {
      part.done = true;
      resolve();
    }, 20),
  );
  return part;
}

describe('the daily job', () => {
  it('waits for every part, even after one fails, and still fails', async () => {
    const backup = slowPart();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const job = runAll({
      'cleanup of old sign-ins': Promise.reject(new Error('D1 is down')),
      backup: backup.promise,
    });
    await expect(job).rejects.toThrow("1 of the daily job's 2 parts failed.");
    expect(backup.done).toBe(true);
    expect(logged).toHaveBeenCalledWith(
      "The daily job's cleanup of old sign-ins failed: Error: D1 is down",
    );
    logged.mockRestore();
  });

  it('writes down every part that failed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      runAll({ backup: Promise.reject(new Error('R2 is down')), count: Promise.reject('no') }),
    ).rejects.toThrow("2 of the daily job's 2 parts failed.");
    expect(logged.mock.calls.map(([line]) => line)).toEqual([
      "The daily job's backup failed: Error: R2 is down",
      "The daily job's count failed: no",
    ]);
    logged.mockRestore();
  });

  it('succeeds, quietly, when every part does', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runAll({ a: Promise.resolve(), b: Promise.resolve(1) })).resolves.toBeUndefined();
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('the daily job, in the Worker', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(() => server?.close());

  // Wrangler's local runtime finished the backup even when the job ended early, so this can't show
  // one cut short: the tests above guard that. It shows the parts are wired up: the backup still
  // runs, and the run is still marked as failed.
  it('backs up every account, and still fails the run, when cleaning up old sign-ins fails', async () => {
    const sam = await server.signUp();
    const change: PushChange = {
      record: someId(),
      base: 0,
      data: 'locked',
      file: null,
      deleted: false,
    };
    await sam.client.push([change]);
    // The cleanup clears sign-in's limits too, so without their table, it fails.
    await server.env.DB.prepare('DROP TABLE "rateLimit"').bind().run();

    const run = await server.worker.scheduled({
      cron: '17 4 * * *',
      scheduledTime: new Date('2026-10-16T04:17:00Z'),
    });

    expect(run.outcome).not.toBe('ok');
    const backups = (await server.env.FILES.list({ prefix: `backups/${sam.id}/` })).objects;
    expect(backups.map((object) => object.key)).toEqual([`backups/${sam.id}/2026-10-16.json.gz`]);
  });
});
