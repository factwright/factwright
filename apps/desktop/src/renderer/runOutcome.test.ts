import { type Job, localDate } from '@factwright/core';
import { describe, expect, it } from 'vitest';
import type { RunStep } from '../shared/activity.ts';
import type { RunTask } from '../shared/runs.ts';
import { jobRows } from './jobs/rows.ts';
import { sampleJobs } from './jobs/sample-jobs.ts';
import { makesSomething, runBefore, runOutcome } from './runOutcome.ts';

const TODAY = localDate();
const jobs = sampleJobs();
const named = (company: string) => jobs.find((job) => job.company === company) as Job;
const acme = named('Acme Robotics');
const pdf = (name: string) => ({
  path: `applications/${acme.id}/${name}`,
  name,
  format: 'pdf' as const,
  size: 1,
  modified: '2026-10-22T12:00:00.000Z',
});

/** The jobs once a run changed the task's job. */
const changed = (jobId: string | null, edit: (job: Job) => Job) =>
  jobRows(
    jobs.map((job) => (job.id === jobId ? edit(job) : job)),
    TODAY,
  );

const outcome = (task: RunTask, edit: (job: Job) => Job = (job) => job, steps: RunStep[] = []) =>
  runOutcome(
    runBefore(task, jobRows(jobs, TODAY)),
    changed('jobId' in task ? task.jobId : null, edit),
    steps,
  );

const done = (tool: string, detail: string | null = null): RunStep => ({
  id: tool,
  tool,
  detail,
  state: 'done',
});

