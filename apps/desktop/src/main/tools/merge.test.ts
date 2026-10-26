import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../jobs/service.ts';
import { type EditContext, Tracker } from '../jobs/tracker.ts';
import { newCall, type ToolCall } from './mcp.ts';
import { mergeJob } from './merge.ts';

const AT: EditContext = { today: '2026-10-25', now: '2026-10-25T18:00:00.000Z' };

let root: string;
let tracker: Tracker;
let jobs: JobsService;

/** A job saved from the browser, by its link, and its ID. */
function save(company: string, role: string, link: string): string {
  const saved = tracker.addSavedJob({ company, role, link, pay: '' }, AT);
  if (!saved.ok) throw new Error(saved.message);
  return saved.id;
}

/** A job added by hand, with only a link that isn't one job's, as a search can find a board. */
function add(company: string, role: string, link: string): string {
  const added = tracker.addJob({ company, role, link }, AT);
  if (!added.ok) throw new Error(added.message);
  return added.jobId;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factwright-merge-'));
  tracker = new Tracker(':memory:');
  jobs = new JobsService({ workspace: root, tracker, onChange: () => {} });
});

afterEach(() => {
  tracker.close();
  rmSync(root, { recursive: true, force: true });
});

describe('merge_job', () => {
  const POSTING = 'https://apply.workable.com/seeq/j/1B6E0A1710/';
  /** A call from a run analyzing jobs, by their IDs. */
  const analyzing = (...ids: string[]): ToolCall => ({ ...newCall('hunt'), jobs: ids });

  it('merges a job found twice, when one has no posting of its own, into the one analyzed', async () => {
    const posted = save('Seeq', 'AI Software Engineer, Staff/Principal', POSTING);
    const board = add(
      'Seeq',
      'AI Software Engineer, Staff/Principal',
      'https://apply.workable.com/seeq',
    );
    jobs.read();
    const said = await mergeJob(
      posted,
      board,
      'Same role, by its board',
      { jobs },
      analyzing(posted),
    );
    expect(said).toMatch(/^Merged Seeq, AI Software Engineer, Staff\/Principal \(job /);
    expect(said).toContain('the same role at the same company, and one has no posting of its own');
    expect(said).toContain(`Go on with job ${posted}.`);
    expect(tracker.resolve(board)).toBe(posted);
  });

  it('merges the same posting, whatever company it was saved under', async () => {
    const posted = save('Seeq', 'AI Software Engineer, Staff/Principal', POSTING);
    // Its link written another way, as a job board's share link can.
    const twice = add('Workable', 'AI Engineer', `${POSTING.slice(0, -1)}?utm_source=linkedin`);
    jobs.read();
    expect(await mergeJob(posted, twice, null, { jobs }, analyzing(posted))).toContain(
      'they link to the same posting',
    );
    expect(tracker.resolve(twice)).toBe(posted);
  });

  it('notes a job that might be the same, when the app isn’t sure, for the user to merge', async () => {
    const posted = save('Seeq', 'AI Software Engineer, Staff/Principal', POSTING);
    const other = save(
      'Seeq',
      'Staff AI Platform Engineer',
      'https://www.linkedin.com/jobs/view/4088',
    );
    jobs.read();
    const said = await mergeJob(posted, other, 'Same team and level', { jobs }, analyzing(posted));
    expect(said).toMatch(/^Noted on Seeq, AI Software Engineer, Staff\/Principal/);
    expect(said).toContain('The user decides with Merge');
    expect(tracker.resolve(other)).toBe(other);
    expect(jobs.job(posted)?.maybeSame).toEqual([
      { id: other, why: 'Same team and level', on: expect.any(String), notSame: false },
    ]);
  });

  it('never merges two jobs the user said aren’t the same', async () => {
    const posted = save('Seeq', 'AI Software Engineer, Staff/Principal', POSTING);
    const board = add(
      'Seeq',
      'AI Software Engineer, Staff/Principal',
      'https://apply.workable.com/seeq',
    );
    tracker.notSame(board, posted, AT);
    jobs.read();
    expect(await mergeJob(posted, board, null, { jobs }, analyzing(posted))).toMatch(
      /^The user said .* aren’t the same job/,
    );
    expect(tracker.resolve(board)).toBe(board);
  });

  it('notes, rather than merges, a job another task is on, unless it’s this run’s own', async () => {
    const posted = save('Seeq', 'AI Software Engineer, Staff/Principal', POSTING);
    const board = add(
      'Seeq',
      'AI Software Engineer, Staff/Principal',
      'https://apply.workable.com/seeq',
    );
    jobs.read();
    const busy = (jobId: string) => jobId === board || jobId === posted;
    const elsewhere = await mergeJob(posted, board, null, { jobs, busy }, analyzing(posted));
    expect(elsewhere).toContain('Another of Claude’s tasks is working on the other job');
    expect(tracker.resolve(board)).toBe(board);
    // Both jobs this run's own, as when the user picked them both to analyze: the one merged is
    // done with the other, which the run's tab counts.
    const done: string[] = [];
    const own = await mergeJob(
      posted,
      board,
      null,
      { jobs, busy },
      { ...analyzing(posted, board), analyzed: (jobId) => done.push(jobId) },
    );
    expect(own).toMatch(/^Merged/);
    expect(own).toContain(`Job ${board} was one of this run’s jobs: it’s done with this one`);
    expect(done).toEqual([board]);
  });

  it('says so for a job that isn’t on file, or one merged already', async () => {
    const posted = save('Seeq', 'AI Software Engineer, Staff/Principal', POSTING);
    const board = add(
      'Seeq',
      'AI Software Engineer, Staff/Principal',
      'https://apply.workable.com/seeq',
    );
    jobs.read();
    await expect(mergeJob(posted, 'gone--job', null, { jobs }, analyzing(posted))).rejects.toThrow(
      'Nothing on file for gone--job.',
    );
    await mergeJob(posted, board, null, { jobs }, analyzing(posted));
    expect(await mergeJob(posted, board, null, { jobs }, analyzing(posted))).toContain(
      'are one job already',
    );
  });

  it('merges only into a job the run analyzes, never in any other run', async () => {
    const posted = save('Seeq', 'AI Software Engineer, Staff/Principal', POSTING);
    const board = add(
      'Seeq',
      'AI Software Engineer, Staff/Principal',
      'https://apply.workable.com/seeq',
    );
    jobs.read();
    // A run with no task, a run on other jobs, and the IDs the wrong way round.
    for (const call of [undefined, newCall('hunt'), analyzing('acme--staff'), analyzing(board)]) {
      await expect(mergeJob(posted, board, null, { jobs }, call)).rejects.toThrow(
        /^merge_job is for Analyze job/,
      );
    }
    expect(tracker.resolve(board)).toBe(board);
    expect(jobs.job(posted)?.maybeSame).toEqual([]);
  });
});
