import {
  type FormQuestion,
  formFeed,
  formFeedRequests,
  type Job,
  readFormFeed,
  type SavedForm,
} from '@factwright/core';
import type { EditResult, FormQuestionsResult } from '../../shared/api.ts';
import { type FetchDeps, fetchInTime, reasonOf } from '../tools/posting.ts';
import { FetchRefused } from '../tools/safe-fetch.ts';

export interface FormFeedDeps extends FetchDeps {
  jobs: {
    job(jobId: string): Job | null;
    /** Keeps the questions of a job's application form with it, for its Claude to draft. */
    keepForm(jobId: string, form: SavedForm): EditResult;
  };
}

const failed = (message: string): FormQuestionsResult => ({ ok: false, message });

/** Why there are no questions to get, for a job whose posting isn't on Greenhouse. */
const NOT_ON_GREENHOUSE =
  'Only a form on Greenhouse lists its questions before it’s open. Paste them instead, or fill in the form from your browser.';

/** Why not, when every board Greenhouse might have the job on says it hasn't. */
const CLOSED =
  'Greenhouse doesn’t list this job anymore, so it may have closed. Paste its questions instead.';

/**
 * Gets the questions of a job's application form from Greenhouse's job API, before the form is
 * open, and keeps them with the job as the extension keeps the ones it reads on a form: for your
 * Claude to draft, and for the extension to fill in at once when you open the form. Only the
 * form's own questions for your Claude (core's readFormFeed). It fetches as read_posting does,
 * from the public internet alone and never in Brotli, and a form with none to draft keeps
 * nothing.
 */
export async function getFormQuestions(
  jobId: string,
  deps: FormFeedDeps,
): Promise<FormQuestionsResult> {
  const job = deps.jobs.job(jobId);
  if (!job) return failed('That job isn’t in Factwright anymore.');
  const feed = formFeed([job.link, ...job.links.map((link) => link.url)]);
  if (!feed) return failed(NOT_ON_GREENHOUSE);
  const fetch = fetchInTime(deps);
  let trouble: unknown = null;
  // A company's own careers page may name its board one of a few ways: each is asked in turn.
  for (const request of formFeedRequests(feed.source)) {
    let questions: FormQuestion[] | null;
    try {
      questions = readFormFeed(await fetch(request.url, request.json));
    } catch (error) {
      if (error instanceof FetchRefused) {
        return failed(
          'Greenhouse answered in a way Factwright doesn’t read, so it left it alone. Paste the questions instead.',
        );
      }
      // A board without the job answers 404, as fetchPublic says it, and the next may have it.
      if (!reasonOf(error).endsWith(' answered 404')) trouble = error;
      continue;
    }
    if (!questions) continue;
    if (questions.length === 0) return { ok: true, questions: 0 };
    const kept = deps.jobs.keepForm(job.id, {
      url: feed.url,
      read: (deps.now?.() ?? new Date()).toISOString(),
      from: 'greenhouse',
      questions,
    });
    return kept.ok ? { ok: true, questions: questions.length } : kept;
  }
  return trouble
    ? failed(`Factwright couldn’t reach Greenhouse (${reasonOf(trouble)}). Try again in a moment.`)
    : failed(CLOSED);
}
