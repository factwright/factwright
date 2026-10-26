import {
  askedFile,
  askId,
  CALL_STAGE,
  type Call,
  callDocFile,
  type Job,
  type JobShot,
  type JobStatus,
  localDate,
  parsePay,
  questionKey,
  resumeSent,
  type SavedForm,
  SETTLED_STATUSES,
  STATUS_RANK,
  shotsFolder,
} from '@factwright/core';
import { termIdOf } from '@factwright/xray';
import datesLastPdf from '@factwright/xray/fixtures/dates-last.pdf?url';
import engineerWord from '@factwright/xray/fixtures/engineer.docx?url';
import engineerPdf from '@factwright/xray/fixtures/engineer.pdf?url';
import footerPdf from '@factwright/xray/fixtures/footer.pdf?url';
import headerWord from '@factwright/xray/fixtures/header.docx?url';
import iconsPdf from '@factwright/xray/fixtures/icons.pdf?url';
import sidebarPdf from '@factwright/xray/fixtures/sidebar.pdf?url';
import spacedPdf from '@factwright/xray/fixtures/spaced.pdf?url';
import type { EditResult, FactwrightApi, JobChanges, JobList } from '../../shared/api.ts';
import { REVISE_SKILL, type Revision } from '../../shared/revision.ts';
import { type RunTask, THANKS_SKILL, taskCall, taskJobs } from '../../shared/runs.ts';
import type { DocKind, DocVersion } from '../../shared/versions.ts';
import {
  sampleCallDocs,
  sampleDocs,
  sampleDuplicate,
  sampleForm,
  sampleJob,
  sampleJobs,
  sampleOutreach,
  sampleSaved,
  sampleVersions,
} from './sample-jobs.ts';
import { samplePdf } from './sample-pdf.ts';

/** A file the screens preview serves, as bytes. */
async function fileBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

/**
 * The resume every sample job and starting resume has, as a PDF and a Word file: one the engine
 * made, or, for ?resume=, one of the X-ray's files with a problem in it.
 */
const RESUMES: Readonly<Record<string, { pdf: string; word: string }>> = {
  engineer: { pdf: engineerPdf, word: engineerWord },
  spaced: { pdf: spacedPdf, word: headerWord },
  'dates-last': { pdf: datesLastPdf, word: headerWord },
  icons: { pdf: iconsPdf, word: headerWord },
  sidebar: { pdf: sidebarPdf, word: headerWord },
  footer: { pdf: footerPdf, word: headerWord },
};

type TrackerApi = Pick<
  FactwrightApi,
  | 'listJobs'
  | 'jobDocs'
  | 'updateJob'
  | 'updateJobs'
  | 'mergeJobs'
  | 'notSameJob'
  | 'addJob'
  | 'addCall'
  | 'updateCall'
  | 'deleteCall'
  | 'redateStatusChange'
  | 'undoStatusChange'
  | 'addNote'
  | 'updateNote'
  | 'deleteNote'
  | 'onJobsChanged'
  | 'openFile'
  | 'downloadFile'
  | 'showFile'
  | 'readPdf'
  | 'readWord'
  | 'copyText'
  | 'saveFile'
  | 'jobExtras'
  | 'recordAnswer'
  | 'getFormQuestions'
  | 'askAboutJob'
  | 'removeAsk'
  | 'addShot'
  | 'removeShot'
  | 'readShot'
  | 'pasteImage'
  | 'prepareRevision'
  | 'revisionOf'
  | 'keepVersion'
  | 'useVersion'
  | 'removeVersion'
  | 'requestChanges'
>;

/** A resume's file name without its format, which its PDF and Word file share. */
const stemOf = (name: string) => name.replace(/\.(?:pdf|docx)$/i, '');

/** A sample job's folder, from where its files are, as the sample jobs keep none of their own. */
const folderOf = (job: Job) => job.folder ?? job.files[0]?.path.split('/')[1] ?? job.id;

