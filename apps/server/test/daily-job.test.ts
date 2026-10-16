import type { PushChange } from '@factwright/sync';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAll } from '../src/daily-job.ts';
import { type Account, someId, startServer, type TestServer } from './server.ts';

afterEach(() => vi.restoreAllMocks());

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

/** What the daily job wrote down as failures. */
const failures = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('the daily job', () => {
  it('waits for every part, even after one fails, and still fails', async () => {
    const logged = failures();
    const backup = slowPart();
    const job = runAll({
      'cleanup of old sign-ins': Promise.reject(new Error('D1 is down')),
      backup: backup.promise,
    });
    await expect(job).rejects.toThrow("1 of the daily job's 2 parts failed.");
    expect(backup.done).toBe(true);
    expect(logged).toHaveBeenCalledWith(
      "The daily job's cleanup of old sign-ins failed: Error: D1 is down",
    );
  });

  it('writes a failure down as it happens, before the rest are done', async () => {
    const logged = failures();
    const backup = slowPart();
    const job = runAll({ count: Promise.reject(new Error('no')), backup: backup.promise });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backup.done).toBe(false);
    expect(logged).toHaveBeenCalledWith("The daily job's count failed: Error: no");
    await expect(job).rejects.toThrow();
  });

  it('writes down every part that failed', async () => {
    const logged = failures();
    await expect(
      runAll({ backup: Promise.reject(new Error('R2 is down')), count: Promise.reject('no') }),
    ).rejects.toThrow("2 of the daily job's 2 parts failed.");
    expect(logged.mock.calls.map(([line]) => line)).toEqual([
      "The daily job's backup failed: Error: R2 is down",
      "The daily job's count failed: no",
    ]);
  });

  it('succeeds, quietly, when every part does', async () => {
    const logged = failures();
    await expect(runAll({ a: Promise.resolve(), b: Promise.resolve(1) })).resolves.toBeUndefined();
    expect(logged).not.toHaveBeenCalled();
  });
});

/** What the Worker has written down as errors since its logs were last cleared. */
const errors = (server: TestServer) =>
  server.server
    .getLogs()
    .filter((log) => log.level === 'error')
    .map((log) => log.message);

/** Runs the Worker's daily job, as Cloudflare would on a day. */
const runDailyJob = (server: TestServer, day: string) =>
  server.worker.scheduled({ cron: '17 4 * * *', scheduledTime: new Date(`${day}T04:17:00Z`) });

/** Accounts with something stored, so each has a backup to make. */
async function accountsWithData(server: TestServer, count: number): Promise<Account[]> {
  const accounts: Account[] = [];
  for (let i = 0; i < count; i += 1) {
    const account = await server.signUp();
    const change: PushChange = {
      record: someId(),
      base: 0,
      data: 'locked',
      file: null,
      deleted: false,
    };
    await account.client.push([change]);
    accounts.push(account);
  }
  return accounts;
}

/** The accounts that have a backup for the day. */
async function backedUp(server: TestServer, accounts: Account[], day: string) {
  const found: string[] = [];
  for (const { id } of accounts) {
    const { objects } = await server.env.FILES.list({ prefix: `backups/${id}/` });
    if (objects.some((object) => object.key === `backups/${id}/${day}.json.gz`)) found.push(id);
  }
  return found;
}

describe('the daily job, when cleaning up old sign-ins fails', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(() => server?.close());

  it('backs up every account all the same, and the run fails', async () => {
    const accounts = await accountsWithData(server, 6);
    // The cleanup clears sign-in's limits too, so without their table, it fails. That leaves this
    // server's cleanup broken, so it's the only test here.
    await server.env.DB.prepare('DROP TABLE "rateLimit"').bind().run();

    server.server.clearLogs();
    const run = await runDailyJob(server, '2026-10-16');

    expect(run.outcome).toBe('exception');
    expect(await backedUp(server, accounts, '2026-10-16')).toEqual(accounts.map(({ id }) => id));
    // The runtime's logs arrive a moment after the run.
    await vi.waitFor(() =>
      expect(errors(server).join('\n')).toContain(
        "The daily job's cleanup of old sign-ins failed:",
      ),
    );
  });
});

describe('the daily job’s backup', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(() => server?.close());

  it('skips an account deleted partway, which has nothing left to back up', async () => {
    const [kept, deleted] = await accountsWithData(server, 2);
    if (!kept || !deleted) throw new Error('no accounts');
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: deleted.id });
    await storage.exec("INSERT INTO meta (key, value) VALUES ('deleted', ?)", deleted.id);

    const run = await runDailyJob(server, '2026-10-17');

    expect(run.outcome).toBe('ok');
    expect(await backedUp(server, [kept, deleted], '2026-10-17')).toEqual([kept.id]);
  });

  it('backs up the rest when one account’s backup fails, and then the run fails', async () => {
    const accounts = await accountsWithData(server, 3);
    // Backups go in order of account ID, so breaking the first one shows the rest still go on.
    const broken = accounts.reduce((first, each) => (each.id < first.id ? each : first));
    // A store that answers to another account turns its backup away.
    const storage = await server.worker.getDurableObjectStorage('STORES', { name: broken.id });
    await storage.exec("UPDATE meta SET value = 'someone-else' WHERE key = 'owner'");
    try {
      server.server.clearLogs();
      const run = await runDailyJob(server, '2026-10-18');

      expect(run.outcome).toBe('exception');
      const others = accounts.filter(({ id }) => id !== broken.id).map(({ id }) => id);
      expect(await backedUp(server, accounts, '2026-10-18')).toEqual(others);
      await vi.waitFor(() => {
        const written = errors(server).join('\n');
        expect(written).toContain(
          `Couldn't back up account ${broken.id}'s store: Error: This store belongs to another account.`,
        );
        expect(written).toContain("The daily job's backup failed: Error: 1 of");
      });
    } finally {
      // So the other tests here find every store as it was.
      await storage.exec("UPDATE meta SET value = ? WHERE key = 'owner'", broken.id);
    }
  });
});
