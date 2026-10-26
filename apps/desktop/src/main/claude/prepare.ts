import { effortFor } from '../../shared/effort.ts';
import { modelFor } from '../../shared/models.ts';
import { REVISE_SKILL } from '../../shared/revision.ts';
import { ANALYZE_SKILL, type RunTask, scopeOf, taskJobs } from '../../shared/runs.ts';
import type { Revisions } from '../jobs/revisions.ts';
import type { Versions } from '../jobs/versions.ts';
import { runPrompt } from '../policy.ts';
import { loadEffort } from './effort.ts';
import { loadModels } from './models.ts';
import type { Prepared } from './runs.ts';

export interface PrepareDeps {
  /** The app's own data folder, which holds the models and effort the user chose. */
  dataDir: string;
  /** The revisions the user sent from resumes' X-rays, which a revision's run claims. */
  revisions: Pick<Revisions, 'claim' | 'release' | 'record'>;
  /** The changes the user asked for, which a run started for them claims. */
  versions: Pick<Versions, 'claimChanges' | 'releaseChanges'>;
}

/**
 * Gets a task ready to start, just before its run does, which may be a while after it was asked
 * for, once it's had its turn: its prompt, its model and effort as the user chose them then, what
 * it may change, and the revision or the changes it was started for, which only its run reads.
 * Once its run starts, a revision is kept for the before-and-after. If it didn't start, starting
 * it again finds what it claimed.
 */
export function taskPreparer(deps: PrepareDeps): (task: RunTask | null) => Promise<Prepared> {
  return async (task) => {
    const revision = task && 'findings' in task ? deps.revisions.claim(task) : undefined;
    if (revision === null) return { ok: false, problem: 'revision' };
    const changes =
      task && 'changes' in task
        ? deps.versions.claimChanges(task.jobId, task.skill === REVISE_SKILL ? 'resume' : 'letter')
        : undefined;
    if (changes === null) return { ok: false, problem: 'changes' };
    const letGo = () => {
      if (revision) deps.revisions.release(revision);
      if (changes) deps.versions.releaseChanges(changes);
    };
    let chosen: Awaited<ReturnType<typeof loadModels>>;
    let effort: Awaited<ReturnType<typeof loadEffort>>;
    try {
      [chosen, effort] = await Promise.all([loadModels(deps.dataDir), loadEffort(deps.dataDir)]);
    } catch (error) {
      letGo();
      throw error;
    }
    return {
      ok: true,
      options: {
        prompt: task ? runPrompt(task) : undefined,
        choose: (levels) => ({
          model: modelFor(chosen, task, levels),
          effort: effortFor(effort, task, levels),
        }),
        scope: scopeOf(task),
        // The jobs it analyzes, which only an Analyze job run may merge others into.
        jobs: task?.skill === ANALYZE_SKILL ? taskJobs(task) : [],
        ...(revision && { revision }),
        ...(changes && { changes }),
      },
      started: async (ok) => {
        if (!ok) letGo();
        else if (revision) await deps.revisions.record(revision);
      },
    };
  };
}