/** A time as a previous version's folder: 2026-10-15-093012. */
const stampOf = (at: Date) => {
  const iso = new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(':', '')}`;
};

/**
 * What ?revised shows: a revision of the job's resume, sent an hour before it was last built,
 * that fixed what it picked but a key term that's still missing.
 */
function sampleRevision(job: Job, resume: string): Revision | null {
  const file = job.files.find((each) => each.name === resume);
  if (!file) return null;
  const at = new Date(Date.parse(file.modified) - 3_600_000);
  const previous = `applications/${folderOf(job)}/previous/${stampOf(at)}`;
  return {
    at: at.toISOString(),
    resume,
    findings: [
      {
        id: 'check-dates',
        kind: 'content',
        title: 'Dates: 2 jobs with dates some systems can’t read',
      },
      { id: 'check-headings', kind: 'content', title: 'Section headings: No skills section' },
      { id: termIdOf('Terraform'), kind: 'content', title: 'Add “Terraform”' },
      { id: termIdOf('Kubernetes'), kind: 'question', title: 'Check “Kubernetes”' },
    ],
    before: '2 problems reading it · 3 of 11 key terms',
    previous,
    files: job.files
      .filter((each) => stemOf(each.name) === stemOf(resume))
      .map((each) => `${previous}/${each.name}`),
  };
}

/** What Claude answered about the sample jobs, by job and question. */
function sampleAnswer(question: string, on: string): string {
  return [
    `# ${question.split('\n')[0]}`,
    '',
    `Asked ${on}. Answered ${localDate()}.`,
    '',
    'Expect three people for 45 minutes: the hiring manager, a senior engineer and a product manager. Most panels there start with a walk through your resume, then one system you built, in depth.',
    '',
    '**Worth asking them:**',
    '- What would you want the platform team to have shipped a year from now?',
    '- How do product teams ask for platform work today?',
    '',
    '## Sources',
    '- Interview reports on Glassdoor, 2025 and 2026',
  ].join('\n');
}

const SAVED: EditResult = { ok: true };

/** A job's files of one kind. */
const filesOf = (job: Job, kind: DocKind) =>
  kind === 'resume' ? job.files : kind === 'letter' ? job.letters : job.projectPages;

/** A job with its files of one kind in place of the ones it had. */
const withFiles = (job: Job, kind: DocKind, files: Job['files']): Job =>
  kind === 'resume'
    ? { ...job, files }
    : kind === 'letter'
      ? { ...job, letters: files }
      : { ...job, projectPages: files };

/**
 * The tracker for the sample screens, kept in memory until the page reloads. It follows the
 * real tracker's main rules (a call moves a job forward, Undo puts it back) closely enough to
 * check the screens by eye. "jobs" picks the starting jobs: none, failed or loading, twice,
 * with a job found twice to merge, or saved, with jobs saved from the browser that Claude hasn't
 * analyzed yet, and one Analyze job noted might be another.
 */
