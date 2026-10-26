import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CollectedJob, Job } from '@factwright/core';
import { type Account, startServer, type TestServer } from '@factwright/server/testing';
import { accountKeys, type Bytes, newAccountKey } from '@factwright/sync';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleJob } from '../../renderer/jobs/sample-jobs.ts';
import type { RunsView, RunView } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { AnalyzeNew } from '../claude/analyze-new.ts';
import { type Claim, Tracker } from '../jobs/tracker.ts';
import { CLAIM_LAPSE_MS, CLAIM_RENEW_MS, Claims, type ClaimsSync, claimNotes } from './claims.ts';
import { SyncEngine } from './engine.ts';
import { SyncState } from './state.ts';

const JOB = 'acme-robotics--staff-engineer';
const OTHER = 'globex--staff-engineer';
const START = Date.parse('2026-10-26T09:00:00.000Z');
const MINUTE = 60_000;

/** A run as the window hears of it. */
const run = (id: string, task: RunTask, phase: RunView['phase'] = 'working'): RunView => ({
  id,
  task,
  phase,
  waits: null,
  screen: null,
  startedAt: 1,
  problem: null,
  analyzed: [],
});
const runs = (...list: RunView[]): RunsView => ({ runs: list, atOnce: 3, setUp: true });
/** A run Claude started on its own, analyzing jobs. */
const own = (id: string, ...jobIds: string[]) =>
  run(id, { skill: 'analyze-job', jobIds, auto: true });
/** A task the user started on a job. */
const users = (id: string, jobId: string) => run(id, { skill: 'focused-resume', jobId });

const claimBy = (device: string, until: number, isOwn = true): Omit<Claim, 'job'> => ({
  device,
  until: new Date(until).toISOString(),
  own: isOwn,
});

