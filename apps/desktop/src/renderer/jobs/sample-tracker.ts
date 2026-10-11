import {
  CALL_STAGE,
  type Call,
  type Job,
  type JobStatus,
  localDate,
  parsePay,
  SETTLED_STATUSES,
  STATUS_RANK,
} from '@factwright/core';
import type { EditResult, FactwrightApi, JobList } from '../../shared/api.ts';
import { sampleDocs, sampleJob, sampleJobs } from './sample-jobs.ts';

type TrackerApi = Pick<
  FactwrightApi,
  | 'listJobs'
  | 'jobDocs'
  | 'updateJob'
  | 'addJob'
  | 'addCall'
  | 'updateCall'
  | 'deleteCall'
  | 'redateStatusChange'
  | 'undoStatusChange'
  | 'onJobsChanged'
  | 'openFile'
  | 'copyText'
  | 'saveFile'
>;

const SAVED: EditResult = { ok: true };

/**
 * The tracker for the sample screens, kept in memory until the page reloads. It follows the
 * real tracker's main rules (a call moves a job forward, Undo puts it back) closely enough to
 * check the screens by eye. "jobs" picks the starting jobs: none, failed or loading.
 */
export function sampleTracker(jobs: string | null): TrackerApi {
  let list: JobList = {
    jobs: jobs === 'none' ? [] : sampleJobs(),
    readAt: new Date().toISOString(),
  };
  const listeners = new Set<(list: JobList) => void>();
  let next = 0;
  const newId = (kind: string) => `${kind}-${++next}`;

  const publish = (updated: Job[]) => {
    list = { ...list, jobs: updated };
    for (const listener of listeners) listener(list);
    return SAVED;
  };
  const change = (test: (job: Job) => boolean, edit: (job: Job) => Job) =>
    publish(list.jobs.map((job) => (test(job) ? edit(job) : job)));
  const settled = (job: Job) => Boolean(job.status && SETTLED_STATUSES.includes(job.status));
  const mark = (job: Job, status: JobStatus, at: string): Job => ({
    ...job,
    status,
    statusOn: at,
    appliedOn: status === 'applied' && !job.appliedOn ? at : job.appliedOn,
    statusLog: [...job.statusLog, { id: newId('change'), status, at }],
  });

  return {
    listJobs: () =>
      jobs === 'loading'
        ? new Promise(() => {})
        : jobs === 'failed'
          ? Promise.reject(new Error('Sample failure'))
          : Promise.resolve(list),
    jobDocs: async (jobId) => {
      const job = list.jobs.find((each) => each.id === jobId);
      return job ? sampleDocs(job) : null;
    },
    updateJob: async (jobId, changes) =>
      change(
        (job) => job.id === jobId,
        (job) => {
          let updated: Job = {
            ...job,
            ...(changes.nextAction !== undefined && {
              nextAction: changes.nextAction?.trim() || null,
            }),
            ...(changes.nextOn !== undefined && { nextOn: changes.nextOn }),
            ...(changes.notes !== undefined && { notes: changes.notes?.trim() || null }),
            ...(changes.archived !== undefined && { archived: changes.archived }),
          };
          const { status } = changes;
          if (status !== undefined && status !== job.status) {
            updated = status
              ? mark(updated, status, changes.statusOn ?? localDate())
              : { ...updated, status: null, statusOn: null };
          }
          return updated;
        },
      ),
    addJob: async (input) => {
      const company = input.company.trim();
      if (!company) return { ok: false, message: 'Add the company’s name.' };
      const today = localDate();
      const range = input.pay ? parsePay(input.pay) : null;
      let job = sampleJob({
        id: newId('added'),
        company,
        role: input.role?.trim() ?? '',
        link: input.link || null,
        location: null,
        source: 'Added by hand',
        manual: true,
        notes: input.notes?.trim() || null,
        firstSeen: today,
        lastActivity: today,
        pay: input.pay
          ? { text: input.pay, min: range?.min ?? null, max: range?.max ?? null, source: 'listed' }
          : null,
      });
      if (input.status) job = mark(job, input.status, today);
      publish([...list.jobs, job]);
      return { ok: true, jobId: job.id };
    },
    addCall: async (jobId, input) =>
      change(
        (job) => job.id === jobId,
        (job) => {
          const today = localDate();
          const past = input.onDate < today;
          const call: Call = {
            id: newId('call'),
            kind: input.kind,
            onDate: input.onDate,
            atTime: input.atTime ?? null,
            state: past ? 'done' : 'scheduled',
            outcome: null,
            notes: input.notes ?? null,
          };
          const calls = [...job.calls, call].sort((a, b) => a.onDate.localeCompare(b.onDate));
          const target = input.kind === 'other' ? undefined : CALL_STAGE[input.kind];
          const forward =
            target !== undefined &&
            !settled(job) &&
            (STATUS_RANK[target] ?? 0) > (STATUS_RANK[job.status ?? 'new'] ?? 0);
          const withCall = { ...job, calls };
          return forward ? mark(withCall, target, past ? input.onDate : today) : withCall;
        },
      ),
    updateCall: async (callId, changes) =>
      change(
        (job) => job.calls.some((call) => call.id === callId),
        (job) => {
          const before = job.calls.find((call) => call.id === callId);
          const updated = {
            ...job,
            calls: job.calls.map((call) => (call.id === callId ? { ...call, ...changes } : call)),
          };
          const rejects = changes.outcome === 'rejected' && before?.outcome !== 'rejected';
          return rejects && !settled(job) ? mark(updated, 'rejected', localDate()) : updated;
        },
      ),
    deleteCall: async (callId) =>
      change(
        () => true,
        (job) => ({ ...job, calls: job.calls.filter((call) => call.id !== callId) }),
      ),
    redateStatusChange: async (changeId, at) =>
      change(
        (job) => job.statusLog.some((entry) => entry.id === changeId),
        (job) => {
          const entry = job.statusLog.find((each) => each.id === changeId);
          const latest = job.statusLog.at(-1)?.id === changeId && job.status === entry?.status;
          return {
            ...job,
            statusLog: job.statusLog.map((each) => (each.id === changeId ? { ...each, at } : each)),
            statusOn: latest ? at : job.statusOn,
            appliedOn: entry?.status === 'applied' ? at : job.appliedOn,
          };
        },
      ),
    undoStatusChange: async (changeId) =>
      change(
        (job) => job.statusLog.some((entry) => entry.id === changeId),
        (job) => {
          const entry = job.statusLog.find((each) => each.id === changeId);
          const statusLog = job.statusLog.filter((each) => each.id !== changeId);
          const latest = job.statusLog.at(-1)?.id === changeId && job.status === entry?.status;
          const previous = statusLog.at(-1);
          const applied = statusLog.find((each) => each.status === 'applied');
          return {
            ...job,
            statusLog,
            status: latest ? (previous?.status ?? null) : job.status,
            statusOn: latest ? (previous?.at ?? null) : job.statusOn,
            appliedOn: entry?.status === 'applied' ? (applied?.at ?? null) : job.appliedOn,
          };
        },
      ),
    onJobsChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openFile: async () => ({ ok: false, message: 'The sample screens can’t open files.' }),
    copyText: async (text) => {
      await navigator.clipboard?.writeText(text).catch(() => {});
      return SAVED;
    },
    saveFile: async (name, text) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
      return { ok: true, saved: true };
    },
  };
}