export function sampleTracker(
  jobs: string | null,
  resume: string | null = null,
  revised = false,
): TrackerApi & {
  /** What a made-up run leaves on its job, such as a tailored resume, as a real one would. */
  madeBy: (task: RunTask) => void;
} {
  const files = RESUMES[resume ?? ''] ?? { pdf: engineerPdf, word: engineerWord };
  // Revisions sent in the sample screens, by job and resume, until the page reloads.
  const revisions = new Map<string, Revision>();
  // Earlier versions of the jobs' resumes, letters and Projects pages, newest first, by job.
  const versions = new Map<string, DocVersion[]>();
  const revisionKey = (jobId: string, name: string) => `${jobId}/${stemOf(name)}`;
  let list: JobList = {
    jobs:
      jobs === 'none'
        ? []
        : jobs === 'twice'
          ? [...sampleJobs(), sampleDuplicate()]
          : jobs === 'saved'
            ? [...sampleJobs(), ...sampleSaved()]
            : sampleJobs(),
    readAt: new Date().toISOString(),
  };
  for (const [jobId, kept] of sampleVersions(list.jobs)) versions.set(jobId, kept);
  const listeners = new Set<(list: JobList) => void>();
  // The questions got from the form of a job on Greenhouse, by the job's ID.
  const forms = new Map<string, SavedForm>();
  // Screenshots added in the sample screens, by path, and Claude's answers to questions.
  const shots = new Map<string, { shot: JobShot; bytes: Uint8Array }>();
  const asked = new Map<string, string>(
    list.jobs.flatMap((job) =>
      job.asks.map((ask) => [askedFile(job.id, ask.id), sampleAnswer(ask.question, ask.on)]),
    ),
  );
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
  /** Keeps a job's current version as an earlier one, as the app does before a run makes another. */
  const keep = (
    jobId: string,
    kind: DocKind,
    why: 'new' | 'changes',
    changes?: string,
  ): EditResult => {
    const job = list.jobs.find((each) => each.id === jobId);
    if (!job) return { ok: false, message: 'That job isn’t on file anymore.' };
    if (kind !== 'projects' && resumeSent(job)) {
      return { ok: false, message: 'You applied with this one, so it stays as you sent it.' };
    }
    const current = filesOf(job, kind);
    if (current.length === 0) return SAVED;
    const folder = `applications/${folderOf(job)}/previous/${stampOf(new Date())}`;
    const kept: DocVersion = {
      folder,
      kind,
      at: new Date().toISOString(),
      why,
      changes: changes ?? null,
      files: current.map((each) => ({ ...each, path: `${folder}/${each.name}` })),
      usable: true,
    };
    versions.set(jobId, [kept, ...(versions.get(jobId) ?? [])]);
    return SAVED;
  };
  const mark = (job: Job, status: JobStatus, at: string): Job => ({
    ...job,
    status,
    statusOn: at,
    appliedOn: status === 'applied' && !job.appliedOn ? at : job.appliedOn,
    statusLog: [...job.statusLog, { id: newId('change'), status, at }],
  });
  // What Claude found for each job, from before the user set any of its details.
  const found = new Map<
    string,
    Pick<Job, 'company' | 'companyKey' | 'role' | 'pay' | 'location'>
  >();
  /** A job with the details the user set, which win over what Claude found, as the tracker's do. */
  const withOwn = (job: Job, changes: JobChanges): Job => {
    const fields = ['company', 'role', 'pay', 'location'] as const;
    if (!fields.some((field) => changes[field] !== undefined)) return job;
    const claude = found.get(job.id) ?? {
      company: job.company,
      companyKey: job.companyKey,
      role: job.role,
      pay: job.pay,
      location: job.location,
    };
    found.set(job.id, claude);
    const own = { ...job.own };
    for (const field of fields) {
      if (changes[field] !== undefined) own[field] = changes[field]?.trim() || null;
    }
    const range = own.pay ? parsePay(own.pay) : null;
    return {
      ...job,
      own,
      company: own.company ?? claude.company,
      companyKey: own.company ? own.company.toLowerCase().replace(/\W+/g, '-') : claude.companyKey,
      role: own.role ?? claude.role,
      pay: own.pay
        ? { text: own.pay, min: range?.min ?? null, max: range?.max ?? null, source: 'own' }
        : claude.pay,
      location: own.location ?? claude.location,
    };
  };
  /**
   * One job's change, as the real tracker makes it: a job set aside keeps the day it comes back,
   * and one passed on keeps why, each when given.
   */
  const edit = (job: Job, changes: JobChanges): Job => {
    let updated: Job = {
      ...job,
      ...(changes.nextAction !== undefined && {
        nextAction: changes.nextAction?.trim() || null,
      }),
      ...(changes.nextOn !== undefined && { nextOn: changes.nextOn }),
      ...(changes.appliedOn !== undefined && { appliedOn: changes.appliedOn }),
      ...(changes.earlierNotes !== undefined && {
        earlierNotes: changes.earlierNotes?.trim() || null,
      }),
      ...(changes.questions !== undefined && { questions: changes.questions }),
      ...(changes.archived !== undefined && { archived: changes.archived }),
      ...(changes.kind !== undefined && { kind: changes.kind }),
      ...(changes.payAsk !== undefined && { payAsk: changes.payAsk?.trim() || null }),
    };
    updated = withOwn(updated, changes);
    const { status } = changes;
    const moved = status !== undefined && status !== job.status;
    if (moved) {
      updated = status
        ? mark(updated, status, changes.statusOn ?? localDate())
        : { ...updated, status: null, statusOn: null };
    }
    if (changes.backOn !== undefined || (moved && status === 'later')) {
      updated = { ...updated, backOn: changes.backOn ?? null };
    }
    if (changes.passReason !== undefined || (moved && status === 'passed')) {
      updated = { ...updated, passReason: changes.passReason ?? null };
    }
    return updated;
  };

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
        (job) => edit(job, changes),
      ),
    updateJobs: async (jobIds, changes) =>
      change(
        (job) => jobIds.includes(job.id),
        (job) => edit(job, changes),
      ),
    // As the tracker merges them, closely enough to check the screens by eye.
    mergeJobs: async (keepId, otherId) => {
      const keep = list.jobs.find((job) => job.id === keepId);
      const other = list.jobs.find((job) => job.id === otherId);
      if (!keep || !other || keep === other) {
        return { ok: false, message: 'That job isn’t in your tracker anymore.' };
      }
      const latest = (other.statusOn ?? '') > (keep.statusOn ?? '') ? other : keep;
      const byDay = <T extends { date: string | null }>(a: T, b: T) =>
        (a.date ?? '').localeCompare(b.date ?? '');
      const merged: Job = {
        ...keep,
        status: latest.status,
        statusOn: latest.statusOn,
        backOn: latest.backOn,
        passReason: latest.passReason,
        archived: latest.archived,
        appliedOn: [keep.appliedOn, other.appliedOn].filter(Boolean).sort()[0] ?? null,
        links: [...keep.links, ...other.links.filter((link) => !keep.links.includes(link))],
        notes: [...keep.notes, ...other.notes].sort((a, b) => a.on.localeCompare(b.on)),
        calls: [...keep.calls, ...other.calls].sort((a, b) => a.onDate.localeCompare(b.onDate)),
        statusLog: [...keep.statusLog, ...other.statusLog].sort((a, b) => a.at.localeCompare(b.at)),
        searches: [
          ...keep.searches,
          ...other.searches.filter(
            (run) => !keep.searches.some((each) => each.folder === run.folder),
          ),
        ].sort(byDay),
        events: [...keep.events, ...other.events].sort(byDay),
      };
      return publish(
        list.jobs.flatMap((job) => (job === other ? [] : job === keep ? [merged] : [job])),
      );
    },
    notSameJob: async (jobId, otherId) =>
      change(
        (job) => job.id === jobId,
        (job) => ({
          ...job,
          maybeSame: [
            ...job.maybeSame.filter((each) => each.id !== otherId),
            { id: otherId, why: null, on: localDate(), notSame: true },
          ],
        }),
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
        searches: [],
        manual: true,
        notes: input.notes?.trim()
          ? [
              {
                id: newId('note'),
                on: today,
                text: input.notes.trim(),
                at: new Date().toISOString(),
              },
            ]
          : [],
        firstSeen: today,
        lastActivity: today,
        kind: input.kind ?? null,
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
            minutes: input.minutes ?? null,
            mode: input.mode ?? null,
            place: input.place ?? null,
            people: input.people ?? [],
            state: past ? 'done' : 'scheduled',
            outcome: null,
            notes: input.notes ?? null,
            debrief: null,
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
          // Saying how a booked call went marks it done, as the tracker does.
          const said =
            Boolean(changes.outcome) ||
            (Boolean(changes.debrief) && (before?.onDate ?? '') <= localDate());
          const done =
            changes.state === undefined && said && before?.state === 'scheduled'
              ? { state: 'done' as const }
              : {};
          const updated = {
            ...job,
            calls: job.calls.map((call) =>
              call.id === callId ? { ...call, ...changes, ...done } : call,
            ),
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
    addNote: async (jobId, input) => {
      if (!input.text.trim()) return { ok: false, message: 'Type your note first.' };
      const note = {
        id: newId('note'),
        on: input.on ?? localDate(),
        text: input.text.trim(),
        at: new Date().toISOString(),
      };
      return change(
        (job) => job.id === jobId,
        (job) => ({ ...job, notes: [...job.notes, note] }),
      );
    },
    updateNote: async (noteId, changes) =>
      change(
        (job) => job.notes.some((note) => note.id === noteId),
        (job) => ({
          ...job,
          notes: job.notes.map((note) =>
            note.id === noteId
              ? {
                  ...note,
                  ...(changes.text !== undefined && { text: changes.text.trim() }),
                  ...(changes.on !== undefined && { on: changes.on }),
                }
              : note,
          ),
        }),
      ),
    deleteNote: async (noteId) =>
      change(
        (job) => job.notes.some((note) => note.id === noteId),
        (job) => ({ ...job, notes: job.notes.filter((note) => note.id !== noteId) }),
      ),
    onJobsChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    madeBy: (task) => {
      const jobIds = taskJobs(task);
      const modified = new Date().toISOString();
      const file = (job: Job, name: string) => ({
        path: `applications/${job.id}/${name}`,
        name,
        format: 'pdf' as const,
        size: 48_213,
        modified,
      });
      const named = (job: Job) => job.company.replace(/\W+/g, '');
      change(
        (job) => jobIds.includes(job.id),
        (job) => {
          // One the job has already is built again, under its own name.
          const again = (files: Job['files'], name: string) =>
            files.length > 0 ? files.map((each) => ({ ...each, modified })) : [file(job, name)];
          switch (task.skill) {
            case 'focused-resume':
            case REVISE_SKILL:
              return { ...job, files: again(job.files, `AlexRiveraResume_${named(job)}.pdf`) };
            case 'cover-letter':
              return {
                ...job,
                letters: again(job.letters, `AlexRiveraCoverLetter_${named(job)}.pdf`),
              };
            case 'projects-page':
              return {
                ...job,
                projectPages: again(job.projectPages, `AlexRiveraProjects_${named(job)}.pdf`),
              };
            case 'analyze-job':
              return {
                ...job,
                stage: 'review',
                fit: { verdict: 'Good fit', score: 78, date: localDate() },
              };
            case 'salary-check':
              return {
                ...job,
                pay: { text: '$160k–$190k', min: 160_000, max: 190_000, source: 'estimate' },
              };
            case 'who-to-message': {
              const path = `outreach/${localDate()}-${job.companyKey}.md`;
              return job.outreach.includes(path)
                ? job
                : { ...job, outreach: [...job.outreach, path] };
            }
            // A call's prep sheet, or the thank-you notes after it, written again or for the
            // first time. A mock interview writes nothing.
            case 'interview-prep':
            case THANKS_SKILL: {
              const callId = taskCall(task);
              if (!callId || 'practice' in task) return job;
              const kind = task.skill === THANKS_SKILL ? 'thanks' : 'prep';
              const others = job.callDocs.filter(
                (doc) => doc.callId !== callId || doc.kind !== kind,
              );
              const path = callDocFile(job.id, callId, kind);
              return { ...job, callDocs: [...others, { callId, kind, path, modified }] };
            }
            default:
              return job;
          }
        },
      );
    },
    jobExtras: async (jobId) => {
      const job = list.jobs.find((each) => each.id === jobId);
      if (!job) return null;
      return {
        asked: Object.fromEntries(
          job.asks.flatMap((ask) => {
            const answer = asked.get(askedFile(job.id, ask.id));
            return answer ? [[ask.id, answer]] : [];
          }),
        ),
        shots: [...shots.values()]
          .map((each) => each.shot)
          .filter((shot) => shot.path.startsWith(`${shotsFolder(jobId)}/`)),
        posting: null,
        form: forms.get(jobId) ?? null,
        calls: sampleCallDocs(job),
        outreach: sampleOutreach(job),
        versions: versions.get(jobId) ?? [],
      };
    },
    recordAnswer: async (jobId, question, nth, text) =>
      change(
        (job) => job.id === jobId,
        (job) => {
          const others = job.sent.filter(
            (each) => questionKey(each.question) !== questionKey(question) || each.nth !== nth,
          );
          const answer = { question, nth, text, on: localDate(), at: new Date().toISOString() };
          return { ...job, sent: text.trim() ? [...others, answer] : others };
        },
      ),
    // A moment later, as Greenhouse answers, the form's questions join the job's.
    getFormQuestions: async (jobId) => {
      const job = list.jobs.find((each) => each.id === jobId);
      if (!job) return { ok: false, message: 'That job isn’t in Factwright anymore.' };
      await new Promise((resolve) => setTimeout(resolve, 600));
      const form = sampleForm(job);
      forms.set(jobId, form);
      const have = new Set(job.questions.map(questionKey));
      const added = form.questions
        .map((each) => each.question)
        .filter((question) => !have.has(questionKey(question)));
      change(
        (each) => each.id === jobId,
        (each) => ({ ...each, questions: [...each.questions, ...added] }),
      );
      return { ok: true, questions: form.questions.length };
    },
    askAboutJob: async (jobId, question) => {
      const job = list.jobs.find((each) => each.id === jobId);
      if (!job) return { ok: false, message: 'That job isn’t in your tracker anymore.' };
      if (!question.trim()) return { ok: false, message: 'Type your question first.' };
      const id = askId(
        question,
        localDate(),
        job.asks.map((ask) => ask.id),
      );
      change(
        (each) => each.id === jobId,
        (each) => ({
          ...each,
          asks: [...each.asks, { id, question: question.trim(), on: localDate() }],
        }),
      );
      // Claude answers a moment later, as a run would.
      setTimeout(() => {
        asked.set(askedFile(jobId, id), sampleAnswer(question.trim(), localDate()));
        publish(list.jobs.map((each) => ({ ...each })));
      }, 2500);
      return { ok: true, askId: id };
    },
    removeAsk: async (jobId, id) => {
      asked.delete(askedFile(jobId, id));
      return change(
        (job) => job.id === jobId,
        (job) => ({ ...job, asks: job.asks.filter((ask) => ask.id !== id) }),
      );
    },
    addShot: async (jobId, upload, purpose) => {
      const stem = purpose.kind === 'ask' ? `ask-${purpose.ask}` : `form-${localDate()}`;
      const name = `${stem}-${shots.size + 1}.png`;
      const path = `${shotsFolder(jobId)}/${name}`;
      const shot: JobShot = {
        path,
        name,
        kind: purpose.kind,
        ask: purpose.kind === 'ask' ? purpose.ask : null,
        size: upload.bytes.length,
        modified: new Date().toISOString(),
      };
      shots.set(path, { shot, bytes: upload.bytes });
      return { ok: true, path };
    },
    removeShot: async (path) => {
      shots.delete(path);
      return SAVED;
    },
    readShot: async (path) => shots.get(path)?.bytes ?? null,
    pasteImage: async () => ({ ok: true, file: '/sample/workspace/screenshots/pasted-1.png' }),
    openFile: async () => ({ ok: false, message: 'The sample screens can’t open files.' }),
    downloadFile: async () => ({ ok: false, message: 'The sample screens can’t save files.' }),
    showFile: async () => ({ ok: false, message: 'The sample screens can’t show files.' }),
    // Every resume is the same made-up one, made by the engine as the app makes it. A cover
    // letter shows the sample page.
    readPdf: async (path) => ({
      ok: true,
      data: /CoverLetter/.test(path) ? samplePdf() : await fileBytes(files.pdf),
    }),
    readWord: async () => ({ ok: true, data: await fileBytes(files.word) }),
    // The sample screens keep no files, so a revision only remembers what was sent.
    prepareRevision: async (request) => {
      const job = list.jobs.find((each) => each.id === request.jobId);
      if (!job) return { ok: false, message: 'That job isn’t on file anymore.' };
      const at = new Date();
      const previous = `applications/${folderOf(job)}/previous/${stampOf(at)}`;
      revisions.set(revisionKey(job.id, request.resume), {
        at: at.toISOString(),
        resume: request.resume,
        findings: request.findings.map(({ id, kind, title }) => ({ id, kind, title })),
        ...(request.template && { template: request.template }),
        before: request.before,
        previous,
        files: job.files
          .filter((file) => stemOf(file.name) === stemOf(request.resume))
          .map((file) => `${previous}/${file.name}`),
      });
      return { ok: true };
    },
    // A job applied to keeps its resume as sent, as the app's does.
    keepVersion: async (jobId, kind) => keep(jobId, kind, 'new'),
    useVersion: async (jobId, folder) => {
      const job = list.jobs.find((each) => each.id === jobId);
      const kept = versions.get(jobId) ?? [];
      const version = kept.find((each) => each.folder === folder);
      if (!job || !version) return { ok: false, message: 'That version isn’t on file anymore.' };
      const current = filesOf(job, version.kind);
      const aside: DocVersion = {
        folder: `applications/${folderOf(job)}/previous/${stampOf(new Date())}`,
        kind: version.kind,
        at: new Date().toISOString(),
        why: 'swapped',
        changes: null,
        files: current.map((each) => ({
          ...each,
          path: `applications/${folderOf(job)}/previous/${stampOf(new Date())}/${each.name}`,
        })),
        usable: true,
      };
      versions.set(jobId, [aside, ...kept.filter((each) => each !== version)]);
      const back = version.files.map((each) => ({
        ...each,
        path: `applications/${folderOf(job)}/${each.name}`,
      }));
      return change(
        (each) => each.id === jobId,
        (each) => withFiles(each, version.kind, back),
      );
    },
    removeVersion: async (jobId, folder) => {
      versions.set(
        jobId,
        (versions.get(jobId) ?? []).filter((each) => each.folder !== folder),
      );
      // The job reads its versions again, as it does when the folder goes.
      return change(
        (each) => each.id === jobId,
        (each) => ({ ...each }),
      );
    },
    requestChanges: async (request) =>
      keep(request.jobId, request.kind, 'changes', request.changes),
    revisionOf: async (jobId, name) => {
      const job = list.jobs.find((each) => each.id === jobId);
      const locked =
        job && resumeSent(job) ? 'You applied with this resume, so it stays as you sent it.' : null;
      const sent = revisions.get(revisionKey(jobId, name));
      const file = job?.files.find(
        (each) => stemOf(each.name) === stemOf(name) && each.format === 'pdf',
      );
      const last = sent ?? (revised && job && file ? sampleRevision(job, file.name) : null);
      return { last, locked };
    },
    copyText: async (text) => {
      await navigator.clipboard?.writeText(text).catch(() => {});
      return SAVED;
    },
    saveFile: async (name, text) => {
      const link = document.createElement('a');
      const type = name.endsWith('.ics') ? 'text/calendar' : 'text/csv';
      link.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
      return { ok: true, saved: true };
    },
  };
}
