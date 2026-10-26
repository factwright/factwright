import { type Job, sameJob } from '@factwright/core';
import type { JobsService } from '../jobs/service.ts';
import type { ToolCall } from './mcp.ts';

export interface MergeDeps {
  jobs: Pick<JobsService, 'read' | 'job' | 'mergeJobs' | 'noteMaybeSame' | 'saidNotSame'>;
  /** Whether one of Claude's tasks is going, or waits in line, on a job. */
  busy?: (jobId: string) => boolean;
}

const named = (job: Job) => `${job.company}, ${job.role || 'the company itself'} (job ${job.id})`;

/** Why the app is sure two jobs are one, in words. */
const SURE: Readonly<Record<'posting' | 'role', string>> = {
  posting: 'they link to the same posting',
  role: 'they’re the same role at the same company, and one has no posting of its own',
};

/**
 * Merges a job found twice into the one being analyzed, or notes that the two might be one, as
 * Analyze job finds them with find_job. The app merges them only when it's sure, as the Merge with…
 * button would: the same posting, or the same role at the same company where one of the two has no
 * posting of its own. Anything less sure, or another job another task is working on, gets a note
 * on the job, "Might be the same as …", for the user to merge with a click or not. The two never
 * merge once the user said they aren't the same. Says what it did, in words for Claude.
 */
export async function mergeJob(
  jobId: string,
  otherId: string,
  why: string | null,
  deps: MergeDeps,
  call?: ToolCall,
): Promise<string> {
  // What Claude just wrote in the job's folder counts, such as its details put right.
  deps.jobs.read();
  const job = deps.jobs.job(jobId);
  if (!job) throw new Error(`Nothing on file for ${jobId}.`);
  const other = deps.jobs.job(otherId);
  if (!other) throw new Error(`Nothing on file for ${otherId}.`);
  if (other.id === job.id) return `${named(job)} and ${otherId} are one job already.`;
  if (deps.jobs.saidNotSame(job.id, other.id)) {
    return `The user said ${named(job)} and ${named(other)} aren’t the same job. Leave them apart, and go on with this job as its own.`;
  }
  const sure = sameJob(job, other);
  const elsewhere = Boolean(deps.busy?.(other.id)) && !call?.jobs?.includes(other.id);
  if (sure && !elsewhere) {
    const merged = await deps.jobs.mergeJobs(job.id, other.id);
    if (!merged.ok) throw new Error(merged.message);
    return [
      `Merged ${named(other)} into ${named(job)}, as ${SURE[sure]}.`,
      `Its status, notes, calls and links are job ${job.id}’s now. Go on with job ${job.id}.`,
    ].join(' ');
  }
  const noted = deps.jobs.noteMaybeSame(job.id, other.id, why);
  if (!noted.ok) throw new Error(noted.message);
  const because = elsewhere
    ? 'Another of Claude’s tasks is working on the other job, so they weren’t merged.'
    : 'The app merges only the same posting, or the same role where one has no posting of its own.';
  return [
    `Noted on ${named(job)}: might be the same as ${named(other)}. ${because}`,
    'The user decides with Merge in the job’s panel. Go on with this job as its own.',
  ].join(' ');
}