describe('runOutcome', () => {
  it('says a resume, a letter or a Projects page is ready once the job has a new one', () => {
    expect(
      outcome({ skill: 'focused-resume', jobId: acme.id }, (job) => ({
        ...job,
        files: [...job.files, pdf('AlexRiveraResume_Acme.pdf')],
      })),
    ).toEqual({
      text: 'Your tailored resume for Acme Robotics is ready.',
      place: { jobId: acme.id, section: 'files' },
    });
    // Built again in place, it's new too.
    const lumen = named('Lumen Health');
    expect(
      outcome({ skill: 'cover-letter', jobId: lumen.id }, (job) => ({
        ...job,
        letters: job.letters.map((file) => ({ ...file, modified: '2026-10-23T09:00:00.000Z' })),
      })),
    ).toEqual({
      text: 'Your cover letter for Lumen Health is ready.',
      place: { jobId: lumen.id, section: 'files' },
    });
    expect(
      outcome({ skill: 'projects-page', jobId: acme.id }, (job) => ({
        ...job,
        projectPages: [pdf('AlexRiveraProjects_Acme.pdf')],
      })),
    ).toEqual({
      text: 'Your Projects page for Acme Robotics is ready.',
      place: { jobId: acme.id, section: 'files' },
    });
  });

  it('says nothing is ready when the job is as it was, such as when Claude stopped to ask', () => {
    expect(outcome({ skill: 'focused-resume', jobId: acme.id })).toBeNull();
    expect(outcome({ skill: 'fit-check', jobId: acme.id })).toBeNull();
    // A job that's gone has nothing to show.
    expect(
      runOutcome(
        runBefore({ skill: 'focused-resume', jobId: acme.id }, jobRows(jobs, TODAY)),
        [],
        [],
      ),
    ).toBeNull();
  });

  it('gives a fit check’s score, as its badge says it', () => {
    expect(
      outcome({ skill: 'fit-check', jobId: acme.id }, (job) => ({
        ...job,
        fit: { verdict: 'Strong fit', score: 86, date: TODAY },
      })),
    ).toEqual({
      text: 'The fit check for Acme Robotics is done: 86, Strong.',
      place: { jobId: acme.id, section: 'fit' },
    });
  });

  it('tells answers and an interview’s prep by what Claude wrote, and a question by its answer', () => {
    expect(
      outcome({ skill: 'answer-questions', jobId: acme.id }, undefined, [
        done('Write', `applications/${acme.id}/answers.md`),
      ])?.place,
    ).toEqual({ jobId: acme.id, section: 'application' });
    expect(
      outcome({ skill: 'interview-prep', jobId: acme.id }, undefined, [
        done('Write', `applications/${acme.id}/prep.md`),
      ])?.text,
    ).toBe('Your interview prep for Acme Robotics is ready.');
    expect(
      outcome({ skill: 'ask', jobId: acme.id, askId: 'q1' }, undefined, [
        done('mcp__factwright__save_answer'),
      ]),
    ).toEqual({
      text: 'Claude answered your question about Acme Robotics.',
      place: { jobId: acme.id, section: 'asks' },
    });
    // A step that only started, or failed, made nothing.
    expect(
      outcome({ skill: 'ask', jobId: acme.id, askId: 'q1' }, undefined, [
        { ...done('mcp__factwright__save_answer'), state: 'failed' },
      ]),
    ).toBeNull();
  });

  it('says a call’s prep sheet, or its thank-you notes, are ready once that call has new ones', () => {
    const tidewater = named('Tidewater Analytics');
    const sheet = (kind: 'prep' | 'thanks') => ({
      callId: 'tidewater-screen',
      kind,
      path: `calls/${tidewater.id}/tidewater-screen/${kind}.md`,
      modified: '2026-10-22T12:00:00.000Z',
    });
    const task = {
      skill: 'interview-prep',
      jobId: tidewater.id,
      callId: 'tidewater-screen',
    } as const;
    expect(
      outcome(task, (job) => ({ ...job, callDocs: [...job.callDocs, sheet('prep')] })),
    ).toEqual({
      text: 'Your prep sheet for the recruiter screen at Tidewater Analytics is ready.',
      place: { jobId: tidewater.id, section: 'calls' },
    });
    // Notes for another kind, or another call, aren't this one's.
    expect(
      outcome(task, (job) => ({ ...job, callDocs: [...job.callDocs, sheet('thanks')] })),
    ).toBeNull();
    expect(
      outcome({ skill: 'thank-you', jobId: tidewater.id, callId: 'tidewater-screen' }, (job) => ({
        ...job,
        callDocs: [...job.callDocs, sheet('thanks')],
      }))?.text,
    ).toBe('Thank-you notes for your recruiter screen at Tidewater Analytics are ready.');
  });

  it('counts the new jobs a search found, and says nothing when it found none', () => {
    const task: RunTask = { skill: 'job-search' };
    const before = runBefore(task, jobRows(jobs.slice(2), TODAY));
    expect(runOutcome(before, jobRows(jobs, TODAY), [])).toEqual({
      text: 'The job search found 2 new jobs.',
      place: { view: 'new' },
    });
    expect(runOutcome(before, jobRows(jobs.slice(1), TODAY), [])?.text).toBe(
      'The job search found a new job.',
    );
    expect(runOutcome(runBefore(task, jobRows(jobs, TODAY)), jobRows(jobs, TODAY), [])).toBeNull();
  });

  it('says a template is saved once Claude saved one', () => {
    const task: RunTask = { skill: 'make-template', source: 'liked.pdf' };
    const before = runBefore(task, []);
    expect(runOutcome(before, [], [done('mcp__factwright__save_template')])).toEqual({
      text: 'Your new template is saved.',
      place: { page: 'profile' },
    });
    expect(runOutcome(before, [], [])).toBeNull();
  });

  it('says nothing of a run with no task, such as one the user typed into', () => {
    expect(runOutcome(runBefore(null, jobRows(jobs, TODAY)), jobRows(jobs, TODAY), [])).toBeNull();
  });
});

describe('makesSomething', () => {
  it('tells the tasks that make something to show from those that talk it through', () => {
    expect(makesSomething({ skill: 'focused-resume', jobId: 'a' })).toBe(true);
    expect(makesSomething({ skill: 'fit-check', jobId: 'a' })).toBe(true);
    expect(makesSomething({ skill: 'interview-prep', jobId: 'a', callId: 'c' })).toBe(true);
    expect(
      makesSomething({ skill: 'interview-prep', jobId: 'a', callId: 'c', practice: true }),
    ).toBe(false);
    expect(makesSomething({ skill: 'get-started' })).toBe(false);
    expect(makesSomething({ skill: 'who-to-message', jobId: 'a' })).toBe(false);
    expect(makesSomething(null)).toBe(false);
  });
});