describe('claims on jobs, on one computer', () => {
  let tracker: Tracker;
  let clock: number;
  let on: boolean;
  let working: boolean;
  /** The claims the server had when this computer last synced, and the jobs that reached it. */
  let server: Map<string, Claim>;
  let reached: Set<string>;
  /** Claims another computer got to the server first, which a round of sync brings here. */
  let first: Map<string, Claim>;
  let requests: number;
  let stepped: string[];

  /** A round of sync: each claim of this computer's goes up, unless another got there first. */
  const round = async () => {
    if (!working) return false;
    for (const claim of tracker.claims()) {
      const theirs = first.get(claim.job);
      if (theirs) tracker.setClaim(theirs);
      server.set(claim.job, theirs ?? claim);
      reached.add(claim.job);
    }
    return true;
  };
  const sync: ClaimsSync = {
    on: () => on,
    working: () => working,
    device: () => 'mac',
    reached: (job) => reached.has(job),
    server: (job) => server.get(job) ?? null,
    now: () => round(),
    request: () => {
      requests += 1;
    },
  };
  const claims = () =>
    new Claims({ tracker, sync, stepAside: (id) => stepped.push(id), now: () => clock });

  beforeEach(() => {
    tracker = new Tracker(':memory:');
    clock = START;
    on = true;
    working = true;
    server = new Map();
    reached = new Set([JOB, OTHER]);
    first = new Map();
    requests = 0;
    stepped = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    tracker.close();
  });

  it('claims nothing without sync, where this is the only computer', async () => {
    on = false;
    tracker.setClaim({ job: JOB, ...claimBy('pc', START + 5 * MINUTE) });
    const here = claims();
    expect(here.elsewhere(JOB)).toBe(false);
    expect(await here.take([JOB, OTHER])).toEqual([JOB, OTHER]);
    here.heard(runs(users('run-1', OTHER)));
    expect(tracker.claims().map((claim) => claim.device)).toEqual(['pc']);
    expect(requests).toBe(0);
  });

  it('leaves a job another computer holds until it has seen the claim go unrenewed ten minutes', () => {
    // The PC's clock runs a day fast, which counts for nothing here.
    tracker.setClaim({ job: JOB, ...claimBy('pc', START + 24 * 60 * MINUTE) });
    const here = claims();
    expect(here.elsewhere(JOB)).toBe(true);
    expect(here.elsewhere(OTHER)).toBe(false);
    clock += 9 * MINUTE;
    expect(here.elsewhere(JOB)).toBe(true);
    // Renewed, as sync brings it in, it holds ten minutes more.
    tracker.setClaim({ job: JOB, ...claimBy('pc', START + 24 * 60 * MINUTE + 9 * MINUTE) });
    here.synced();
    clock += 9 * MINUTE;
    expect(here.elsewhere(JOB)).toBe(true);
    clock += MINUTE;
    expect(here.elsewhere(JOB)).toBe(false);
    // One left behind long ago, by the clock it was made by, has lapsed as soon as it's seen.
    tracker.setClaim({ job: OTHER, ...claimBy('pc', clock - 2 * 60 * MINUTE) });
    expect(here.elsewhere(OTHER)).toBe(false);
  });

  it('holds a job once the server took its claim, ahead of any other computer’s', async () => {
    const here = claims();
    first.set(OTHER, { job: OTHER, ...claimBy('pc', START + 10 * MINUTE) });
    expect(await here.take([JOB, OTHER])).toEqual([JOB]);
    expect(tracker.claim(JOB)).toEqual({ job: JOB, ...claimBy('mac', START + CLAIM_LAPSE_MS) });
    // The other computer's claim stands, here as on the server.
    expect(tracker.claim(OTHER)?.device).toBe('pc');
    expect(here.elsewhere(OTHER)).toBe(true);
  });

  it('waits for sync for a job that reached the server, and takes one only this computer has', async () => {
    working = false;
    reached = new Set([JOB]);
    const here = claims();
    expect(await here.take([JOB, OTHER])).toEqual([OTHER]);
    // Its claim waits here, to go up with the job once sync works.
    expect(tracker.claims().map((claim) => claim.job)).toEqual([OTHER]);
  });

  it('claims a task’s jobs, taking one from another computer’s run of its own, never from its task', async () => {
    tracker.setClaim({ job: JOB, ...claimBy('pc', START + 5 * MINUTE, true) });
    tracker.setClaim({ job: OTHER, ...claimBy('pc', START + 5 * MINUTE, false) });
    const here = claims();
    here.heard(runs(users('run-1', JOB), users('run-2', OTHER)));
    expect(tracker.claim(JOB)).toEqual({
      job: JOB,
      ...claimBy('mac', START + CLAIM_LAPSE_MS, false),
    });
    expect(tracker.claim(OTHER)?.device).toBe('pc');
    expect(requests).toBe(1);
    // A run of its own never takes a claim that holds: it steps aside.
    here.heard(runs(own('run-3', OTHER)));
    expect(tracker.claim(OTHER)?.device).toBe('pc');
    expect(stepped).toEqual(['run-3']);
  });

  it('lets go of a claim once its run ends, putting back what the server has', async () => {
    const here = claims();
    expect(await here.take([JOB])).toEqual([JOB]);
    here.heard(runs(own('run-1', JOB)));
    // A task the user started on Globex took it from the PC, though that never reached the server.
    server.set(OTHER, { job: OTHER, ...claimBy('pc', START + 5 * MINUTE) });
    tracker.setClaim({ job: OTHER, ...claimBy('pc', START + 5 * MINUTE) });
    here.heard(runs(own('run-1', JOB), users('run-2', OTHER)));
    expect(tracker.claim(OTHER)?.device).toBe('mac');
    here.heard(runs(run('run-1', { skill: 'analyze-job', jobIds: [JOB], auto: true }, 'done')));
    expect(tracker.claim(JOB)).toBeNull();
    expect(tracker.claim(OTHER)).toEqual({ job: OTHER, ...claimBy('pc', START + 5 * MINUTE) });
  });

  it('renews its claims every few minutes while its runs work, and stops once they’re done', async () => {
    vi.useFakeTimers();
    const here = claims();
    expect(await here.take([JOB])).toEqual([JOB]);
    here.heard(runs(own('run-1', JOB)));
    clock += CLAIM_RENEW_MS;
    vi.advanceTimersByTime(CLAIM_RENEW_MS);
    expect(tracker.claim(JOB)?.until).toBe(new Date(clock + CLAIM_LAPSE_MS).toISOString());
    // A long analysis keeps it, renewal after renewal.
    for (let renewal = 0; renewal < 4; renewal++) {
      clock += CLAIM_RENEW_MS;
      vi.advanceTimersByTime(CLAIM_RENEW_MS);
    }
    expect(here.elsewhere(JOB)).toBe(false);
    expect(tracker.claim(JOB)?.until).toBe(new Date(clock + CLAIM_LAPSE_MS).toISOString());
    expect(stepped).toEqual([]);
    here.heard(runs());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('makes a run of its own step aside once it slept past its claim, which it never renews', async () => {
    vi.useFakeTimers();
    const here = claims();
    expect(await here.take([JOB])).toEqual([JOB]);
    here.heard(runs(own('run-1', JOB), users('run-2', OTHER)));
    // The computer sleeps a quarter of an hour, and its renewal comes late, as it wakes. Another
    // computer may have taken the job and analyzed it meanwhile.
    clock += 15 * MINUTE;
    vi.advanceTimersByTime(CLAIM_RENEW_MS);
    expect(stepped).toEqual(['run-1']);
    expect(tracker.claim(JOB)).toBeNull();
    // A task of the user's is never held back: it claims its job again.
    expect(tracker.claim(OTHER)).toEqual({
      job: OTHER,
      ...claimBy('mac', clock + CLAIM_LAPSE_MS, false),
    });
  });

  it('makes a run of its own step aside once another computer holds its job', async () => {
    const here = claims();
    expect(await here.take([JOB, OTHER])).toEqual([JOB, OTHER]);
    here.heard(runs(own('run-1', JOB, OTHER), users('run-2', 'initech--staff-engineer')));
    here.synced();
    expect(stepped).toEqual([]);
    // Sync brings in the PC's claim, as when a task the user started there took the job.
    tracker.setClaim({ job: OTHER, ...claimBy('pc', START + 10 * MINUTE, false) });
    here.synced();
    expect(stepped).toEqual(['run-1']);
  });
});

describe('claims on jobs, between two computers', () => {
  let testServer: TestServer;
  let mac: Computer;
  let pc: Computer;
  let clock: number;

  beforeAll(async () => {
    testServer = await startServer();
  });

  afterAll(() => testServer?.close());

  /** A computer with its own tracker and sync notes, signed in to the account. */
  async function computer(name: string, account: Account, accountKey: Bytes) {
    const folder = mkdtempSync(join(tmpdir(), 'factwright-claims-'));
    const workspace = join(folder, 'workspace');
    mkdirSync(workspace);
    const tracker = new Tracker(join(folder, 'tracker.db'));
    const state = new SyncState(join(folder, 'sync.db'));
    const session = await testServer.newSession(account.id);
    const engine = new SyncEngine({
      client: session.client,
      keys: await accountKeys(accountKey),
      state,
      tracker,
      workspace,
      device: name,
    });
    const sync = () => engine.syncOnce();
    const notes = claimNotes(state);
    const stepped: string[] = [];
    const claims = new Claims({
      tracker,
      sync: {
        ...notes,
        on: () => true,
        working: () => true,
        now: () =>
          sync().then(
            () => true,
            () => false,
          ),
        request: () => {},
      },
      stepAside: (id) => stepped.push(id),
      now: () => clock,
    });
    return {
      tracker,
      sync,
      claims,
      stepped,
      device: notes.device(),
      close() {
        claims.stop();
        tracker.close();
        state.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  }
  type Computer = Awaited<ReturnType<typeof computer>>;

  const collected: CollectedJob = {
    id: JOB,
    company: 'Acme Robotics',
    companyKey: 'acme-robotics',
    role: 'Staff Engineer',
    link: null,
    links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
    location: null,
    pay: null,
    source: 'Added by hand',
    fit: null,
    search: null,
    searches: [],
    kindFound: null,
    suggestedAsk: null,
    folder: null,
    stage: 'new',
    firstSeen: '2026-10-26',
    lastActivity: '2026-10-26',
    summary: null,
    events: [],
    docs: {},
    outreach: [],
    apply: null,
    fitReport: null,
    sentiment: null,
    files: [],
    letters: [],
    projectPages: [],
  };

  /** A job saved on the Mac, which reaches the PC through sync. */
  const shareJob = async () => {
    mac.tracker.saveCollected([collected], '2026-10-26T08:00:00.000Z');
    await mac.sync();
    await pc.sync();
    expect(pc.tracker.rows().map((row) => row.id)).toEqual([JOB]);
  };

  beforeEach(async () => {
    const account = await testServer.signUp();
    const accountKey = newAccountKey();
    clock = START;
    mac = await computer('Sam’s Mac', account, accountKey);
    pc = await computer('Sam’s PC', account, accountKey);
  });

  afterEach(() => {
    vi.useRealTimers();
    mac?.close();
    pc?.close();
  });

  it('gives a job to one computer when both claim it at once, and both agree which', async () => {
    await shareJob();
    const [onMac, onPc] = await Promise.all([mac.claims.take([JOB]), pc.claims.take([JOB])]);
    // One holds it: the one whose claim the server took first.
    expect([...onMac, ...onPc]).toEqual([JOB]);
    const [winner, loser] = onMac.length > 0 ? [mac, pc] : [pc, mac];
    await mac.sync();
    await pc.sync();
    expect(mac.tracker.claim(JOB)).toEqual(pc.tracker.claim(JOB));
    expect(mac.tracker.claim(JOB)?.device).toBe(winner.device);
    expect(loser.claims.elsewhere(JOB)).toBe(true);
    expect(winner.claims.elsewhere(JOB)).toBe(false);
  });

  it('lets another computer take a job once a claim lapses, and the first steps aside on waking', async () => {
    await shareJob();
    expect(await mac.claims.take([JOB])).toEqual([JOB]);
    mac.claims.heard(runs(own('run-1', JOB)));
    await pc.sync();
    expect(pc.claims.elsewhere(JOB)).toBe(true);
    expect(await pc.claims.take([JOB])).toEqual([]);
    // The Mac sleeps mid-run, renewing nothing, and its claim lapses: the PC takes the job over.
    clock += CLAIM_LAPSE_MS + MINUTE;
    expect(pc.claims.elsewhere(JOB)).toBe(false);
    expect(await pc.claims.take([JOB])).toEqual([JOB]);
    // Waking, the Mac's run steps aside, as its claim lapsed, and it finds the PC's in its place.
    mac.claims.heard(runs(own('run-1', JOB)));
    expect(mac.stepped).toEqual(['run-1']);
    mac.claims.heard(runs());
    await mac.sync();
    expect(mac.tracker.claim(JOB)?.device).toBe(pc.device);
    expect(pc.claims.elsewhere(JOB)).toBe(false);
  });

  /**
   * The Mac's run of its own is on the job, and its lid closes past its claim: the PC takes the job
   * over, analyzes it, and lets go. Returns the Mac's run's tab, by its ID.
   */
  const sleepWhileTheOtherAnalyzes = async () => {
    await shareJob();
    expect(await mac.claims.take([JOB])).toEqual([JOB]);
    mac.claims.heard(runs(own('run-1', JOB)));
    await pc.sync();
    expect(pc.claims.elsewhere(JOB)).toBe(true);
    clock += CLAIM_LAPSE_MS + MINUTE;
    expect(await pc.claims.take([JOB])).toEqual([JOB]);
    pc.claims.heard(runs(own('run-5', JOB)));
    pc.claims.heard(runs());
    await pc.sync();
    expect(pc.tracker.claim(JOB)).toBeNull();
  };

  it('makes a run that slept past its claim step aside as it syncs, though the other let the job go', async () => {
    await sleepWhileTheOtherAnalyzes();
    await mac.sync();
    mac.claims.synced();
    expect(mac.stepped).toEqual(['run-1']);
    expect(mac.tracker.claim(JOB)).toBeNull();
  });

  it('makes a run that slept past its claim step aside as its renewal comes, never renewing it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await sleepWhileTheOtherAnalyzes();
    vi.advanceTimersByTime(CLAIM_RENEW_MS);
    expect(mac.stepped).toEqual(['run-1']);
    await mac.sync();
    await pc.sync();
    expect(mac.tracker.claim(JOB)).toBeNull();
    expect(pc.tracker.claim(JOB)).toBeNull();
  });

  it('makes a run step aside once it syncs, when a task of the user’s took its job and let go', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await shareJob();
    expect(await mac.claims.take([JOB])).toEqual([JOB]);
    mac.claims.heard(runs(own('run-1', JOB)));
    await pc.sync();
    // On the PC, the user's task takes the job and finishes, while the Mac's sync is slow.
    pc.claims.heard(runs(users('run-7', JOB)));
    await pc.sync();
    pc.claims.heard(runs());
    await pc.sync();
    // The Mac renews its claim, which still holds by its clock, and then hears of the PC's.
    clock += CLAIM_RENEW_MS;
    vi.advanceTimersByTime(CLAIM_RENEW_MS);
    expect(mac.stepped).toEqual([]);
    await mac.sync();
    mac.claims.synced();
    expect(mac.stepped).toEqual(['run-1']);
    expect(mac.tracker.claim(JOB)).toBeNull();
  });

  it('lets a task the user starts take a job from the other computer’s run of its own', async () => {
    await shareJob();
    expect(await mac.claims.take([JOB])).toEqual([JOB]);
    mac.claims.heard(runs(own('run-1', JOB)));
    await pc.sync();
    // On the PC, the user starts a tailored resume for the job: their task takes the claim.
    pc.claims.heard(runs(users('run-7', JOB)));
    await pc.sync();
    await mac.sync();
    mac.claims.synced();
    expect(mac.stepped).toEqual(['run-1']);
    mac.claims.heard(runs());
    // Their task done, the PC lets go, and the job is free on both.
    pc.claims.heard(runs());
    await pc.sync();
    await mac.sync();
    expect(mac.tracker.claim(JOB)).toBeNull();
    expect(pc.tracker.claim(JOB)).toBeNull();
    expect(await mac.claims.take([JOB])).toEqual([JOB]);
  });

  it('starts one run of Claude’s own when two computers analyze the same new job', async () => {
    await shareJob();
    const started: string[] = [];
    const tried: string[] = [];
    const dataDirs: string[] = [];
    const job: Job = sampleJob({
      id: JOB,
      company: 'Acme Robotics',
      role: 'Staff Engineer',
      links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
      searches: [],
      source: 'Added by hand',
      manual: true,
      status: 'new',
      firstSeen: '2026-10-26',
    });
    const analyzing = async (computer: Computer, name: string) => {
      const dataDir = mkdtempSync(join(tmpdir(), 'factwright-claims-analyze-'));
      dataDirs.push(dataDir);
      const analyze = new AnalyzeNew({
        dataDir,
        jobs: () => [job],
        runs: {
          view: () => runs(),
          canStartOwn: () => true,
          startOwn: () => {
            started.push(name);
            return 'run-1';
          },
        },
        ready: () => true,
        today: () => '2026-10-26',
        claims: {
          elsewhere: (id) => computer.claims.elsewhere(id),
          take: async (ids) => {
            try {
              return await computer.claims.take(ids);
            } finally {
              tried.push(name);
            }
          },
          letGo: (ids) => computer.claims.letGo(ids),
        },
        quietMs: 0,
      });
      await analyze.load();
      return analyze;
    };
    const onMac = await analyzing(mac, 'mac');
    const onPc = await analyzing(pc, 'pc');
    try {
      onMac.look();
      onPc.look();
      await vi.waitFor(() => expect(tried).toHaveLength(2), { timeout: 10_000 });
      expect(started).toHaveLength(1);
      // Once both have synced, the other leaves the job to the one that started.
      await mac.sync();
      await pc.sync();
      const [winner, loser] = started[0] === 'mac' ? [mac, pc] : [pc, mac];
      expect(winner.claims.elsewhere(JOB)).toBe(false);
      expect(loser.claims.elsewhere(JOB)).toBe(true);
    } finally {
      onMac.stop();
      onPc.stop();
      for (const dir of dataDirs) rmSync(dir, { recursive: true, force: true });
    }
  });
});
